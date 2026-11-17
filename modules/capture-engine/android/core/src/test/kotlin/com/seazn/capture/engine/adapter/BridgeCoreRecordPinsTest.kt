package com.seazn.capture.engine.adapter

import com.seazn.capture.engine.core.*
import java.io.IOException
import kotlin.test.AfterTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue
import org.json.JSONObject

/**
 * N38 after a JS reload or a process death (device, 2026-11-16: a court code paired for hours sent 34 lines, and the web
 * kept none, "sessions: none named"). JS's ring is seeded from [BridgeCore.tail], which held the last 20 lines alone, so
 * the pairing's `pair` line and its `broadcast-start` were gone. The tail now carries them as `pins`, and an open window's
 * pins are kept in the private store, so a new core over the same store (a process death) carries them too.
 */
class BridgeCoreRecordPinsTest {
  private val clock = FakeClock()
  private val scheduler = FakeScheduler(clock)
  private val store = MemoryStore()
  private val platform = RecordingPlatform()
  private val core = build(platform)

  private fun build(on: RecordingPlatform = RecordingPlatform()) =
    BridgeCore(clock, scheduler, on, store, "1.0.0", "Test Phone") { Configs.PHONE_ID }.also { on.core = it }

  @AfterTest fun forgetShared() = BridgeCore.resetShared()

  private fun line(kind: String, of: RecordingPlatform = platform) = of.lines.last { JSONObject(it).getString("kind") == kind }

  private fun lines(kind: String, of: RecordingPlatform = platform) = of.lines.map(::JSONObject).filter { it.getString("kind") == kind }

  private fun pins(of: BridgeCore = core) = of.tail()["pins"]

  private fun tailLines(of: BridgeCore = core) = of.tail()["lines"] as List<*>

  private fun probes(count: Int, of: BridgeCore = core) {
    repeat(count) { of.log("info", "probe.line", mapOf("n" to it.toDouble())) }
    scheduler.advanceBy(0)
  }

  private fun paired(wire: Map<String, Any?> = PairWire.valid()) {
    core.send(wire)
    scheduler.advanceBy(0)
    assertEquals("paired", (core.current()["state"] as Map<*, *>)["kind"])
  }

  /** The operator's Go live, live 1.5 s on: the start's answer names [PairWire.SID], and the arming writes `broadcast-start`. */
  private fun armed() {
    core.start()
    core.report(Input.Network(true))
    // Ready on every check, as BridgeCoreTest's `ready()`: the hold's POST start goes only then (A11).
    core.readiness(cameraFrames = true, audioPeak = 0.4, pose = Pose.Held(Side.LEFT))
    scheduler.advanceBy(Engine.TICK_MS)
    core.readiness(audioPeak = 0.4)
    paired()
    core.send(mapOf("kind" to "start"))
    scheduler.advanceBy(1_500)
    assertEquals(PairWire.SID, lines("broadcast-start").single().getString("sid"))
  }

  @Test
  fun `a JS reload - the tail carries the pair and broadcast-start lines it has let go of, pair first`() {
    armed()
    probes(25)
    val tail = core.tail()
    assertEquals(listOf(line("pair"), line("broadcast-start")), tail["pins"])
    assertEquals(platform.lines.takeLast(20), (tail["lines"] as List<*>).map { (it as Map<*, *>)["line"] })
  }

  @Test
  fun `a process death - a new core over the same store carries the pins before any line of its own`() {
    armed()
    probes(25)
    val pins = listOf(line("pair"), line("broadcast-start"))
    BridgeCore.resetShared()
    val reborn = build()
    assertEquals(mapOf("pins" to pins, "lines" to emptyList<Any?>()), reborn.tail())
    assertEquals(pins, store.read(RecordPinStore.KEY)?.lines(), "the store holds the lines as written, one a line")
  }

  @Test
  fun `no pairing, no pins - a fresh core carries none and keeps nothing (an empty input)`() {
    probes(25)
    assertEquals(emptyList<Any?>(), pins())
    assertFalse(store.files.containsKey(RecordPinStore.KEY))
    BridgeCore.resetShared()
    assertEquals(emptyList<Any?>(), pins(build()))
  }

  @Test
  fun `after unpair the pins clear - on disk at once, and in the tail once the unpaired line has left it`() {
    core.start()
    core.report(Input.Network(true))
    paired()
    probes(25)
    assertEquals(listOf(line("pair")), pins())
    core.send(mapOf("kind" to "unpair"))
    scheduler.advanceBy(0)
    assertEquals("operator", lines("unpaired").single().getString("reason"))
    assertFalse(store.files.containsKey(RecordPinStore.KEY), "a process death now restores no stale pair")
    assertEquals(listOf(line("pair")), pins(), "the unpaired line is in the tail: JS reads the window's end from it")
    probes(20)
    assertEquals(emptyList<Any?>(), pins())
    BridgeCore.resetShared()
    assertEquals(emptyList<Any?>(), pins(build()))
  }

  @Test
  fun `a second pairing replaces the first's pins, in the tail and on disk`() {
    armed()
    probes(25)
    // Live by now: the operator's Stop ends the broadcast and the reset returns to Idle, where the next code pairs.
    core.send(mapOf("kind" to "stop"))
    scheduler.advanceBy(0)
    core.send(mapOf("kind" to "reset"))
    scheduler.advanceBy(0)
    core.send(PairWire.valid() + ("slot" to 2.0))
    scheduler.advanceBy(0)
    val second = line("pair")
    assertEquals(2, JSONObject(second).getInt("slot"))
    probes(25)
    assertEquals(listOf(second), pins())
    BridgeCore.resetShared()
    assertEquals(listOf(second), pins(build()))
  }

  /** AGENTS §13, class 3: a refused write is a record line, never silent, and the pairing goes on, and so does its end. */
  @Test
  fun `a refused write or delete of the pins is recorded, naming the key, and the pairing goes on`() {
    store.refuseWrites = true
    core.start()
    core.report(Input.Network(true))
    paired()
    core.send(mapOf("kind" to "unpair"))
    scheduler.advanceBy(0)
    assertEquals("idle", (core.current()["state"] as Map<*, *>)["kind"])
    val failed = lines("store-failed").filter { it.getString("key") == RecordPinStore.KEY }
    assertEquals(listOf("write" to "IOException", "delete" to "IOException"), failed.map { it.getString("op") to it.getString("error") })
  }

  @Test
  fun `stored pins no rule can read are no pins, recorded once the engine exists (an empty input)`() {
    val pair = """{"at":"2026-11-16T10:00:00.000Z","kind":"pair","claim":"new","slot":1,"tokenTag":"c980ff38","stopped":false}"""
    val unreadable = listOf("not json", "42", "null", """["pair"]""", """{"kind":7}""", """{"at":"2026-11-16T10:00:00.000Z"}""", "$pair\nnot json")
    val read =
      unreadable.associateWith { text ->
        store.files[RecordPinStore.KEY] = text
        BridgeCore.resetShared()
        val reborn = RecordingPlatform()
        val core = build(reborn)
        scheduler.advanceBy(0)
        pins(core) to lines("store-unreadable", reborn).map { it.getString("key") }
      }
    assertEquals(unreadable.associateWith { emptyList<Any?>() to listOf(RecordPinStore.KEY) }, read)
  }

  @Test
  fun `a read of the pins that throws is no pins, recorded once the engine exists`() {
    store.readFailure = IOException("unreadable")
    BridgeCore.resetShared()
    val reborn = RecordingPlatform()
    val core = build(reborn)
    store.readFailure = null
    scheduler.advanceBy(0)
    assertEquals(emptyList<Any?>(), pins(core))
    val failed = lines("store-failed", reborn).filter { it.getString("key") == RecordPinStore.KEY }
    assertEquals(listOf("read"), failed.map { it.getString("op") })
  }

  @Test
  fun `the tail's lines keep their seqs beside the pins`() {
    armed()
    probes(25)
    val seqs = tailLines().map { ((it as Map<*, *>)["seq"] as Double).toLong() }
    assertEquals(platform.seqs.takeLast(20), seqs)
    assertTrue(seqs.first() > 1)
  }
}
