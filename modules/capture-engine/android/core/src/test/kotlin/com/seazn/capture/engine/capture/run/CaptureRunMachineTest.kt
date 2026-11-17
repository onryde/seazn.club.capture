package com.seazn.capture.engine.capture.run

import com.seazn.capture.engine.StreamPack
import com.seazn.capture.engine.adapter.AttemptSignals
import com.seazn.capture.engine.adapter.CameraAvailability
import com.seazn.capture.engine.adapter.EncoderKeys
import com.seazn.capture.engine.core.CameraState
import com.seazn.capture.engine.core.Command
import com.seazn.capture.engine.core.Configs
import com.seazn.capture.engine.core.DegradeReason
import com.seazn.capture.engine.core.Engine
import com.seazn.capture.engine.core.FakeClock
import com.seazn.capture.engine.core.FakeScheduler
import com.seazn.capture.engine.core.FallbackPolicy
import com.seazn.capture.engine.core.Input
import com.seazn.capture.engine.core.NotReady
import com.seazn.capture.engine.core.PairRequest
import com.seazn.capture.engine.core.RecordEntry
import com.seazn.capture.engine.core.RtmpsTarget
import com.seazn.capture.engine.core.Phase
import com.seazn.capture.engine.core.SessionMachine
import com.seazn.capture.engine.core.SessionRecord
import com.seazn.capture.engine.core.session
import com.seazn.capture.engine.core.Side
import com.seazn.capture.engine.core.Snapshot
import com.seazn.capture.engine.core.SnapshotState
import com.seazn.capture.engine.core.SrtTarget
import com.seazn.capture.engine.thrownAt
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.advanceTimeBy
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertIs
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * C6 CRITICAL, end to end through the real machine: the capture's queue, the real [AttemptSignals] and
 * the real engine, with only StreamPack faked. An attempt's open that answers late is passed through
 * (Task 19, I1), the machine answers it with `Disconnect(n)`, and that must close attempt n alone.
 */
@OptIn(ExperimentalCoroutinesApi::class) // advanceUntilIdle and runCurrent
class CaptureRunMachineTest {
  private class Rig(scope: TestScope, val cameras: CameraAvailability = CameraAvailability()) {
    val clock = FakeClock()
    val scheduler = FakeScheduler(clock)
    val lines = mutableListOf<String>()
    val executed = mutableListOf<Command>()
    val parts = FakeParts()
    val told = Told()
    val signals = AttemptSignals()
    var snapshot: Snapshot? = null
    lateinit var run: CaptureRun
    val engine =
      Engine(clock, scheduler, commands = { executed += it; run.execute(it) }, snapshots = { snapshot = it }, record = SessionRecord { lines += it })

    init {
      // BridgeCore's cameraBusy: the camera is taken (its `holds` check is BridgeCoreTest's).
      val busy = { request: PairRequest -> told.busy += request; engine.send(Input.CameraContended); scheduler.advanceBy(0) }
      val calls = told.calls(report = { told.reports += it; engine.send(it); scheduler.advanceBy(0) }, cameraBusy = busy)
      run = CaptureRun(parts, signals, cameras, calls, { Side.LEFT }, scope.queueScope(), monoMs = { scope.testScheduler.currentTime })
      parts.cameras = cameras
      parts.later = scope.queueScope()
      engine.start()
      run.open(Configs.pairRequest())
    }

    val connects: List<Command.Connect>
      get() = executed.filterIsInstance<Command.Connect>()
  }

  @Test
  fun `C6 CRITICAL a late open of attempt 1 is closed by its Disconnect, and attempt 2 stays on air`() =
    runTest {
      val rig = Rig(this)
      rig.parts.gates[1] = CompletableDeferred() // attempt 1's open answers late
      Configs.pairInputs().forEach(rig.engine::send)
      rig.scheduler.advanceBy(0)
      // A second of the capture's own clock: the build, and attempt 1's start, which waits at its gate. Not
      // until idle, which would run the start's bound out (C6 I-1): the machine's clock and the capture's are
      // apart here, and the late open lands inside the bound, as a queue's own delay can put it in a phone.
      advanceTimeBy(1_000)
      runCurrent()
      assertEquals(listOf(1), rig.connects.map { it.attemptId }, "armed and ready: the machine connects attempt 1")
      // No answer within the machine's connect timeout: it closes attempt 1 and, after its retry wait, connects attempt 2.
      rig.scheduler.advanceBy(SessionMachine.CONNECT_TIMEOUT_MS + Engine.TICK_MS)
      rig.scheduler.advanceBy(SessionMachine.RETRY_MS + Engine.TICK_MS)
      assertEquals(listOf(1, 2), rig.connects.map { it.attemptId })
      // Attempt 1 opens after all. The machine, waiting on attempt 2, answers that open with Disconnect(1),
      // which reaches the capture after attempt 2's connect.
      rig.parts.gates.getValue(1).complete(true)
      advanceUntilIdle()
      val late = rig.executed.indexOfLast { it == Command.Disconnect(1) }
      val second = rig.executed.indexOf(rig.connects.last())
      assertEquals(2, rig.executed.count { it == Command.Disconnect(1) }, "the timeout's and the late open's: ${rig.executed}")
      assertTrue(late > second, "the late open's Disconnect(1) came after Connect(2): ${rig.executed}")
      assertEquals(1, rig.lines.count { """"kind":"stale-connected"""" in it }, rig.lines.joinToString("\n"))

      assertEquals(2, rig.parts.publishing, "attempt 2 keeps publishing: ${rig.parts.log}")
      assertEquals(listOf(1), rig.parts.closed, "attempt 1's endpoint, and only it, was closed")
      assertEquals(2, (rig.engine.phase as? Phase.OnAir)?.attemptId, "attempt 2 is on air")
      assertFalse(Command.Disconnect(2) in rig.executed)
      assertFalse(rig.lines.any { """"kind":"dropped"""" in it }, "no drop was heard: ${rig.lines.joinToString("\n")}")
    }

  /**
   * C7 carry, through the real machine: StreamPack (3.2.0 and 3.2.1, javap) opens the camera lazily, so another app's hold
   * can surface first at the start. The attempt is UNHELD, never counted towards the SRT to RTMPS
   * fallback; the camera is taken, so the retry goes out on the slate, over SRT still.
   */
  @Test
  fun `C7 a camera busy at the start is taken, never a counted failure, and the retry goes out on the slate`() =
    runTest {
      val rig = Rig(this)
      val busy = RuntimeException("Camera already in use")
      rig.parts.failing[1] = busy
      rig.parts.busyFailures[busy] = "0"
      Configs.pairInputs().forEach(rig.engine::send)
      rig.scheduler.advanceBy(0)
      advanceUntilIdle()
      assertEquals(listOf(1), rig.connects.map { it.attemptId })
      val failed = rig.lines.single { """"kind":"connect-failed"""" in it }
      assertTrue(""""failure":"unheld"""" in failed && """"counted":false""" in failed, failed)
      assertEquals(1, rig.lines.count { """"kind":"camera-taken"""" in it }, rig.lines.joinToString("\n"))
      assertTrue(Command.Slate(on = true) in rig.executed, "the camera is taken while sending: ${rig.executed}")
      rig.scheduler.advanceBy(SessionMachine.RETRY_MS + Engine.TICK_MS)
      advanceUntilIdle()
      assertEquals(listOf(1, 2), rig.connects.map { it.attemptId })
      assertTrue(rig.connects.all { it.target is SrtTarget }, "never fell back: ${rig.connects}")
      assertEquals(2, (rig.engine.phase as? Phase.OnAir)?.attemptId, "attempt 2 is on air, on the slate")
      assertEquals(listOf("slate true"), rig.parts.log.filter { it.startsWith("slate") })
    }

  /**
   * Review C7 M-3, through the real machine: the endpoint's drop arrives while the start is still in flight,
   * and the start then fails on a busy camera. The drop was the busy start's own: the attempt is UNHELD, never
   * counted towards the fallback, and never a drop.
   */
  @Test
  fun `M-3 a drop during a busy start is UNHELD and uncounted, never a drop`() =
    runTest {
      val rig = Rig(this)
      val busy = RuntimeException("Camera already in use")
      rig.parts.failing[1] = busy
      rig.parts.busyFailures[busy] = "0"
      rig.parts.starting = { id -> rig.signals.dropped(id, java.io.IOException("endpoint closed"))?.let { rig.engine.send(it); rig.scheduler.advanceBy(0) } }
      Configs.pairInputs().forEach(rig.engine::send)
      rig.scheduler.advanceBy(0)
      advanceUntilIdle()
      assertEquals(listOf(1), rig.connects.map { it.attemptId })
      val failed = rig.lines.single { """"kind":"connect-failed"""" in it }
      assertTrue(""""failure":"unheld"""" in failed && """"counted":false""" in failed, failed)
      assertFalse(rig.lines.any { """"kind":"dropped"""" in it }, "no drop: ${rig.lines.joinToString("\n")}")
      assertEquals(1, rig.lines.count { """"kind":"camera-taken"""" in it }, rig.lines.joinToString("\n"))
    }

  /**
   * Device session 4, F-S4-1, through the real machine: the phone's loop. A start that failed after its SRT socket
   * connected, StreamPack's cleanup closing it, read as a requested drop: `other`, never counted, with no message,
   * so the broadcast retried SRT every 2.5 s for good. The start's own failure now counts, and the third moves the
   * session to RTMPS, as plan B's fallback rules say (C1).
   */
  @Test
  fun `F-S4-1 a start that keeps failing after its endpoint opened counts, and the third falls back to RTMPS`() =
    runTest {
      val rig = Rig(this)
      for (id in 1..FallbackPolicy.FAILURES_TO_FALL_BACK) rig.parts.failing[id] = IllegalStateException("Output is released")
      // The failing starts' cleanup closes their endpoints; the RTMPS start after the fallback opens.
      rig.parts.starting = { id -> if (id in rig.parts.failing) rig.signals.dropped(id, null)?.let { rig.engine.send(it); rig.scheduler.advanceBy(0) } }
      Configs.pairInputs().forEach(rig.engine::send)
      rig.scheduler.advanceBy(0)
      advanceUntilIdle()
      repeat(FallbackPolicy.FAILURES_TO_FALL_BACK) {
        rig.scheduler.advanceBy(SessionMachine.RETRY_MS + Engine.TICK_MS)
        advanceUntilIdle()
      }
      val failed = rig.lines.filter { """"kind":"connect-failed"""" in it }
      assertEquals(FallbackPolicy.FAILURES_TO_FALL_BACK, failed.size, rig.lines.joinToString("\n"))
      for (line in failed) assertTrue(""""failure":"other"""" in line && """"counted":true""" in line && "reason" !in line, line)
      assertEquals(1, rig.lines.count { """"kind":"fell-back"""" in it }, rig.lines.joinToString("\n"))
      val targets = rig.connects.map { it.target }
      assertTrue(targets.take(FallbackPolicy.FAILURES_TO_FALL_BACK).all { it is SrtTarget } && targets.last() is RtmpsTarget, "$targets")
      assertEquals(FallbackPolicy.FAILURES_TO_FALL_BACK, rig.told.lines.count { it.kind == "capture-start-failed" }, "each failed start named")
      assertEquals(FallbackPolicy.FAILURES_TO_FALL_BACK + 1, (rig.engine.phase as? Phase.OnAir)?.attemptId, "the RTMPS attempt is on air: ${rig.engine.phase}")
    }

  /**
   * F-S4-1, through the real machine: a start the camera failed, its cleanup closing the endpoint while it
   * started. The failure is CAMERA, never counted and never a drop; the capture builds the camera afresh, and
   * the next attempt goes on air on SRT, with no fallback.
   */
  @Test
  fun `F-S4-1 a start the camera failed is never counted - the camera is built afresh and the next attempt is on air on SRT`() =
    runTest {
      val rig = Rig(this)
      rig.parts.failing[1] = thrownAt(IllegalArgumentException("Output STREAM not found"), "${StreamPack.CAMERA}.controllers.CameraController", "addTarget")
      rig.parts.starting = { id -> if (id in rig.parts.failing) rig.signals.dropped(id, null)?.let { rig.engine.send(it); rig.scheduler.advanceBy(0) } }
      Configs.pairInputs().forEach(rig.engine::send)
      rig.scheduler.advanceBy(0)
      advanceUntilIdle()
      rig.scheduler.advanceBy(SessionMachine.RETRY_MS + Engine.TICK_MS)
      advanceUntilIdle()
      val failed = rig.lines.single { """"kind":"connect-failed"""" in it }
      assertTrue(""""failure":"camera"""" in failed && """"counted":false""" in failed && "reason" !in failed, failed)
      assertFalse(rig.lines.any { """"kind":"dropped"""" in it || """"kind":"fell-back"""" in it }, rig.lines.joinToString("\n"))
      assertEquals(2, (rig.engine.phase as? Phase.OnAir)?.attemptId, "on air: ${rig.engine.phase}")
      assertEquals(listOf(1, 2), rig.connects.map { it.attemptId })
      assertTrue(rig.connects.all { it.target is SrtTarget }, "never a fallback")
      assertEquals(1, rig.told.lines.count { it.kind == "capture-rebuilt" }, "built afresh, once")
    }

  /**
   * Review C7 I-2, through the real machine: another app took the camera before the build. StreamPack opens
   * it lazily, so the build holds nothing, and the take stands: Armed waits, not ready on the camera, until
   * StreamPack reports our open. Then the take is told over, the machine reopens, and the broadcast connects.
   */
  @Test
  fun `I-2 a camera taken before the build keeps Armed not ready on the camera until our open is seen`() =
    runTest {
      val rig = Rig(this, CameraAvailability().apply { unavailable("0", 0) })
      Configs.pairInputs(ready = false).forEach(rig.engine::send)
      rig.scheduler.advanceBy(0)
      advanceUntilIdle() // the build, after the go-live armed the broadcast
      rig.engine.send(Input.ReadinessChanged(Configs.READY))
      rig.scheduler.advanceBy(0)
      advanceUntilIdle()
      val armed = rig.engine.phase as? Phase.Armed
      assertEquals(NotReady.CAMERA, armed?.session?.let { it.pairing.readiness.notReady(it.camera, it.networkValidated) }, "${rig.engine.phase}")
      assertEquals(emptyList(), rig.connects, "Armed connects nothing over a taken camera")
      assertEquals(1, rig.lines.count { """"kind":"camera-taken"""" in it }, rig.lines.joinToString("\n"))

      rig.parts.opened("0") // StreamPack: our preview opened it after all
      advanceUntilIdle()
      rig.scheduler.advanceBy(0)
      advanceUntilIdle()
      assertEquals(listOf(Input.CameraContended, Input.CameraReleased, Input.CameraReopened(true)), rig.told.reports.filter { it !is Input.ConnectFailed && it !is Input.Connected })
      assertEquals(listOf(1), rig.connects.map { it.attemptId }, "the take told over: Armed connects")
    }

  /**
   * Device fix round, item (c), through the real machine: another app takes the camera while Armed, after our open,
   * and lets it go. Nothing is on air, so no slate is up and the source held is our camera, which StreamPack's
   * same-camera swap would not open again: the machine's ReopenCamera builds it afresh, once, and only then is the
   * camera ours and the broadcast connects.
   */
  @Test
  fun `(c) a camera taken and released while Armed is built afresh by the reopen, and then the broadcast connects`() =
    runTest {
      val rig = Rig(this)
      Configs.pairInputs(ready = false).forEach(rig.engine::send)
      rig.scheduler.advanceBy(0)
      advanceUntilIdle()
      rig.parts.opened("0") // our preview opened it
      advanceUntilIdle()
      val left = EncoderKeys.surfaceRotation(Side.LEFT)
      assertEquals(listOf("build $left", "build done"), rig.parts.log, "built once, at the pair")
      rig.engine.send(Input.CameraContended) // CameraWatch: another app holds it
      rig.scheduler.advanceBy(0)
      rig.engine.send(Input.CameraReleased)
      rig.scheduler.advanceBy(0)
      advanceUntilIdle()
      assertEquals(1, rig.executed.count { it == Command.ReopenCamera }, "${rig.executed}")
      assertEquals(listOf("build $left", "build done", "release", "release done", "build $left", "build done"), rig.parts.log)
      assertEquals(listOf(RecordEntry("capture-rebuilt", listOf("action" to "reopen"))), rig.told.lines.filter { it.kind == "capture-rebuilt" })
      assertTrue(Input.CameraReopened(true) in rig.told.reports, "${rig.told.reports}")
      assertFalse(Command.Slate(on = true) in rig.executed, "Armed sends nothing, so no slate: ${rig.executed}")
      rig.engine.send(Input.ReadinessChanged(Configs.READY))
      rig.scheduler.advanceBy(0)
      advanceUntilIdle()
      assertEquals(listOf(1), rig.connects.map { it.attemptId }, "the camera ours again: Armed connects")
    }

  // --- N45 (device check 2026-11-17): our camera taken by another app on air keeps the uplink and says so ---

  /** Both clocks forward together, the capture's first, in steps of a tenth of a second. */
  private fun TestScope.both(rig: Rig, ms: Long) {
    var done = 0L
    while (done < ms) {
      advanceTimeBy(STEP_MS)
      runCurrent()
      rig.scheduler.advanceBy(STEP_MS)
      runCurrent()
      done += STEP_MS
    }
  }

  /** Paired, armed and on air on attempt 1, its frames advancing: live. */
  private fun TestScope.live(rig: Rig) {
    Configs.pairInputs().forEach(rig.engine::send)
    rig.scheduler.advanceBy(0)
    advanceUntilIdle()
    assertEquals(1, (rig.engine.phase as? Phase.OnAir)?.attemptId, "on air: ${rig.engine.phase}")
    rig.engine.send(Input.Frames(1, 15, 23))
    both(rig, 500)
    rig.engine.send(Input.Frames(1, 30, 46))
    both(rig, 500)
    assertNotNull(rig.engine.phase.session?.liveSinceEpochMs, "live: ${rig.engine.phase}")
  }

  private fun Rig.kindCount(kind: String): Int = lines.count { """"kind":"$kind"""" in it }

  /** The uplink held throughout: attempt 1 the only one ever asked for, on air, and no stall judged. */
  private fun assertHeld(rig: Rig, label: String) {
    val record = rig.lines.joinToString("\n")
    assertEquals(listOf(1), rig.connects.map { it.attemptId }, "$label: one attempt")
    assertFalse(rig.executed.any { it is Command.Rebuild || it is Command.StartNewSession || it is Command.Disconnect }, "$label: ${rig.executed}")
    assertEquals(0 to 1, rig.kindCount("video-stalled") to rig.kindCount("connecting"), "$label: $record")
    assertEquals(1, (rig.engine.phase as? Phase.OnAir)?.attemptId, "$label: ${rig.engine.phase}")
    assertEquals(1, rig.parts.publishing, "$label: the endpoint stays open")
  }

  /** The machine's camera, and the snapshot JS reads: the slate's state, degraded camera-taken, never connecting. */
  private fun assertShownTaken(rig: Rig, label: String) {
    assertEquals(CameraState.TAKEN, rig.engine.phase.session?.camera, label)
    val shown = assertNotNull(rig.snapshot, label)
    assertEquals(CameraState.TAKEN, shown.camera, label)
    assertEquals(listOf(DegradeReason.CAMERA_TAKEN), assertIs<SnapshotState.Degraded>(shown.state, label).reasons, label)
  }

  /**
   * N45, the device check's sequence (NE2211, SRT, 15:19:34Z): the system camera app opened our camera on air. Camera2
   * evicts us and says so only as our device's disconnect, which StreamPack logs ("Camera 0 has been disconnected").
   * It reads as another app's take: the slate goes up in the camera's place (decision 7), the stall watchdog holds,
   * and the snapshot says camera-taken. Nothing reconnects: the device check churned three reconnects in 13 s
   * (video-stalled no-video, then no-first-frame twice). The holder's release reopens our camera under the slate; the
   * slate comes down, and the camera's first frame is the resume, on attempt 1 still.
   */
  @Test
  fun `N45 our camera taken on air keeps the uplink - the slate goes up, nothing reconnects, and its release brings it back`() =
    probeTest { rig ->
      live(rig)
      rig.parts.probeAnswer = HELD // N45 I1: while the other app keeps it, each probe of it is refused
      rig.parts.lose("0") // StreamPack: "Camera 0 has been disconnected"
      both(rig, 10_000) // past the stall watchdog's 3 s and the first-frame grace, twice over
      assertEquals(1, rig.kindCount("camera-taken"), rig.lines.joinToString("\n"))
      assertEquals(listOf("slate true"), rig.parts.log.filter { it.startsWith("slate") }, "the slate on air")
      assertHeld(rig, "taken")
      assertShownTaken(rig, "taken")

      // N45 I1: our own camera's available is no release of a take of it (our eviction says it too); CameraWatch asks
      // for a probe, which finds it free.
      assertNull(rig.cameras.available("0", 20_000), "the holder let go: the probe decides")
      rig.parts.probeAnswer = Probe.Opened("0")
      rig.run.mayBeFree()
      both(rig, 1_500)
      assertEquals(1, rig.executed.count { it == Command.ReopenCamera }, "${rig.executed}")
      assertEquals(listOf("reopen", "slate false"), rig.parts.log.filter { it == "reopen" || it.startsWith("slate f") }, "the camera swapped back in")
      rig.engine.send(Input.Frames(1, 40, 60))
      both(rig, 500)
      rig.engine.send(Input.Frames(1, 55, 83))
      both(rig, 500)
      assertEquals(listOf(1, 1, 1), listOf("camera-released", "camera-reopened", "camera-resumed").map { rig.kindCount(it) }, rig.lines.joinToString("\n"))
      assertTrue(rig.lines.single { """"kind":"camera-reopened"""" in it }.contains(""""ok":true"""), "reopened")
      assertEquals(CameraState.OWN, rig.engine.phase.session?.camera)
      assertIs<SnapshotState.Publishing>(rig.snapshot?.state, "${rig.snapshot}")
      assertHeld(rig, "resumed")
    }

  /**
   * N45 I1, the order the device can also deliver: our eviction's own "available" reaches CameraWatch after the take,
   * while the other app still holds the camera. Before round 1 it told the take over, and the reopen landed on the
   * held camera (review I2). It is no release now: the probe it asks for is refused, the slate stays, and nothing
   * reconnects; the probe that finds the camera free brings it back.
   */
  @Test
  fun `N45 I1 our eviction's own available after the take is no release - the slate stays and nothing reconnects`() =
    probeTest { rig ->
      live(rig)
      rig.parts.probeAnswer = HELD
      rig.parts.lose("0")
      both(rig, 500)
      assertNull(rig.cameras.available("0", 1_000), "the eviction's own")
      rig.run.mayBeFree() // CameraWatch asks for a probe on it
      both(rig, 10_000)
      assertEquals(listOf("slate true"), rig.parts.log.filter { it == "reopen" || it.startsWith("slate") })
      assertEquals(0, rig.executed.count { it == Command.ReopenCamera }, "${rig.executed}")
      assertTrue(rig.parts.probeCount >= 2, "probed: ${rig.parts.probeCount}")
      assertHeld(rig, "taken")
      assertShownTaken(rig, "taken")

      rig.parts.probeAnswer = Probe.Opened("0")
      until(rig, 5_100) { Command.ReopenCamera in rig.executed }
      both(rig, 200)
      rig.engine.send(Input.Frames(1, 40, 60))
      both(rig, 500)
      rig.engine.send(Input.Frames(1, 55, 83))
      both(rig, 500)
      assertEquals(1, rig.executed.count { it == Command.ReopenCamera }, "${rig.executed}")
      assertEquals(1, rig.kindCount("camera-resumed"), rig.lines.joinToString("\n"))
      assertEquals(CameraState.OWN, rig.engine.phase.session?.camera)
      assertHeld(rig, "resumed")
    }

  /**
   * N45 I2 (review, probe A): StreamPack 3.2.1 can report a reopen whose open failed busy as streaming (javap:
   * `CameraSource.startStream` reports it once `CameraController.addTarget` returns, and `addTarget` swallows a failure
   * of its session, not of the device's own open; which stage a busy failure comes at is device-only). Read after
   * the busy word's take, that report told the take over before the fix: the machine reopened a camera another app
   * held, found no picture, and reconnected twice in 10 s. Only a new open asked ends a busy word's hold now. Here the
   * release is another camera's (F-P5-9), so the reopen's busy word is its first take of ours.
   */
  @Test
  fun `N45 I2 a reopen reported streaming after its busy word is taken again and nothing reconnects - the report read after the word`() =
    runTest { staleOpen(this, StaleOpen.AFTER) }

  @Test
  fun `N45 I2 a reopen reported streaming after its busy word is taken again and nothing reconnects - the report read before the word`() =
    runTest { staleOpen(this, StaleOpen.BEFORE) }

  @Test
  fun `N45 I2 a reopen reported streaming after its busy word is taken again and nothing reconnects - both heard before the queue has the word`() =
    runTest { staleOpen(this, StaleOpen.AT_ONCE) }

  private fun staleOpen(scope: TestScope, order: StaleOpen) =
    with(scope) {
      val rig = Rig(this)
      live(rig)
      rig.engine.send(assertNotNull(rig.cameras.unavailable("1", 5_000), "F-P5-9: another app opened camera 1"))
      both(rig, 500)
      assertEquals(listOf("slate true"), rig.parts.log.filter { it.startsWith("slate") }, order.name)
      rig.parts.busyReopens += order
      rig.engine.send(assertNotNull(rig.cameras.available("1", 6_000), "camera 1 let go"))
      both(rig, 10_000)
      val record = rig.lines.joinToString("\n")
      assertEquals(1, rig.executed.count { it == Command.ReopenCamera }, "${order.name}: one reopen, ${rig.executed}")
      assertEquals(2, rig.kindCount("camera-taken"), "${order.name}: $record")
      assertEquals(listOf("slate true", "reopen", "slate false", "slate true"), rig.parts.log.filter { it == "reopen" || it.startsWith("slate") }, order.name)
      assertHeld(rig, order.name)
      assertShownTaken(rig, order.name)
    }

  /**
   * A test of the probe: whatever its assertions do, the probing ends with it. A failed one left the probe answering, so
   * the probing never ended and runTest's last drain spun on it until the JVM ran out of memory, which hung a mutation
   * run's later builds behind it (re-review 2's mutation pass).
   */
  private fun probeTest(body: suspend TestScope.(Rig) -> Unit) =
    runTest {
      val rig = Rig(this)
      try {
        body(rig)
      } finally {
        rig.parts.probeAnswer = null
        rig.parts.probeFailure = null
        rig.parts.losesOnReopen = false
        rig.parts.probes.clear()
      }
    }

  /** Advances both clocks a tenth of a second at a time until [what] holds, for at most [ms]: the time it took. */
  private fun TestScope.until(rig: Rig, ms: Long, what: () -> Boolean): Long {
    var spent = 0L
    while (!what() && spent < ms) {
      both(rig, STEP_MS)
      spent += STEP_MS
    }
    assertTrue(what(), "not within $ms ms: ${rig.told.lines}")
    return spent
  }

  /**
   * N45 I1 (review, probe B): the device check's holder sat on another camera id, hidden from our availability watch
   * (Camera2 refused our open with error 2, MAX_CAMERAS_IN_USE), so no available for ours comes when it lets go, and
   * the take held the slate until Stop. The probe tries our camera every 5 s, and never the transport: refused, the
   * slate stays and the record has one line at the first and one 30 s after, with the count; opened, the camera is
   * back within 5 s of its holder letting go, at worst just after a refusal.
   */
  @Test
  fun `N45 I1 a take no release reaches ends by the probe within 5 s of its holder letting go, and nothing reconnects`() =
    probeTest { rig ->
      live(rig)
      rig.parts.probeAnswer = HELD
      rig.parts.lose("0")
      both(rig, 60_000)
      assertHeld(rig, "a minute held")
      assertShownTaken(rig, "a minute held")
      assertTrue(rig.parts.probeCount in 11..12, "every 5 s: ${rig.parts.probeCount}")
      val refused = listOf<Pair<String, Any?>>("ok" to false, "error" to "max-in-use")
      assertEquals(listOf(refused + ("failures" to 1), refused + ("failures" to 7)), rig.told.lines.filter { it.kind == "camera-probe" }.map { it.fields })

      val probed = rig.parts.probeCount
      until(rig, 6_000) { rig.parts.probeCount > probed }
      rig.parts.probeAnswer = Probe.Opened("0") // let go just after a refusal: the worst case
      val took = until(rig, 6_000) { Command.ReopenCamera in rig.executed }
      assertTrue(took <= 5_000, "within 5 s: $took ms")
      assertEquals(listOf<Pair<String, Any?>>("ok" to true, "failures" to 13), rig.told.lines.last { it.kind == "camera-probe" }.fields)
      both(rig, 500)
      rig.engine.send(Input.Frames(1, 40, 60))
      both(rig, 500)
      rig.engine.send(Input.Frames(1, 55, 83))
      both(rig, 500)
      assertEquals(CameraState.OWN, rig.engine.phase.session?.camera)
      assertEquals(listOf(1, 1, 1), listOf("camera-released", "camera-reopened", "camera-resumed").map { rig.kindCount(it) }, rig.lines.joinToString("\n"))
      assertHeld(rig, "resumed")
      val after = rig.parts.probeCount
      both(rig, 20_000)
      assertEquals(after, rig.parts.probeCount, "the slate down: no probe")
    }

  /**
   * N45 I1: three words that the camera may be free now each probe at once, not at the next 5 s: Camera2's available
   * for a camera and its access priorities' change (CameraWatch's, both `mayBeFree`), and the app's return to the
   * foreground, the moment the operator most often lets the camera go.
   */
  @Test
  fun `N45 I1 Camera2's word that the camera may be free probes at once`() = probeTest { rig -> nudged(rig, "camera watch") { it.run.mayBeFree() } }

  @Test
  fun `N45 I1 the app's return to the foreground probes at once`() = probeTest { rig -> nudged(rig, "foreground") { it.run.foreground() } }

  private fun TestScope.nudged(rig: Rig, label: String, nudge: (Rig) -> Unit) =
    run {
      live(rig)
      rig.parts.probeAnswer = Probe.Refused("in-use")
      rig.parts.lose("0")
      both(rig, 6_500) // refused at 5 s; the next is due at 10 s
      assertEquals(1, rig.parts.probeCount, label)
      rig.parts.probeAnswer = Probe.Opened("0")
      nudge(rig)
      both(rig, 300)
      assertEquals(2, rig.parts.probeCount, label)
      assertEquals(1, rig.executed.count { it == Command.ReopenCamera }, "$label: ${rig.executed}")
      assertHeld(rig, label)
    }

  /**
   * N45 I1, review M1 (probe D): a camera lost at every open, a device error that is no other app's. Each probe opens
   * it and each reopen loses it again at once; after three such, the probe waits 30 s, not 5, so the take does not
   * churn a reopen and its lines every 5 s for the rest of the match. Nothing reconnects.
   */
  @Test
  fun `N45 I1 a camera lost at every reopen is probed every 30 s after three quick retakes, and nothing reconnects`() =
    probeTest { rig ->
      live(rig)
      rig.parts.probeAnswer = Probe.Opened("0")
      rig.parts.losesOnReopen = true
      rig.parts.lose("0")
      both(rig, 120_000)
      val reopens = rig.executed.count { it == Command.ReopenCamera }
      assertEquals(6, reopens, "at 5, 10 and 15 s, then 45, 75 and 105 s: ${rig.executed.filter { it == Command.ReopenCamera || it is Command.Slate }}")
      assertHeld(rig, "lost at every open")
      assertShownTaken(rig, "lost at every open")

      rig.parts.losesOnReopen = false // the camera mended: the next slow probe brings it back
      until(rig, 31_000) { rig.kindCount("camera-resumed") == 0 && rig.executed.count { it == Command.ReopenCamera } == 7 }
      both(rig, 200)
      rig.engine.send(Input.Frames(1, 40, 60))
      both(rig, 500)
      rig.engine.send(Input.Frames(1, 55, 83))
      both(rig, 15_000)
      assertEquals(CameraState.OWN, rig.engine.phase.session?.camera, "resumed")
      rig.engine.send(Input.Frames(1, 600, 900))
      rig.parts.lose("0") // a take long after: no retake, so probed every 5 s again
      both(rig, 5_500)
      assertEquals(8, rig.executed.count { it == Command.ReopenCamera }, "the quick count starts again")
      rig.parts.probeAnswer = null // nothing to probe: the probing ends, so runTest's last drain does too
      both(rig, 31_000)
    }

  /**
   * N45 R1-C1 (re-review, probe E): another app's take of another camera (F-P5-9, a video call on camera 1, which the
   * NE2211 allowed beside ours) is its own path: our camera is never probed beside the call, nothing reopens mid-call,
   * and the call's release reopens ours, F-P5-10's measured remedy (only a reopen after the release healed its noise).
   */
  @Test
  fun `N45 R1-C1 another app's take of another camera is never probed, and its release reopens ours`() =
    runTest {
      val rig = Rig(this)
      live(rig)
      rig.parts.probeAnswer = Probe.Opened("0") // the device would let ours open beside camera 1
      try {
        rig.cameras.unavailable("1", 100_000)?.let(rig.engine::send)
        both(rig, 2_000)
        rig.run.mayBeFree()
        rig.run.foreground()
        both(rig, 30_000)
        assertEquals(0, rig.parts.probeCount, "never opened beside the call")
        assertEquals(0, rig.executed.count { it == Command.ReopenCamera }, "nothing reopens mid-call")
        assertEquals(CameraState.TAKEN, rig.engine.phase.session?.camera)
        assertHeld(rig, "the call")
        assertShownTaken(rig, "the call")

        rig.cameras.available("1", 200_000)?.let(rig.engine::send) // the call ends
        both(rig, 200)
        assertEquals(1, rig.executed.count { it == Command.ReopenCamera }, "its release reopens ours")
        rig.engine.send(Input.Frames(1, 40, 60))
        both(rig, 500)
        rig.engine.send(Input.Frames(1, 55, 83))
        both(rig, 500)
        assertEquals(1, rig.kindCount("camera-resumed"), rig.lines.joinToString("\n"))
        assertEquals(CameraState.OWN, rig.engine.phase.session?.camera)
        assertEquals(listOf(1), rig.connects.map { it.attemptId }, "nothing reconnected")
      } finally {
        rig.parts.probeAnswer = null
      }
      both(rig, 31_000)
    }

  /**
   * N45 R1-I1 (re-review, probe D): Camera2 announces our camera available whenever our device closes, each loss's and
   * each probe's, and CameraWatch hands every one on as a word that the camera may be free. The back-off is a floor
   * no word shortens: after three quick retakes, at most one reopen each 30 s. So in 120 s, with a word at every
   * reopen and every second besides, no more than 7 reopens (the first take's, the two before the third retake, then
   * one each 30 s), and the record grows with the reopens, never with the words.
   */
  @Test
  fun `N45 R1-I1 a camera lost at every reopen keeps the 30 s back-off while Camera2's own availables nudge it`() =
    runTest {
      val rig = Rig(this)
      live(rig)
      rig.parts.probeAnswer = Probe.Opened("0")
      rig.parts.losesOnReopen = true
      val at = mutableListOf<Long>()
      try {
        rig.parts.lose("0")
        var spent = 0L
        while (spent < 120_000) {
          both(rig, STEP_MS)
          spent += STEP_MS
          if (rig.executed.count { it == Command.ReopenCamera } > at.size) {
            at += spent
            // the reopen's loss closed our device: Camera2's available for ours, then the watch's word
            rig.cameras.available("0", 300_000 + spent)?.let(rig.engine::send)
            rig.run.mayBeFree()
          }
          if (spent % 1_000 == 0L) rig.run.mayBeFree()
        }
        assertTrue(at.size in 4..7, "no more than 7 reopens in 120 s: $at")
        val slow = at.drop(2).zipWithNext { a, b -> b - a }
        assertTrue(slow.isNotEmpty() && slow.all { it >= 30_000 }, "one each 30 s after the third quick retake: $at")
        val probeLines = rig.told.lines.count { it.kind == "camera-probe" }
        val lostLines = rig.told.lines.count { it.kind == "camera-lost" }
        assertTrue(probeLines <= at.size && lostLines <= at.size + 1, "lines follow the reopens: $probeLines, $lostLines for $at")
        assertHeld(rig, "nudged")
      } finally {
        rig.parts.probeAnswer = null
        rig.parts.losesOnReopen = false
      }
      both(rig, 31_000)
    }

  /**
   * N45 R1-I1: the words are conflated, and a word from before a take is no news of it: a new slate's probing drains
   * it, so its first probe comes at 5 s, not at the 1 s floor. Re-review 2: the app's return from before it too.
   */
  @Test
  fun `N45 R1-I1 a word that the camera may be free from before the take is no news of it`() =
    runTest {
      val rig = Rig(this)
      live(rig)
      rig.parts.probeAnswer = HELD
      try {
        repeat(3) { rig.run.mayBeFree() } // before any take: nothing probes, the words wait in the channel
        rig.run.foreground()
        both(rig, 2_000)
        assertEquals(0, rig.parts.probeCount)
        rig.parts.lose("0")
        both(rig, 4_000)
        assertEquals(0, rig.parts.probeCount, "no probe before 5 s: the old words were drained")
        both(rig, 1_500)
        assertEquals(1, rig.parts.probeCount, "the first, at 5 s")
      } finally {
        rig.parts.probeAnswer = null
      }
      both(rig, 31_000)
    }

  /**
   * N45 R2-I1 (re-review 2, probe F): another app holds our camera at Go live (a remote start while the camera app is
   * open, which N28 lets go ahead), on an id hidden from our watch (error 2), so no available for ours ever comes. The
   * take found at the start is our camera's, probed like any other: the retry goes on air on the slate, and once the
   * holder lets go the probe opens the camera and the machine reopens it under the slate within 5 s; the slate comes
   * down, and attempt 2 stays on air.
   */
  @Test
  fun `N45 R2-I1 a take found at the start is probed - the holder lets go and the slate comes down within 5 s`() =
    runTest {
      val rig = Rig(this)
      val busy = RuntimeException("Camera already in use")
      rig.parts.failing[1] = busy
      rig.parts.busyFailures[busy] = "0"
      rig.parts.probeAnswer = HELD
      try {
        Configs.pairInputs().forEach(rig.engine::send)
        rig.scheduler.advanceBy(0)
        both(rig, 1_000)
        rig.scheduler.advanceBy(SessionMachine.RETRY_MS + Engine.TICK_MS)
        both(rig, 1_000)
        assertEquals(2, (rig.engine.phase as? Phase.OnAir)?.attemptId, "the retry on air, on the slate: ${rig.engine.phase}")
        assertEquals(CameraState.TAKEN, rig.engine.phase.session?.camera)
        both(rig, 8_000)
        assertTrue(rig.parts.probeCount >= 1, "the take found at the start is probed: ${rig.parts.probeCount}")
        val probed = rig.parts.probeCount
        until(rig, 6_000) { rig.parts.probeCount > probed }
        rig.parts.probeAnswer = Probe.Opened("0") // let go just after a refusal: the worst case
        val took = until(rig, 6_000) { Command.ReopenCamera in rig.executed }
        assertTrue(took <= 5_000, "within 5 s: $took ms")
        both(rig, 500)
        rig.engine.send(Input.Frames(2, 40, 60))
        both(rig, 500)
        rig.engine.send(Input.Frames(2, 55, 83))
        both(rig, 500)
        assertEquals(CameraState.OWN, rig.engine.phase.session?.camera, rig.lines.joinToString("\n"))
        assertEquals(listOf("slate true", "slate false"), rig.parts.log.filter { it.startsWith("slate") })
        assertEquals(listOf(1, 2), rig.connects.map { it.attemptId }, "nothing reconnected for the take")
        assertEquals(2, rig.parts.publishing, "attempt 2 stays on air")
      } finally {
        rig.parts.probeAnswer = null
      }
      both(rig, 31_000)
    }

  /**
   * N45 R2-M1 ruling (re-review 2, probe I): backed off, the app's return to the foreground still probes at once. The
   * operator is there, so one probe goes through the 30 s floor: one per return, never a loop, so with the camera still
   * failing the next probe waits the floor out again. Mended, the return brings it back at once, not 29 s later.
   */
  @Test
  fun `N45 R2-M1 backed off, each return to the foreground probes once, at once, through the 30 s floor`() =
    runTest {
      val rig = Rig(this)
      live(rig)
      val reopens = { rig.executed.count { it == Command.ReopenCamera } }
      rig.parts.probeAnswer = Probe.Opened("0")
      rig.parts.losesOnReopen = true
      try {
        rig.parts.lose("0")
        until(rig, 20_000) { reopens() == 3 } // at 5, 10 and 15 s
        both(rig, 2_000) // the third retake told: backed off, the next probe due 30 s on
        assertEquals(3, reopens())
        rig.run.foreground()
        until(rig, 1_100) { reopens() == 4 }
        both(rig, 25_000)
        assertEquals(4, reopens(), "one probe per return: the floor holds after it")

        rig.parts.losesOnReopen = false // the camera mended, and the operator comes back
        rig.run.foreground()
        until(rig, 1_100) { reopens() == 5 }
        both(rig, 200)
        rig.engine.send(Input.Frames(1, 40, 60))
        both(rig, 500)
        rig.engine.send(Input.Frames(1, 55, 83))
        both(rig, 500)
        assertEquals(CameraState.OWN, rig.engine.phase.session?.camera, "resumed")
        assertHeld(rig, "the returns")
      } finally {
        rig.parts.probeAnswer = null
        rig.parts.losesOnReopen = false
      }
      both(rig, 31_000)
    }

  /**
   * N45 R2-M1: the app's return and Camera2's word that the camera may be free come together (the holder closes its
   * camera as it leaves the screen). One probe answers both: the next comes 5 s after it, not at the 1 s floor.
   */
  @Test
  fun `N45 R2-M1 a return and Camera2's word heard together are one probe`() =
    runTest {
      val rig = Rig(this)
      live(rig)
      rig.parts.probeAnswer = HELD
      try {
        rig.parts.lose("0")
        both(rig, 6_500) // refused at 5 s; the next is due at 10 s
        assertEquals(1, rig.parts.probeCount)
        rig.run.mayBeFree()
        rig.run.foreground()
        both(rig, 300)
        assertEquals(2, rig.parts.probeCount, "at once")
        both(rig, 3_000)
        assertEquals(2, rig.parts.probeCount, "one probe answered both words")
      } finally {
        rig.parts.probeAnswer = null
      }
      both(rig, 31_000)
    }

  private companion object {
    const val STEP_MS = 100L

    /** N45 I1: a probe's answer while another app holds a camera ours cannot open beside it (error 2). */
    val HELD = Probe.Refused("max-in-use")
  }
}
