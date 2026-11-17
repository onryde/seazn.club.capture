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
 * start is kept in the private store, so a new core over the same store (a process death) carries it too, CLOSED (fix
 * round 1 of P1, the controller's ruling): no pair comes back, so no line of the new process files under the dead code.
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

  private fun paired(wire: Map<String, Any?> = PairWire.valid(), of: BridgeCore = core) {
    of.send(wire)
    scheduler.advanceBy(0)
    assertEquals("paired", (of.current()["state"] as Map<*, *>)["kind"])
  }

  private fun kinds(of: BridgeCore) = tailLines(of).map { JSONObject((it as Map<*, *>)["line"] as String).getString("kind") }

  /** A process death: the shared state goes with the process, the store stays. */
  private fun reborn(on: RecordingPlatform = RecordingPlatform()): BridgeCore {
    BridgeCore.resetShared()
    return build(on)
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
  fun `a process death - a new core carries the broadcast-start before any line of its own, closed, with no pair`() {
    armed()
    probes(25)
    val start = line("broadcast-start")
    assertEquals(start, store.read(RecordPinStore.KEY), "the store holds the start alone, as written: never the pair")
    assertEquals(mapOf("pins" to listOf(start), "lines" to emptyList<Any?>()), reborn().tail())
  }

  /**
   * I1 of P1's review: a cold start that does not re-pair (an expired code, Forget, a tap to pair never made) must not
   * leave a window open under the dead code. No pair line is carried, so no line of the new process files under it on
   * the web (A2), and the store is left holding the start alone, so the next start restores it closed again.
   */
  @Test
  fun `restored with no re-pair - later lines open no window, and a second death restores the start closed again`() {
    armed()
    val start = line("broadcast-start")
    val cold = reborn()
    cold.start()
    cold.report(Input.Network(true))
    probes(25, of = cold)
    assertEquals(listOf(start), pins(cold))
    assertFalse("pair" in kinds(cold), "no pair line in the new process's tail")
    assertEquals(start, store.read(RecordPinStore.KEY), "the store implies no open window: no pair line")
    assertEquals(mapOf("pins" to listOf(start), "lines" to emptyList<Any?>()), reborn().tail())
  }

  /**
   * Fix round 2 of P1: a cold start a day after the start was written restores it, and one a millisecond past 24 h does
   * not (`RecordPins.RESTORE_WITHIN_MS`, a hygiene bound counted from the line's write), and keeps it no longer.
   */
  @Test
  fun `a process death restores the start for 24 h after it was written, and not a millisecond longer`() {
    armed()
    val start = line("broadcast-start")
    // The test reads the line's own `at` on the JVM, where java.time exists (the core avoids it: minSdk 24).
    val written = java.time.Instant.parse(JSONObject(start).getString("at")).toEpochMilli()
    clock.wall = written + 86_400_000
    assertEquals(listOf(start), pins(reborn()), "exactly 24 h old")
    clock.wall = written + 86_400_001
    val late = reborn()
    assertEquals(emptyList<Any?>(), pins(late), "older than 24 h")
    probes(25, of = late)
    assertEquals(emptyList<Any?>(), pins(late))
  }

  /** The new process re-pairs: its pair opens a fresh window, as today, and the restored start goes. */
  @Test
  fun `restored then re-paired - the new pair replaces the restored start, in the tail and on disk`() {
    armed()
    val platform = RecordingPlatform()
    val cold = reborn(platform)
    cold.start()
    cold.report(Input.Network(true))
    paired(PairWire.valid() + ("slot" to 2.0), of = cold)
    val again = line("pair", of = platform)
    probes(25, of = cold)
    assertEquals(listOf(again), pins(cold))
    assertFalse(store.files.containsKey(RecordPinStore.KEY), "a pair alone keeps nothing: the restored start is deleted")
    assertEquals(emptyList<Any?>(), pins(reborn()))
  }

  /**
   * R6's Forget whose marker was written before its `unpaired` line (Pairings.kt), then a process death: the core starts
   * Idle naming the Forget, and the pins the last process kept come back closed, here an open window as the build before
   * this fix kept it, its pair first. No window is restored from that pair.
   */
  @Test
  fun `the Forget marker path - idle, forgotten, and the kept pins come back closed, with no pair`() {
    armed()
    val pair = line("pair")
    val start = line("broadcast-start")
    store.files[PairingStore.FORGOTTEN] =
      JSONObject(mapOf("code" to PairWire.CODE, "slot" to 1, "tokenTag" to JSONObject(pair).getString("tokenTag"))).toString()
    store.files[RecordPinStore.KEY] = "$pair\n$start"
    val cold = reborn()
    assertEquals("forgotten", (cold.current()["unpaired"] as Map<*, *>?)?.get("reason"))
    cold.start()
    probes(25, of = cold)
    assertEquals(listOf(start), pins(cold))
    assertFalse("pair" in kinds(cold))
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
    assertFalse(store.files.containsKey(RecordPinStore.KEY), "the first's start is deleted; the second has none yet")
    assertEquals(emptyList<Any?>(), pins(reborn()))
  }

  /** AGENTS §13, class 3: a refused write is a record line, never silent, and the pairing goes on, and so does its end. */
  @Test
  fun `a refused write or delete of the pins is recorded, naming the key, and the pairing goes on`() {
    store.refuseWrites = true
    armed()
    core.send(mapOf("kind" to "stop"))
    scheduler.advanceBy(0)
    assertEquals("ended", (core.current()["state"] as Map<*, *>)["kind"])
    val failed = lines("store-failed").filter { it.getString("key") == RecordPinStore.KEY }
    assertEquals(listOf("write" to "IOException", "delete" to "IOException"), failed.map { it.getString("op") to it.getString("error") })
  }

  /** Each text the store may hold, read as a new core is built: the pins it carries, and the keys of its problem lines. */
  @Test
  fun `stored pins are read by the closed rule, and pins no rule can read are no pins, recorded (an empty input)`() {
    val pair = """{"at":"${IsoTime.utc(clock.wall - 2_000)}","kind":"pair","claim":"new","slot":1,"tokenTag":"c980ff38","stopped":false}"""
    val start = """{"at":"${IsoTime.utc(clock.wall - 1_000)}","kind":"broadcast-start","sid":"${PairWire.SID}","cause":"operator"}"""
    val unreadable = listOf("not json", "42", "null", """["pair"]""", """{"kind":7}""", """{"at":"2026-11-16T10:00:00.000Z"}""", "$pair\nnot json")
    val expected =
      unreadable.associateWith { emptyList<Any?>() to listOf(RecordPinStore.KEY) } +
        mapOf(
          "" to (emptyList<Any?>() to emptyList()),
          "$pair\n" to (emptyList<Any?>() to emptyList()),
          "$start\n\n" to (listOf(start) to emptyList()),
          // An open window as the build before this fix kept it: the start comes back, closed, and the pair does not.
          "$pair\n$start" to (listOf(start) to emptyList()),
        )
    val read =
      expected.keys.associateWith { text ->
        store.files[RecordPinStore.KEY] = text
        val heard = RecordingPlatform()
        val cold = reborn(heard)
        scheduler.advanceBy(0)
        pins(cold) to lines("store-unreadable", heard).map { it.getString("key") }
      }
    assertEquals(expected, read)
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
