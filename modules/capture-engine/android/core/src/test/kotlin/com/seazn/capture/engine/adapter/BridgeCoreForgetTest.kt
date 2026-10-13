package com.seazn.capture.engine.adapter

import com.seazn.capture.engine.core.*
import kotlin.test.AfterTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlin.test.assertTrue
import org.json.JSONObject

/**
 * R6 of the D3 findings design: the notification's Forget through the bridge, with the durable marker that a process
 * death reads at the next start, so JS still hears `unpaired: forgotten` and drops the saved code.
 */
class BridgeCoreForgetTest {
  private val clock = FakeClock()
  private val scheduler = FakeScheduler(clock)
  private val store = MemoryStore()

  private fun build(platform: RecordingPlatform = RecordingPlatform()) =
    BridgeCore(clock, scheduler, platform, store, "1.0.0", "Test Phone") { Configs.PHONE_ID }.also { platform.core = it }

  private fun unpaired(core: BridgeCore) = core.current()["unpaired"] as Map<*, *>?

  private fun lines(platform: RecordingPlatform, kind: String) = platform.lines.map(::JSONObject).filter { it.getString("kind") == kind }

  private fun pairedCore(platform: RecordingPlatform = RecordingPlatform()): BridgeCore {
    val core = build(platform)
    core.start()
    core.report(Input.Network(true))
    core.send(PairWire.valid())
    scheduler.advanceBy(0)
    assertEquals("paired", (core.current()["state"] as Map<*, *>)["kind"])
    return core
  }

  @AfterTest fun forgetShared() = BridgeCore.resetShared()

  @Test
  fun `forget while paired - idle, unpaired forgotten, and the marker is on disk`() {
    val core = pairedCore()
    core.forget()
    scheduler.advanceBy(0)
    assertEquals("forgotten", unpaired(core)?.get("reason"))
    assertEquals(true, store.files.containsKey(PairingStore.FORGOTTEN))
  }

  /**
   * Batch 4 review I1: the reborn core names the very pairing the first one left, its tokenTag included. JS forgets a
   * saved code only when code, slot and tag all match (`sameCode`), so a tag that does not round-trip keeps the code.
   */
  @Test
  fun `a new core over the same store starts idle, unpaired forgotten (process death)`() {
    val first = pairedCore()
    first.forget()
    scheduler.advanceBy(0)
    val left = unpaired(first)
    assertEquals(listOf<Any?>("forgotten", PairWire.CODE, 1.0), listOf(left?.get("reason"), left?.get("code"), left?.get("slot")))
    assertEquals(true, (left?.get("tokenTag") as? String)?.isNotEmpty())
    BridgeCore.resetShared()
    val reborn = build()
    assertEquals("idle", (reborn.current()["state"] as Map<*, *>)["kind"])
    assertEquals(left, unpaired(reborn))
  }

  @Test
  fun `the next pair clears the marker`() {
    pairedCore().forget()
    scheduler.advanceBy(0)
    val core = build()
    core.start()
    core.send(PairWire.valid())
    scheduler.advanceBy(0)
    assertEquals(false, store.files.containsKey(PairingStore.FORGOTTEN))
  }

  /** Batch 4 review M7: a marker left on disk would forget the next pairing's code at a cold start; never silent. */
  @Test
  fun `a refused marker clear at the next pair is recorded, naming the marker, and the pair goes ahead`() {
    pairedCore().forget()
    scheduler.advanceBy(0)
    val platform = RecordingPlatform()
    val core = build(platform)
    core.start()
    core.report(Input.Network(true))
    store.refuseWrites = true
    core.send(PairWire.valid())
    scheduler.advanceBy(0)
    assertEquals("paired", (core.current()["state"] as Map<*, *>)["kind"])
    val failed = lines(platform, "store-failed").single()
    assertEquals(listOf("delete", PairingStore.FORGOTTEN), listOf(failed.getString("op"), failed.getString("key")))
  }

  @Test
  fun `an unreadable marker is no marker - the core starts idle with nothing unpaired, and says so (an empty input)`() {
    store.files[PairingStore.FORGOTTEN] = "{not json"
    val platform = RecordingPlatform()
    val core = build(platform)
    assertNull(unpaired(core))
    scheduler.advanceBy(0)
    assertEquals(PairingStore.FORGOTTEN, lines(platform, "store-unreadable").single().getString("key"))
  }

  @Test
  fun `a marker missing a field is no marker`() {
    store.files[PairingStore.FORGOTTEN] = """{"code":"${PairWire.CODE}","slot":1}"""
    assertNull(unpaired(build()))
  }

  @Test
  fun `a marker read that fails is no marker, and is recorded`() {
    store.readFailure = java.io.IOException("unreadable")
    val platform = RecordingPlatform()
    val core = build(platform)
    store.readFailure = null
    assertNull(unpaired(core))
    scheduler.advanceBy(0)
    val failed = lines(platform, "store-failed").single()
    assertEquals(listOf("read", PairingStore.FORGOTTEN), listOf(failed.getString("op"), failed.getString("key")))
  }

  @Test
  fun `a refused marker write is recorded as store-failed, naming the marker, and the unpair still stands`() {
    val platform = RecordingPlatform()
    val core = pairedCore(platform)
    store.refuseWrites = true
    core.forget()
    scheduler.advanceBy(0)
    assertEquals("forgotten", unpaired(core)?.get("reason"))
    val failed = lines(platform, "store-failed").single()
    assertEquals(listOf("write", PairingStore.FORGOTTEN), listOf(failed.getString("op"), failed.getString("key")))
  }

  @Test
  fun `forget while live is ignored - no marker, the broadcast runs on`() {
    val platform = RecordingPlatform()
    val core = pairedCore(platform)
    core.readiness(cameraFrames = true, audioPeak = 0.4, pose = Pose.Held(Side.LEFT))
    scheduler.advanceBy(Engine.TICK_MS)
    core.readiness(audioPeak = 0.4)
    core.send(mapOf("kind" to "start"))
    scheduler.advanceBy(1_500)
    assertEquals("publishing", (core.current()["state"] as Map<*, *>)["kind"])
    core.forget()
    scheduler.advanceBy(0)
    assertEquals("publishing", (core.current()["state"] as Map<*, *>)["kind"])
    assertEquals(false, store.files.containsKey(PairingStore.FORGOTTEN))
    assertTrue(lines(platform, "intent-ignored").any { it.getString("intent") == "forget" })
  }
}
