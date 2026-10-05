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

  private fun readyOn(of: BridgeCore) = (of.current()["ready"] as Map<*, *>).mapKeys { it.key as String }

  /**
   * Ready on every check. Sound is held (I-1): it turns at a reading at least 300 ms into its run, so
   * this reads twice, a tick apart, as the glue does (every 500 ms), which keeps the tests on the tick.
   */
  private fun ready(of: BridgeCore = core) {
    of.readiness(cameraFrames = true, audioPeak = 0.4, pose = Pose.Held(Side.LEFT))
    scheduler.advanceBy(Engine.TICK_MS)
    of.readiness(audioPeak = 0.4)
  }

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
    // Final review I-1: the pose is the pairing's; the new pairing's tracker reports the phone held sideways.
    core.readiness(pose = Pose.Held(Side.LEFT))
    core.send(mapOf("kind" to "start"))
    scheduler.advanceBy(1_500)
    assertEquals("publishing", state(), "a new PairRequest of the same name is a new pairing")
  }

  /**
   * Final review I-1: the pose is the pairing's. The glue's pose watch stops at Release and starts at Hold with a
   * tracker that reports only changes, so a second pairing in one process hears no pose until the phone moves.
   * It must start not held: match 2's phone laid flat is never read as held, and Go live waits for a held report.
   */
  @Test
  fun `final I-1 a second pairing starts not held, and Go live waits for a held report of its own`() {
    core.start()
    core.report(Input.Network(true))
    ready()
    pair()
    assertEquals("paired", state())
    assertEquals(true, readyOn(core)["held"], "pairing 1 is held")
    core.send(mapOf("kind" to "unpair"))
    scheduler.advanceBy(0)
    val after = lines().size
    pair()
    scheduler.advanceBy(Engine.TICK_MS)
    assertEquals("paired", state())
    assertEquals(mapOf("camera" to true, "sound" to true, "network" to true, "held" to false), readyOn(core), "pairing 2: held alone is not ready")
    val heard = lines().drop(after).filter { it.getString("kind") == "readiness" }
    assertTrue(heard.isNotEmpty(), "pairing 2 heard its readiness")
    assertTrue(heard.none { it.getBoolean("held") }, "pairing 2 never heard pairing 1's pose: $heard")
    core.send(mapOf("kind" to "start"))
    scheduler.advanceBy(1_500)
    assertEquals("paired", state(), "Go live refused on held")
    // The positive pair: a held report of pairing 2's own opens it.
    core.readiness(pose = Pose.Held(Side.RIGHT))
    scheduler.advanceBy(Engine.TICK_MS)
    assertEquals(true, readyOn(core)["held"], "held once pairing 2's tracker says so")
    core.send(mapOf("kind" to "start"))
    scheduler.advanceBy(1_500)
    assertEquals("publishing", state())
  }

  /**
   * Review C4a I-3: each check alone, on a core of its own, paired with nothing ready. Each row turns its
   * check and repeats it: one line, and the machine hears the turn (the snapshot's check turns, alone).
   * One line is one send: `sendReadiness` writes the line and sends the input together.
   */
  @Test
  fun `A11 I-3 each check alone reaches the machine once, as one line, and a repeat of it reaches nothing`() {
    val rows: List<Pair<String, (BridgeCore) -> Unit>> =
      listOf(
        "camera" to { c ->
          c.readiness(cameraFrames = true)
          c.readiness(cameraFrames = true)
        },
        "sound" to { c ->
          c.readiness(audioPeak = 0.40)
          scheduler.advanceBy(HOLD_MS)
          c.readiness(audioPeak = 0.41)
          scheduler.advanceBy(Engine.TICK_MS)
          c.readiness(audioPeak = 0.42)
        },
        "held" to { c ->
          c.readiness(pose = Pose.Held(Side.RIGHT))
          c.readiness(pose = Pose.Held(Side.RIGHT))
        },
      )
    var checked = 0
    for ((check, turn) in rows) {
      val on = RecordingPlatform()
      val row = build(on, MemoryStore())
      row.start()
      pair(row)
      val before = on.lines.size
      val was = readyOn(row)
      assertEquals(mapOf("camera" to false, "sound" to false, "network" to false, "held" to false), was, check)
      turn(row)
      // The readiness is not in the snapshot's state, so the next tick publishes it.
      scheduler.advanceBy(Engine.TICK_MS)
      val sent = lines(on).drop(before).filter { it.getString("kind") == "readiness" }
      assertEquals(1, sent.size, "$check: one line for the turn, none for the repeat")
      val checks = listOf("camera", "sound", "held")
      assertEquals(checks.associateWith { it == check }, checks.associateWith(sent.single()::getBoolean), check)
      assertEquals(was + (check to true), readyOn(row), "$check: the machine heard it, and only it")
      checked += 1
    }
    assertEquals(3, checked, "the table's own count")
  }

  /** Review C4a I-1: the reviewer's flap, 0.049 and 0.051 a reading apart, every 500 ms for ten minutes. */
  @Test
  fun `I-1 a peak hovering at the floor for ten minutes writes no readiness line, and the tail keeps the line before it`() {
    core.start()
    core.report(Input.Network(true))
    core.readiness(cameraFrames = true, pose = Pose.Held(Side.LEFT))
    pair()
    core.log("info", "probe.before", emptyMap())
    scheduler.advanceBy(0)
    val before = lines().count { it.getString("kind") == "readiness" }
    var readings = 0
    repeat(1_200) { n ->
      core.readiness(audioPeak = if (n % 2 == 0) 0.049 else 0.051)
      scheduler.advanceBy(Engine.TICK_MS)
      readings += 1
    }
    assertEquals(1_200, readings, "the sweep's own count")
    assertEquals(0, lines().count { it.getString("kind") == "readiness" } - before, "the flap never turns sound, so it writes nothing")
    assertTrue(core.tail().any { "probe.before" in it["line"] as String }, "the line before the flap is still in the tail: ${core.tail()}")
    assertEquals(false, readyOn(core)["sound"])
  }

  /**
   * Review C4a I-1, the second guard alone: each level read twice, 300 ms apart, then held to the
   * second's end, so sound turns past the hold once a second, 600 times in ten minutes, each turn
   * published by the tick after it. At most six readiness lines a minute, and the first of each later
   * minute carries the count held back since the last one written; every turn still reaches the
   * machine. By hand: minute 1 opens at the pair's line (0 ms) and writes it and the turns at 300 to
   * 4 300 ms, then holds back the 55 turns from 5 300 to 59 300 ms. Minute m + 1 opens at the tick at
   * 60 000m ms with the current state and those 55 (N-1's flush), writes the five turns after it and
   * holds back the next 55; the tick at 600 000 ms flushes the last 55.
   */
  @Test
  fun `I-1 a check that turns past the hold writes at most six readiness lines a minute, and every turn reaches the machine`() {
    core.start()
    val before = platform.lines.size
    pair()
    var heard = 0
    for (k in 0 until 600) {
      val level = if (k % 2 == 0) 0.4 else 0.0
      core.readiness(audioPeak = level)
      scheduler.advanceBy(HOLD_MS)
      core.readiness(audioPeak = level)
      scheduler.advanceBy(1_000 - HOLD_MS)
      if (readyOn(core)["sound"] == (level == 0.4)) heard += 1
    }
    assertEquals(600, heard, "every turn reached the machine, written or not")
    val written = lines().drop(before).filter { it.getString("kind") == "readiness" }
    val heldBack = List(6) { 0 } + (1..9).flatMap { listOf(55) + List(5) { 0 } } + listOf(55)
    assertEquals(heldBack, written.map { it.getInt("suppressed") }, "61 lines: six a minute for ten minutes, and the last minute's flush")
  }

  private fun checksOf(line: JSONObject) = listOf("camera", "sound", "held").associateWith(line::getBoolean)

  private fun machineChecks() = readyOn(core).filterKeys { it != "network" }

  /** The glue's reading, twice a hold apart and then to the second's end, so a level turns sound once a second. */
  private fun turnSound(level: Double, camera: Boolean? = null) {
    core.readiness(cameraFrames = camera, audioPeak = level)
    scheduler.advanceBy(HOLD_MS)
    core.readiness(cameraFrames = camera, audioPeak = level)
    scheduler.advanceBy(1_000 - HOLD_MS)
  }

  /**
   * Review C4a N-1 (ruling C4a-N1), the reviewer's first probe: a minute's six lines spent, the sixth
   * sound change is held back, and the room goes quiet for five minutes. The tick after the minute
   * runs out writes the state the machine holds, with the one held back; a state that stays, with
   * nothing held back, writes nothing more.
   */
  @Test
  fun `N-1 a turn held back is written once its minute runs out, and a quiet room writes nothing more`() {
    core.start()
    val before = platform.lines.size
    pair()
    for (k in 0 until 6) turnSound(if (k % 2 == 0) 0.4 else 0.0)
    val lastChangeMs = clock.monotonicMs() - 1_000 + HOLD_MS
    val readiness = { lines().drop(before).filter { it.getString("kind") == "readiness" } }
    assertEquals(6, readiness().size, "the pair's line and five turns; the sixth is held back")
    assertEquals(mapOf("camera" to false, "sound" to false, "held" to false), machineChecks(), "the machine heard the sixth")
    assertEquals(true, readiness().last().getBoolean("sound"), "the record has not, yet")
    var quiet = 0
    while (clock.monotonicMs() < lastChangeMs + 60_000) {
      core.readiness(audioPeak = 0.0)
      scheduler.advanceBy(Engine.TICK_MS)
      quiet += 1
    }
    val flushed = readiness()
    assertEquals(7, flushed.size, "one line for the minute that ran out")
    assertEquals(machineChecks(), checksOf(flushed.last()), "within 60 s, the record's last line is the machine's state")
    assertEquals(1, flushed.last().getInt("suppressed"))
    while (clock.monotonicMs() < lastChangeMs + 300_000) {
      core.readiness(audioPeak = 0.0)
      scheduler.advanceBy(Engine.TICK_MS)
      quiet += 1
    }
    assertTrue(quiet >= 590, "five minutes of quiet readings: $quiet")
    assertEquals(7, readiness().size, "a stable state with nothing held back writes no more lines")
  }

  /**
   * Review C4a N-1, the reviewer's second probe: the pair's line and five changes (camera, held, and
   * sound three times) spend the minute, then the camera dies and stays dead. The death is held back,
   * and written by the tick after the minute runs out; a camera that stays dead writes nothing more.
   */
  @Test
  fun `N-1 a camera that dies after the minute's lines are spent reaches the record within 60 s`() {
    core.start()
    val before = platform.lines.size
    pair()
    core.readiness(cameraFrames = true)
    scheduler.advanceBy(1_000)
    core.readiness(pose = Pose.Held(Side.LEFT))
    scheduler.advanceBy(1_000)
    for (k in 0 until 3) turnSound(if (k % 2 == 0) 0.4 else 0.0)
    core.readiness(cameraFrames = false)
    val diedMs = clock.monotonicMs()
    scheduler.advanceBy(Engine.TICK_MS)
    val readiness = { lines().drop(before).filter { it.getString("kind") == "readiness" } }
    assertEquals(6, readiness().size, "the pair's line and five changes; the death is held back")
    assertEquals(mapOf("camera" to true, "sound" to true, "held" to true), checksOf(readiness().last()), "the record's last line has the camera, yet")
    assertEquals(mapOf("camera" to false, "sound" to true, "held" to true), machineChecks(), "the machine knows it died")
    while (clock.monotonicMs() < diedMs + 60_000) {
      core.readiness(cameraFrames = false, audioPeak = 0.4)
      scheduler.advanceBy(Engine.TICK_MS)
    }
    assertEquals(7, readiness().size, "one line for the minute that ran out")
    assertEquals(machineChecks(), checksOf(readiness().last()), "within 60 s, the record's last line is the machine's state")
    assertEquals(1, readiness().last().getInt("suppressed"))
    repeat(480) {
      core.readiness(cameraFrames = false, audioPeak = 0.4)
      scheduler.advanceBy(Engine.TICK_MS)
    }
    assertEquals(7, readiness().size, "a camera that stays dead, with nothing held back, writes no more lines")
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
    // The close silenced sound (C4a carry, Task 33): the meter reads again before the go-live.
    ready()
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

  /**
   * Review C4a m-1: a tick can end a broadcast with no input after it. Here the outage hold runs out:
   * the connects all fail and no request is ever answered, so nothing but the tick moves the phase,
   * and the end must still close the capture the broadcast held open.
   */
  @Test
  fun `m-1 a tick that ends the broadcast closes the capture, with no input after it`() {
    live()
    assertEquals(listOf(true), platform.captures, "the go-live opened it")
    platform.throwOnConnect = IllegalStateException("no route")
    platform.unanswered = { true }
    platform.dropCurrent()
    scheduler.advanceBy(0)
    assertTrue(core.current()["broadcast"] != null, "the drop holds the broadcast")
    var ticks = 0
    while (core.current()["broadcast"] != null) {
      scheduler.advanceBy(Engine.TICK_MS)
      ticks += 1
      assertTrue(ticks < 2_000, "the hold never ran out: ${state()}")
    }
    assertEquals(listOf(true, false), platform.captures, "the tick that ended it closed it: ${state()} after $ticks ticks")
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
    // The failed pairing's end closed the capture and silenced sound (C4a carry, Task 33); the re-pair
    // over the shown viewfinder opens it again, and its meter reads before the hold.
    ready()
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
    // Review C4a m-8: the failure held crosses to Diagnostics, and no command is counted as failed.
    assertEquals(listOf(true, 0.0), listOf(telemetry()["stickyFailure"], telemetry()["commandFailures"]))
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
    assertEquals(listOf(0.0, false), listOf(telemetry()["commandFailures"], telemetry()["stickyFailure"]))
    pair()
    assertEquals("paired", state())
    assertTrue(lines().single { it.getString("kind") == "command-failed" }.getString("message").startsWith("Hold: java.lang.IllegalStateException"))
    // Review C4a m-8: counted where Diagnostics reads it; an ordinary failure holds nothing.
    assertEquals(listOf(1.0, false), listOf(telemetry()["commandFailures"], telemetry()["stickyFailure"]))
  }

  @Test
  fun `I-2 a facts read that throws every time keeps the snapshots going on the last good facts, with one line, and counts each`() {
    live()
    assertEquals(listOf(0.5, 0.0), listOf(telemetry()["audioLevel"], telemetry()["snapshotFailures"]), "the good facts, before")
    platform.throwOnFacts = IllegalStateException("thermal")
    val before = platform.snapshots.size
    scheduler.advanceBy(20 * Engine.TICK_MS)
    val sent = platform.snapshots.size - before
    assertTrue(sent >= 20, "a snapshot each tick at least, still: $sent")
    assertEquals(sent.toDouble(), telemetry()["snapshotFailures"], "each one sent over the last good facts is counted")
    assertEquals(0.5, telemetry()["audioLevel"], "the last good facts, never the defaults")
    val written = lines().filter { it.getString("kind") == "engine-error" }
    assertEquals(listOf("facts: IllegalStateException: thermal"), written.map { it.getString("message") }, "one line a minute (G3)")
    platform.throwOnFacts = null
    scheduler.advanceBy(Engine.TICK_MS)
    assertEquals(sent.toDouble(), telemetry()["snapshotFailures"], "a good read again counts nothing")
  }

  @Test
  fun `I-2 a snapshot the bridge refused is counted, and the next one says so`() {
    core.start()
    platform.throwOnSnapshotOnce = IllegalStateException("bridge")
    scheduler.advanceBy(Engine.TICK_MS)
    val before = platform.snapshots.size
    scheduler.advanceBy(Engine.TICK_MS)
    assertEquals(before + 1, platform.snapshots.size)
    assertEquals(1.0, telemetry()["snapshotFailures"])
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

  /** Review C4a m-7: 2^53 is the last whole Double read as a whole number; 2^53 + 2, the next, stays a Double. */
  @Test
  fun `m-7 a whole JS number past 2 to the 53 is not read as a whole number`() {
    core.start()
    core.log("info", "probe.big", mapOf("count" to 9_007_199_254_740_992.0, "ms" to 9_007_199_254_740_994.0))
    scheduler.advanceBy(0)
    val raw = platform.lines.single { "probe.big" in it }
    assertTrue("\"count\":9007199254740992," in raw, raw)
    // Past 2^53 a Double is no longer every whole number: it is written as a native number, never as 9007199254740994.
    assertFalse("9007199254740994" in raw, raw)
    assertFalse(JSONObject(raw).get("ms") is Long, raw)
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
    // Review C4a I-4: the spec's 16 s, typed here: a backstop of ten minutes would hold every start that long.
    scheduler.advanceBy(BACKSTOP_MS - 1)
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
    scheduler.advanceBy(BACKSTOP_MS)
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
    // Review C4a I-4: twice the client's 8 s, as a literal, so the bound has a top as well as a bottom.
    assertEquals(BACKSTOP_MS, BridgeCore.ANSWER_BACKSTOP_MS)
    assertTrue(BACKSTOP_MS > HttpRequests.TIMEOUT_MS)
    assertTrue(BACKSTOP_MS > Heartbeat.TIMEOUT_MS)
    assertTrue(BACKSTOP_MS > DeliveryWatch.REQUEST_TIMEOUT_MS)
  }

  /** Review C4a m-2: the build runs inside the guard, so a request that cannot be built is still answered, once. */
  @Test
  fun `m-2 a request whose build throws is answered once, as a failure, and never sent`() {
    core.start()
    val answers = mutableListOf<HttpOutcome>()
    core.ask({ throw IllegalStateException("build") }) { answers += it }
    scheduler.advanceBy(BACKSTOP_MS)
    assertEquals(listOf<HttpOutcome>(HttpOutcome.Failed("IllegalStateException")), answers, "the throw is the answer; the backstop's is dropped")
    assertEquals(emptyList(), platform.http)
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
    scheduler.advanceBy(BACKSTOP_MS)
    assertEquals(1, platform.executed.count { it == Command.Release }, "the backstop's late answer releases nothing twice")
  }

  @Test
  fun `C0b a paired beat carries battery null until a device sample`() {
    core.start()
    pair()
    val beat = JSONObject(platform.beats().single().body!!)
    assertTrue(beat.has("battery") && beat.isNull("battery"), "$beat")
  }

  /**
   * Review C4a m-4: a beat's answer names no zone (capture-beat.v1), so the zone the code's answer gave
   * the broadcast is the one every later beat keeps (WaitingFields.over). The pair itself named none.
   */
  @Test
  fun `m-4 the zone the code's answer gave is kept through every zone-less beat`() {
    live()
    platform.answer = PairWire::answerLive
    val beats = platform.beats().size
    scheduler.advanceBy(60_000)
    assertTrue(platform.beats().size - beats >= 5, "beats answered with no zone: ${platform.beats().size - beats}")
    assertTrue("venueTimezone" !in PairWire.beat("live", PairWire.SID), "the beats answered name no zone")
    assertEquals("Europe/London", (core.current()["pairing"] as Map<*, *>)["venueTimezone"])
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

  /**
   * Carry C4c-I3 (Task 33): every line reaches the platform with the next seq, and the tail names the
   * same lines by the same seqs, so JS tells a new line from a tail line by number, never by text. The
   * fake clock stands still, so the thirty probe lines are equal, character for character.
   */
  @Test
  fun `C4c-I3 each record line reaches the platform with the next seq, and the tail carries the same seq for the same line`() {
    core.start()
    pair()
    repeat(30) { core.log("info", "probe.line", mapOf("n" to 1.0)) }
    scheduler.advanceBy(0)
    val n = platform.lines.size.toLong()
    assertTrue(n >= 30, "the probe lines reached the platform: $n")
    assertEquals((1L..n).toList(), platform.seqs, "numbered from 1, with no gap and no repeat")
    assertEquals(1, platform.lines.takeLast(30).toSet().size, "thirty equal lines")
    val expected = platform.seqs.zip(platform.lines).takeLast(20).map { (seq, line) -> mapOf("seq" to seq.toDouble(), "line" to line) }
    assertEquals(expected, core.tail())
  }

  @Test
  fun `C4c-I3 the tail before any line is empty, and its first line is seq 1`() {
    val fresh = RecordingPlatform()
    val idle = build(fresh, MemoryStore())
    assertEquals(emptyList(), idle.tail())
    idle.log("info", "probe.first", emptyMap())
    scheduler.advanceBy(0)
    assertEquals(listOf(1L), fresh.seqs)
    assertEquals(listOf(mapOf("seq" to 1.0, "line" to fresh.lines.single())), idle.tail())
  }

  /**
   * C4a carry (Task 33): the capture's close turns sound off at once. Sound is held both ways (I-1), so
   * the one silent reading the glue sends at the close could never turn it alone, and with the capture
   * closed nothing reads again: the chip would show sound while nothing records.
   */
  @Test
  fun `C4a carry sound turns off the moment the capture closes, past its hold, and the next open starts silent`() {
    core.start()
    core.report(Input.Network(true))
    pair()
    core.viewfinder(true)
    scheduler.advanceBy(0)
    assertEquals(listOf(true), platform.captures)
    core.readiness(audioPeak = 0.4)
    scheduler.advanceBy(HOLD_MS)
    core.readiness(audioPeak = 0.4)
    scheduler.advanceBy(0)
    assertEquals(true, readyOn(core)["sound"], "sound held, before the close")
    core.viewfinder(false)
    scheduler.advanceBy(0)
    assertEquals(listOf(true, false), platform.captures)
    assertEquals(false, readyOn(core)["sound"], "off at the close, with no reading after it")
    assertFalse(lines().last { it.getString("kind") == "readiness" }.getBoolean("sound"), "and on the record")
    // The next open: one loud reading is not sound yet; it turns at its hold, as at any start.
    core.viewfinder(true)
    scheduler.advanceBy(0)
    core.readiness(audioPeak = 0.4)
    scheduler.advanceBy(0)
    assertEquals(false, readyOn(core)["sound"], "the run starts afresh at the open")
    scheduler.advanceBy(HOLD_MS)
    core.readiness(audioPeak = 0.4)
    scheduler.advanceBy(0)
    assertEquals(true, readyOn(core)["sound"], "and turns at its hold")
  }

  /** The other direction (AGENTS §13, class 7): a capture that stays open keeps its held sound through a silent reading. */
  @Test
  fun `C4a carry a silent reading while the capture stays open is still held, not reset`() {
    core.start()
    pair()
    core.viewfinder(true)
    scheduler.advanceBy(0)
    core.readiness(audioPeak = 0.4)
    scheduler.advanceBy(HOLD_MS)
    core.readiness(audioPeak = 0.4)
    scheduler.advanceBy(0)
    core.readiness(audioPeak = 0.0)
    scheduler.advanceBy(0)
    assertEquals(true, readyOn(core)["sound"], "one silent reading does not turn a held sound")
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

  private companion object {
    /** Ruling C4a-I1: sound's hold, Task 17's 300 ms, typed here rather than read from the code under test. */
    const val HOLD_MS = 300L

    /** C0b's backstop, twice the client's 8 s timeout (review C4a I-4): a literal, never `BridgeCore`'s constant. */
    const val BACKSTOP_MS = 16_000L
  }
}
