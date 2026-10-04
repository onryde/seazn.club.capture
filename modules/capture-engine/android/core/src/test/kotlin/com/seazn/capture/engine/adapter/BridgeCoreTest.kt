package com.seazn.capture.engine.adapter

import com.seazn.capture.engine.core.*
import kotlin.test.AfterTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotSame
import kotlin.test.assertNull
import kotlin.test.assertSame
import kotlin.test.assertTrue
import org.json.JSONObject

/**
 * The engine host every platform uses, driven through the real engine, the real mapping and the
 * real bodies, on the core's fake clock and scheduler. [RecordingPlatform] plays a phone that grants
 * and connects, and [PairWire]'s server.
 */
class BridgeCoreTest {
  private val clock = FakeClock()
  private val scheduler = FakeScheduler(clock)
  private val store = MemoryStore()
  private val platform = RecordingPlatform()
  private val core = build(platform)

  private fun build(on: RecordingPlatform, over: PrivateStore = store, scheduler: Scheduler = this.scheduler, newId: () -> String = { Configs.PHONE_ID }) =
    BridgeCore(clock, scheduler, on, over, "1.0.0", "Test Phone", newId).also { on.core = it }

  private fun state(of: BridgeCore = core) = (of.current()["state"] as Map<*, *>)["kind"]

  private fun telemetry(of: BridgeCore = core) = of.current()["telemetry"] as Map<*, *>

  private fun lines(of: RecordingPlatform = platform) = of.lines.map(::JSONObject)

  private fun kinds(of: RecordingPlatform = platform) = lines(of).map { it.getString("kind") }

  private fun ready(of: BridgeCore = core) = of.readiness(cameraFrames = true, audioPeak = 0.4, pose = Pose.Held(Side.LEFT))

  private fun pair(of: BridgeCore = core, wire: Map<String, Any?> = PairWire.valid()) {
    of.send(wire)
    scheduler.advanceBy(0)
  }

  private fun live() {
    core.start()
    core.report(Input.Network(true))
    ready()
    pair()
    core.send(mapOf("kind" to "start"))
    scheduler.advanceBy(1_500)
  }

  @AfterTest
  fun forgetShared() = BridgeCore.resetShared()

  @Test
  fun `Review Focus 2 the current snapshot is idle before any tick, and live once live`() {
    assertEquals("idle", state())
    live()
    assertEquals("publishing", state())
    // PV19: the broadcast crosses as `broadcast`; the wire has no `session` key.
    assertEquals(PairWire.SID, (core.current()["broadcast"] as Map<*, *>)["sid"])
  }

  @Test
  fun `CD8 an intent's ack comes after the snapshot and the lines it caused, and an unreadable intent is acked too`() {
    core.start()
    core.send(PairWire.valid() + ("seq" to 1.0))
    core.send(mapOf("kind" to "explode", "seq" to 2.0))
    scheduler.advanceBy(0)
    val events = platform.events
    val ack1 = events.indexOf("ack:1")
    val ack2 = events.indexOf("ack:2")
    assertTrue(events.indexOf("snapshot") in 0 until ack1, "the pairing snapshot is out before its ack: $events")
    assertTrue(events.indexOf("line:pair") in 0 until ack1, "and the pair's own line: $events")
    assertTrue(events.indexOf("line:intent-unreadable") in ack1 + 1 until ack2, "the unreadable intent's line, then its ack: $events")
    assertEquals(listOf("ack:1", "ack:2"), events.filter { it.startsWith("ack:") })
  }

  @Test
  fun `carry 27 native answers a stop within one tick`() {
    live()
    core.send(mapOf("kind" to "stop"))
    scheduler.advanceBy(Engine.TICK_MS)
    assertEquals("ended", state())
  }

  @Test
  fun `A5 an accepted pair asks once and holds the service once granted, and a refused pair asks nothing`() {
    core.start()
    pair()
    pair()
    assertEquals(1, platform.executed.count { it == Command.AskPermissions }, "the second pair of the same code is ignored")
    assertEquals(1, platform.executed.count { it == Command.Hold })
    assertEquals("paired", state())
    val other = RecordingPlatform()
    val refusing = build(other)
    refusing.start()
    pair(refusing, PairWire.valid() + ("token" to ""))
    assertEquals("ended", state(refusing))
    assertTrue(Command.AskPermissions !in other.executed, "a malformed pair never reaches the platform")
  }

  @Test
  fun `CD21 a refused permission unpairs, and the next pair asks again`() {
    core.start()
    platform.grant = false
    pair()
    assertEquals("idle", state())
    assertEquals("permissions", ((core.current()["unpaired"]) as Map<*, *>)["reason"])
    platform.grant = true
    pair()
    assertEquals(2, platform.executed.count { it == Command.AskPermissions })
    assertEquals("paired", state())
  }

  @Test
  fun `A11 readiness reported before the pair is replayed into it, so Go live needs no new report`() {
    core.start()
    core.report(Input.Network(true))
    ready()
    pair()
    core.send(mapOf("kind" to "start"))
    scheduler.advanceBy(1_500)
    assertEquals("publishing", state())
  }

  @Test
  fun `P5 re-pairing the same code after an unpair replays readiness again`() {
    core.start()
    core.report(Input.Network(true))
    ready()
    pair()
    core.send(mapOf("kind" to "unpair"))
    scheduler.advanceBy(0)
    pair()
    core.send(mapOf("kind" to "start"))
    scheduler.advanceBy(1_500)
    assertEquals("publishing", state(), "a new PairRequest of the same name is a new pairing")
  }

  @Test
  fun `A11 readiness reaches the machine only when a check changes`() {
    core.start()
    pair()
    val before = platform.lines.size
    core.readiness(audioPeak = 0.40)
    core.readiness(audioPeak = 0.41)
    core.readiness(audioPeak = 0.42)
    scheduler.advanceBy(0)
    val sent = lines().drop(before).filter { it.getString("kind") == "readiness" }
    assertEquals(1, sent.size, "sound turned ready once; the other peaks change no check")
    assertEquals(listOf(false, true, false), listOf(sent[0].getBoolean("camera"), sent[0].getBoolean("sound"), sent[0].getBoolean("held")))
  }

  @Test
  fun `CD37 capture is wanted on the viewfinder while paired, and whenever a broadcast is held`() {
    core.start()
    core.report(Input.Network(true))
    // Ready, so the hold's POST start goes (A11): a start the machine ignores holds nothing.
    ready()
    pair()
    assertEquals(emptyList(), platform.captures, "paired with the phone locked: closed")
    core.viewfinder(true)
    scheduler.advanceBy(0)
    core.viewfinder(false)
    scheduler.advanceBy(0)
    assertEquals(listOf(true, false), platform.captures)
    core.send(mapOf("kind" to "start"))
    scheduler.advanceBy(0)
    assertEquals(listOf(true, false, true), platform.captures, "a go-live opens them from the service")
    assertSame(platform.captureRequests[0], platform.captureRequests[2], "one PairRequest object, which pairFailed compares")
  }

  @Test
  fun `CD37 PV20 a re-pair over a shown viewfinder opens the capture again, for the new pairing, through Pairing`() {
    core.start()
    core.report(Input.Network(true))
    pair()
    core.viewfinder(true)
    scheduler.advanceBy(0)
    pair(wire = PairWire.valid() + ("slot" to 2.0))
    assertEquals("paired", state())
    assertEquals(listOf(true, true), platform.captures, "wanted throughout, so only the pairing changed")
    assertNotSame(platform.captureRequests[0], platform.captureRequests[1], "the new PairRequest, which a later pairFailed names")
    assertEquals(2, platform.captureRequests[1]!!.slot)
  }

  @Test
  fun `CD37 PV20 the capture is held only for a re-pair - a first pair waits for the grant, and a refused re-pair closes it`() {
    core.start()
    core.viewfinder(true)
    platform.ask = false
    pair()
    assertEquals("pairing", state())
    assertEquals(emptyList(), platform.captures, "no camera before the permissions are granted")
    core.send(mapOf("kind" to "unpair"))
    platform.ask = true
    pair()
    assertEquals(listOf(true), platform.captures, "granted and paired, over the shown viewfinder")
    platform.grant = false
    pair(wire = PairWire.valid() + ("slot" to 2.0))
    assertEquals("idle", state())
    assertEquals(listOf(true, true, false), platform.captures, "held for the re-pair, closed by its refusal")
  }

  @Test
  fun `CD21 a request that could not be asked ends the pairing fatal-error and named, never as a refusal`() {
    core.start()
    platform.ask = false
    pair()
    assertEquals("pairing", state())
    core.askFailed(IllegalStateException("no activity"))
    scheduler.advanceBy(0)
    val snapshot = core.current()
    val ended = snapshot["state"] as Map<*, *>
    assertEquals(listOf("ended", "fatal-error"), listOf(ended["kind"], ended["reason"]))
    assertNull(snapshot["unpaired"], "not the permissions panel: nothing was refused")
    assertEquals("IllegalStateException: no activity", lines().single { it.getString("kind") == "ended" }.getString("message"))
  }

  @Test
  fun `CD21 a late askFailed, with no pairing asking, is recorded and ends nothing`() {
    core.start()
    pair()
    core.askFailed(IllegalStateException("late"))
    scheduler.advanceBy(0)
    assertEquals("paired", state())
    assertEquals("IllegalStateException", lines().single { it.getString("kind") == "pair-step-late" }.getString("error"))
  }

  @Test
  fun `P3 the notification's language is the pairing's, then setLanguage's`() {
    core.start()
    assertNull(core.language())
    pair()
    scheduler.advanceBy(1_000)
    assertEquals("fr", core.language())
    core.send(mapOf("kind" to "setLanguage", "language" to "nl"))
    scheduler.advanceBy(1_000)
    assertEquals("nl", core.language())
  }

  @Test
  fun `P11 a failure in work posted for the pairing ends it fatal-error and named, and releases`() {
    core.start()
    pair()
    core.viewfinder(true)
    scheduler.advanceBy(0)
    core.pairFailed(platform.captureRequests.last()!!, IllegalStateException("camera open"))
    scheduler.advanceBy(0)
    val state = core.current()["state"] as Map<*, *>
    assertEquals(listOf("ended", "fatal-error"), listOf(state["kind"], state["reason"]))
    assertTrue(Command.Release in platform.executed)
  }

  @Test
  fun `I4 a camera busy at open is not ready, camera - the pairing stays, and the release asks a reopen`() {
    core.start()
    core.report(Input.Network(true))
    ready()
    pair()
    core.viewfinder(true)
    scheduler.advanceBy(0)
    core.cameraBusy(platform.captureRequests.last()!!)
    // Paired stays Paired, so the camera crosses at the next tick's snapshot.
    scheduler.advanceBy(Engine.TICK_MS)
    assertEquals("paired", state())
    assertEquals("taken", core.current()["camera"])
    assertEquals(false, (core.current()["ready"] as Map<*, *>)["camera"])
    assertTrue("camera-busy" in kinds())
    core.cameraBusy(Configs.pairRequest())
    scheduler.advanceBy(0)
    assertEquals("camera-busy", lines().single { it.getString("kind") == "pair-step-late" }.getString("error"), "another pairing's busy camera is a line only")
    core.report(Input.CameraReleased)
    scheduler.advanceBy(0)
    assertTrue(Command.ReopenCamera in platform.executed)
  }

  @Test
  fun `P11 a late failure for a pairing no longer held is recorded and ends nothing`() {
    live()
    core.pairFailed(Configs.pairRequest(), IllegalStateException("late"))
    scheduler.advanceBy(0)
    assertEquals("publishing", state())
    assertEquals(1, kinds().count { it == "pair-step-late" })
    // The pairing's own request, once it has ended: late too, never a failure of the ended pairing.
    val own = platform.captureRequests.last()!!
    core.send(mapOf("kind" to "stop"))
    scheduler.advanceBy(0)
    assertEquals("ended", state())
    val failedBefore = kinds().count { it == "platform-failed" }
    core.pairFailed(own, IllegalStateException("after the end"))
    scheduler.advanceBy(0)
    assertEquals(2, kinds().count { it == "pair-step-late" })
    assertEquals(failedBefore, kinds().count { it == "platform-failed" })
  }

  @Test
  fun `CD11 a pairing failure heals at the next pair of the same code`() {
    core.start()
    core.report(Input.Network(true))
    ready()
    pair()
    core.viewfinder(true)
    scheduler.advanceBy(0)
    core.pairFailed(platform.captureRequests.last()!!, IllegalStateException("camera open"))
    scheduler.advanceBy(0)
    core.send(mapOf("kind" to "reset"))
    scheduler.advanceBy(0)
    pair()
    core.send(mapOf("kind" to "start"))
    scheduler.advanceBy(1_500)
    assertEquals("publishing", state())
  }

  @Test
  fun `carry 18 a linkage error from a connect ends the pairing fatal-error and stays sticky`() {
    platform.throwOnConnect = UnsatisfiedLinkError("libsrt.so not found")
    live()
    assertEquals("ended", state())
    val ended = lines().single { it.getString("kind") == "ended" }
    assertEquals("UnsatisfiedLinkError: libsrt.so not found", ended.getString("message"))
    assertTrue("command-failed" !in kinds(), "classified where the command is routed, never counted as a command's failure")
  }

  @Test
  fun `review 13 I1 a process failure held refuses the next pairing at its ask, before any Hold or beat`() {
    platform.throwOnConnect = UnsatisfiedLinkError("libsrt.so not found")
    live()
    val beats = platform.beats().size
    core.send(mapOf("kind" to "reset"))
    scheduler.advanceBy(0)
    pair()
    assertEquals(listOf("ended", "fatal-error"), (core.current()["state"] as Map<*, *>).let { listOf(it["kind"], it["reason"]) })
    assertEquals(1, platform.executed.count { it == Command.AskPermissions }, "the second ask never reaches the platform")
    assertEquals(1, platform.executed.count { it == Command.Hold })
    assertEquals(beats, platform.beats().size, "no claim beat for a slot it cannot broadcast on")
  }

  @Test
  fun `Task 13 m4 a command's ordinary failure is counted where it ran, and the pairing carries on`() {
    platform.throwOn = { if (it == Command.Hold) IllegalStateException("no service") else null }
    core.start()
    pair()
    assertEquals("paired", state())
    assertTrue(lines().single { it.getString("kind") == "command-failed" }.getString("message").startsWith("Hold: java.lang.IllegalStateException"))
  }

  @Test
  fun `carry 15 an Error at the task boundary is recorded and the scheduler lives on`() {
    core.start()
    platform.throwOnFactsOnce = StackOverflowError("facts")
    scheduler.advanceBy(Engine.TICK_MS)
    assertTrue(lines().any { it.getString("kind") == "engine-error" && "StackOverflowError" in it.getString("message") })
    val before = platform.snapshots.size
    scheduler.advanceBy(Engine.TICK_MS * 4)
    assertEquals(before + 4, platform.snapshots.size, "every later tick still publishes")
    assertEquals(1.0, telemetry()["taskFailures"], "the guard's count crosses to Diagnostics")
  }

  @Test
  fun `CD11 a permanent failure at the task boundary ends the pairing fatal-error, and holds for the process`() {
    live()
    platform.throwOnLink = UnsatisfiedLinkError("libbistats.so not found")
    scheduler.advanceBy(Engine.TICK_MS * 2)
    assertEquals(listOf("ended", "fatal-error"), (core.current()["state"] as Map<*, *>).let { listOf(it["kind"], it["reason"]) })
    assertTrue(lines().any { it.getString("kind") == "engine-error" && "UnsatisfiedLinkError" in it.getString("message") })
    core.send(mapOf("kind" to "reset"))
    scheduler.advanceBy(0)
    pair()
    assertEquals("ended", state(), "sticky for the process: the next pairing is refused at its ask")
    assertEquals(1, platform.executed.count { it == Command.AskPermissions })
  }

  @Test
  fun `review 13 I2 a record sink that throws an Error is caught once and its reporter once - the queue drains`() {
    core.start()
    scheduler.advanceBy(0)
    platform.throwOnLine = StackOverflowError("sink")
    core.log("info", "probe", emptyMap())
    // A reporter that posted its own line would come back here for ever; the scheduler's task cap ends that as a failure.
    scheduler.advanceBy(0)
    platform.throwOnLine = null
    scheduler.advanceBy(Engine.TICK_MS)
    assertEquals(listOf(1.0, 1.0), listOf(telemetry()["taskFailures"], telemetry()["reporterFailures"]))
    assertEquals(1, scheduler.pending, "only the next tick waits")
  }

  @Test
  fun `G3 a reader that throws on every read writes one engine-error line a minute, with the count it held back`() {
    live()
    platform.answer = PairWire::answerLive
    platform.throwOnLink = IllegalStateException("bistats")
    // Link reads run every 1 000 ms from the Connected at 0: the first to throw is at 2 000, the last
    // within ten minutes at 601 000. 600 throws; a window opens at 2 000 + 60 000 k, k = 0 to 9.
    scheduler.advanceBy(600_000)
    assertTrue(state() in setOf("publishing", "degraded"), "the reader's failure is not the broadcast's: ${state()}")
    val written = lines().filter { it.getString("kind") == "engine-error" }
    assertEquals(List(10) { "IllegalStateException: bistats" }, written.map { it.getString("message") })
    assertEquals(listOf(0) + List(9) { 59 }, written.map { it.getInt("suppressed") })
    assertEquals(600.0, telemetry()["taskFailures"], "every throw is still counted")
  }

  @Test
  fun `G3 at most sixteen distinct failures are written a minute, and the rest are counted on the next window's first line`() {
    val errors = ErrorLines()
    val written = (1..20).mapNotNull { n -> errors.line(n.toLong(), "failure $n") }
    assertEquals((1..ErrorLines.MAX_DISTINCT).map { "failure $it" }, written.map { it.fields.toMap()["message"] })
    assertEquals(null, errors.line(ErrorLines.WINDOW_MS, "failure 1"), "one window from the first line, less a millisecond: still held")
    val next = errors.line(ErrorLines.WINDOW_MS + 1, "failure 1")
    assertEquals(mapOf("message" to "failure 1", "suppressed" to 5), next?.fields?.toMap(), "four over the cap, then the repeat")
  }

  @Test
  fun `G0-d the code is asked with its slot and this phone's id`() {
    live()
    val asked = platform.http.single { it.url.startsWith("${PairWire.ORIGIN}?") }
    assertEquals("${PairWire.ORIGIN}?slot=1&phone=${Configs.PHONE_ID}", asked.url)
  }

  @Test
  fun `A17 the operator's Stop is stored before the end, and rides the next pairing's first beat`() {
    live()
    var atEnd: String? = null
    platform.onExecute = { if (it is Command.End) atEnd = store.files[PairingStore.STOPPED] }
    core.send(mapOf("kind" to "stop"))
    scheduler.advanceBy(0)
    assertTrue(PairWire.SID in atEnd.orEmpty(), "written, synchronously, before the End ran: $atEnd")
    core.send(mapOf("kind" to "reset"))
    scheduler.advanceBy(0)
    platform.http.clear()
    pair()
    assertEquals(PairWire.SID, JSONObject(platform.beats().first().body!!).getString("stopped"))
  }

  @Test
  fun `a refused write is a record line, and the end still happens`() {
    live()
    store.refuseWrites = true
    core.send(mapOf("kind" to "stop"))
    scheduler.advanceBy(0)
    assertEquals("ended", state())
    val failed = lines().single { it.getString("kind") == "store-failed" }
    assertEquals(listOf("write", "IOException"), listOf(failed.getString("op"), failed.getString("error")))
    assertTrue(platform.executed.any { it is Command.End }, "the End behind the refused write still ran")
    // Engine.execute would run the End past a throw anyway, as `command-failed`: the refusal is its own line instead.
    assertEquals(emptyList(), kinds().filter { it == "command-failed" || it == "engine-error" }, "one line for the refusal, named")
  }

  @Test
  fun `PV21 the phone id is made once and kept across engines over the same storage`() {
    var made = 0
    val counting = { made += 1; "phone-test-id-000$made" }
    val first = RecordingPlatform()
    val one = build(first, newId = counting)
    one.start()
    pair(one)
    val again = RecordingPlatform()
    val two = build(again, newId = counting)
    two.start()
    pair(two)
    val ids = (first.beats() + again.beats()).map { JSONObject(it.body!!).getString("phone") }
    assertEquals(2, ids.size)
    assertEquals(setOf("phone-test-id-0001"), ids.toSet(), "the restarted engine reads the id the first one made")
    assertEquals(1, made)
  }

  @Test
  fun `carry 12 a forwarded JS line is written through the scheduler, its level kept and a level field renamed`() {
    core.start()
    core.log("warn", "intent.stop", mapOf("level" to "x", "count" to 3.0, "ms" to 2.25))
    assertTrue(platform.lines.none { "intent.stop" in it }, "not written before the scheduler runs it")
    scheduler.advanceBy(0)
    val line = JSONObject(platform.lines.single { "intent.stop" in it })
    assertEquals("warn", line.getString("level"))
    // Renamed, and masked: a field called `level` is on no allow-list (Task 10).
    assertEquals("***", line.getString("field_level"))
    // P6: `get`, not `getInt`, which would coerce 3.0 and let the mutant through.
    assertEquals(3, line.get("count"))
    // Decimal.tenths: Math.round(2.25 × 10) = Math.round(22.5) = 23, so 2.3.
    assertEquals(2.3, line.getDouble("ms"), "a fraction is written to tenths, like every native number")
  }

  @Test
  fun `C1 M3 a level outside the logger's four is info, never masked, and each of the four is kept`() {
    core.start()
    for (level in listOf("loud", "debug", "info", "warn", "error")) core.log(level, "probe.$level", emptyMap())
    scheduler.advanceBy(0)
    val levels = lines().filter { it.getString("kind").startsWith("probe.") }.associate { it.getString("kind") to it.optString("level", "info") }
    assertEquals(mapOf("probe.loud" to "info", "probe.debug" to "debug", "probe.info" to "info", "probe.warn" to "warn", "probe.error" to "error"), levels)
  }

  @Test
  fun `Task 11 an intent that maps to nothing is recorded by its kind, never dropped`() {
    core.start()
    pair()
    core.send(mapOf("kind" to "explode"))
    core.send(mapOf("kind" to "setAutomatic"))
    core.send(mapOf("kind" to "setLanguage", "language" to 7.0))
    scheduler.advanceBy(0)
    assertEquals(listOf("explode", "setAutomatic", "setLanguage"), lines().filter { it.getString("kind") == "intent-unreadable" }.map { it.getString("intent") })
    assertEquals("paired", state())
  }

  @Test
  fun `Task 11 gap 1 an intent whose own task throws is still acked`() {
    core.start()
    store.readFailure = StackOverflowError("storage")
    core.send(PairWire.valid() + ("seq" to 7.0))
    scheduler.advanceBy(0)
    assertTrue("ack:7" in platform.events, "the kit never waits on a timeout: ${platform.events}")
    assertTrue(lines().any { it.getString("kind") == "engine-error" && "StackOverflowError" in it.getString("message") })
  }

  @Test
  fun `C0b every POST start is answered - a throw at the send, or no answer at all, frees the next hold`() {
    core.start()
    core.report(Input.Network(true))
    ready()
    pair()
    platform.throwOnHttp = { if (it.url.endsWith("/start")) java.io.IOException("reset") else null }
    core.send(mapOf("kind" to "start"))
    scheduler.advanceBy(Engine.TICK_MS)
    assertEquals("start-failed", core.current()["refusal"], "a throw at the send is the start's failure")
    platform.throwOnHttp = { null }
    platform.unanswered = { it.url.endsWith("/start") }
    core.send(mapOf("kind" to "start"))
    scheduler.advanceBy(0)
    core.send(mapOf("kind" to "start"))
    scheduler.advanceBy(BridgeCore.ANSWER_BACKSTOP_MS - 1)
    assertEquals(2, platform.http.count { it.url.endsWith("/start") }, "a start in flight holds the next")
    scheduler.advanceBy(1)
    core.send(mapOf("kind" to "start"))
    scheduler.advanceBy(0)
    assertEquals(3, platform.http.count { it.url.endsWith("/start") }, "the lost answer is answered, so the hold is free")
  }

  @Test
  fun `C0b an answer is given once - the platform's own, after the backstop answered, never reaches the engine`() {
    core.start()
    core.report(Input.Network(true))
    ready()
    pair()
    platform.unanswered = { it.url.endsWith("/start") }
    core.send(mapOf("kind" to "start"))
    scheduler.advanceBy(BridgeCore.ANSWER_BACKSTOP_MS)
    val (request, late) = platform.owed.single()
    late(PairWire.answer(request))
    scheduler.advanceBy(Engine.TICK_MS)
    val answered = lines().filter { it.getString("kind") == "start-answered" }
    assertEquals(1, answered.size, "the backstop's answer only: $answered")
    assertFalse(answered.single().has("late"), "the late open answer would arm a broadcast the operator gave up on")
    assertEquals("paired", state())
  }

  @Test
  fun `C0b the backstop sits past the client's timeout and every core give-up, so a real answer comes first`() {
    // HttpRequests.TIMEOUT_MS is the client's; Heartbeat.TIMEOUT_MS and DeliveryWatch's are the core's.
    assertTrue(BridgeCore.ANSWER_BACKSTOP_MS > HttpRequests.TIMEOUT_MS)
    assertTrue(BridgeCore.ANSWER_BACKSTOP_MS > Heartbeat.TIMEOUT_MS)
    assertTrue(BridgeCore.ANSWER_BACKSTOP_MS > DeliveryWatch.REQUEST_TIMEOUT_MS)
  }

  @Test
  fun `C0b the tick runs on after the end until the final beat releases the service`() {
    live()
    platform.unanswered = { it.url.endsWith("/beats") }
    core.send(mapOf("kind" to "stop"))
    scheduler.advanceBy(Heartbeat.TIMEOUT_MS - Engine.TICK_MS)
    assertEquals("ended", state())
    assertTrue(Command.Release !in platform.executed, "the final beat holds the service")
    scheduler.advanceBy(Engine.TICK_MS)
    assertEquals(1, platform.executed.count { it == Command.Release })
    assertEquals("timeout", lines().single { it.getString("kind") == "final-beat" }.getString("result"))
    scheduler.advanceBy(BridgeCore.ANSWER_BACKSTOP_MS)
    assertEquals(1, platform.executed.count { it == Command.Release }, "the backstop's late answer releases nothing twice")
  }

  @Test
  fun `C0b a paired beat carries battery null until a device sample`() {
    core.start()
    pair()
    val beat = JSONObject(platform.beats().single().body!!)
    assertTrue(beat.has("battery") && beat.isNull("battery"), "$beat")
  }

  @Test
  fun `G4 a connect failure the machine ignores is recorded as an ignored input`() {
    live()
    core.report(Input.ConnectFailed(platform.attempt, ConnectFailure.OTHER, "late"))
    scheduler.advanceBy(0)
    val ignored = lines().single { it.getString("kind") == "connect-failed-ignored" }
    assertEquals(listOf(platform.attempt, "other", "on-air"), listOf(ignored.getInt("attempt"), ignored.getString("failure"), ignored.getString("phase")))
    assertEquals("publishing", state())
  }

  @Test
  fun `m7 an input's message never prints, and reaches a line only masked`() {
    val url = "rtmps://live.stg.seazn.club:443/live/${Configs.STREAM_KEY}"
    val inputs = listOf(Input.ConnectFailed(3, ConnectFailure.OTHER, url), Input.Dropped(3, DropReason.ENDPOINT_CLOSED, url), Input.PlatformFailed(3, url))
    for (input in inputs) {
      assertFalse(Configs.STREAM_KEY in input.toString(), "$input")
      assertTrue("attemptId=3" in input.toString() && "<${url.length} chars>" in input.toString(), "$input")
    }
    live()
    core.report(Input.Dropped(platform.attempt, DropReason.ENDPOINT_CLOSED, url))
    scheduler.advanceBy(0)
    assertTrue(platform.lines.none { Configs.STREAM_KEY in it })
    assertEquals("rtmps://live.stg.seazn.club:443/live/***", lines().single { it.getString("kind") == "dropped" }.getString("message"))
  }

  @Test
  fun `C1 every kind and key BridgeCore writes is decided by the allow-list`() {
    val list = Shared.read("scrub/allow-list.json")
    val decided = listOf("plain", "publicUrl", "text", "reserved").flatMap { key -> list.getJSONArray(key).let { a -> (0 until a.length()).map(a::getString) } }.toSet() + list.getJSONObject("scalars").keySet()
    store.files[PairingStore.STOPPED] = "not json"
    live()
    core.send(mapOf("kind" to "explode"))
    core.askFailed(IllegalStateException("late"))
    core.cameraBusy(platform.captureRequests.last()!!)
    core.report(Input.ConnectFailed(platform.attempt, ConnectFailure.OTHER, "late"))
    platform.throwOnFactsOnce = StackOverflowError("facts")
    scheduler.advanceBy(Engine.TICK_MS)
    store.refuseWrites = true
    core.send(mapOf("kind" to "stop"))
    scheduler.advanceBy(Engine.TICK_MS)
    val ours = setOf("readiness", "intent-unreadable", "pair-step-late", "camera-busy", "store-failed", "store-unreadable", "engine-error", "connect-failed-ignored")
    val written = lines()
    assertEquals(ours, ours.intersect(written.map { it.getString("kind") }.toSet()), "each of BridgeCore's kinds was written here")
    val undecided = written.flatMap { line -> listOfNotNull(line.getString("kind").takeUnless { it in list.getJSONObject("kinds").keySet() }) + line.keySet().filterNot { it in decided } }
    assertEquals(emptyList(), undecided, "of ${written.size} lines")
  }

  @Test
  fun `CD33 a tick that comes late while paired is recorded with its gap`() {
    var stall = false
    val slow =
      object : Scheduler {
        override fun schedule(delayMs: Long, task: () -> Unit): Cancellable =
          scheduler.schedule(if (stall && delayMs == Engine.TICK_MS) 2_000 else delayMs, task)
      }
    val late = RecordingPlatform()
    val stalled = build(late, MemoryStore(), slow)
    stalled.start()
    stalled.send(PairWire.valid())
    scheduler.advanceBy(Engine.TICK_MS)
    stall = true
    // The tick already due runs on time and schedules the next 2 000 ms out: one gap of 2 000 ms.
    scheduler.advanceBy(Engine.TICK_MS + 2_000)
    assertEquals(listOf(2_000L), lines(late).filter { it.getString("kind") == "tick-late" }.map { it.getLong("gapMs") })
  }

  @Test
  fun `CD33 video that stops moving while live is one frames-gap line with its length`() {
    live()
    // Reads run every 500 ms from the Connected at 0; the last one at 1 500 moved the count.
    platform.frozen = true
    scheduler.advanceBy(1_500)
    platform.frozen = false
    scheduler.advanceBy(500)
    // Last moved at 1 500, moved again at 3 500: 2 000 ms.
    val gap = lines().single { it.getString("kind") == "frames-gap" }
    assertEquals(2_000L, gap.getLong("gapMs"))
  }

  @Test
  fun `carry 18 one engine per process`() {
    BridgeCore.resetShared()
    var built = 0
    val first = BridgeCore.shared { built += 1; core }
    val second = BridgeCore.shared { built += 1; core }
    assertSame(first, second)
    assertEquals(1, built)
  }
}
