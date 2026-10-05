package com.seazn.capture.engine.capture.run

import com.seazn.capture.engine.adapter.AttemptSignals
import com.seazn.capture.engine.adapter.CameraAvailability
import com.seazn.capture.engine.core.Command
import com.seazn.capture.engine.core.Configs
import com.seazn.capture.engine.core.Engine
import com.seazn.capture.engine.core.FakeClock
import com.seazn.capture.engine.core.FakeScheduler
import com.seazn.capture.engine.core.FallbackPolicy
import com.seazn.capture.engine.core.Input
import com.seazn.capture.engine.core.NotReady
import com.seazn.capture.engine.core.PairRequest
import com.seazn.capture.engine.core.RtmpsTarget
import com.seazn.capture.engine.core.Phase
import com.seazn.capture.engine.core.SessionMachine
import com.seazn.capture.engine.core.SessionRecord
import com.seazn.capture.engine.core.Side
import com.seazn.capture.engine.core.SrtTarget
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
import kotlin.test.assertTrue

/**
 * C6 CRITICAL, end to end through the real machine: the capture's queue, the real [AttemptSignals] and
 * the real engine, with only StreamPack faked. An attempt's open that answers late is passed through
 * (Task 19, I1), the machine answers it with `Disconnect(n)`, and that must close attempt n alone.
 */
@OptIn(ExperimentalCoroutinesApi::class) // advanceUntilIdle and runCurrent
class CaptureRunMachineTest {
  private class Rig(scope: TestScope, cameras: CameraAvailability = CameraAvailability()) {
    val clock = FakeClock()
    val scheduler = FakeScheduler(clock)
    val lines = mutableListOf<String>()
    val executed = mutableListOf<Command>()
    val parts = FakeParts()
    val told = Told()
    val signals = AttemptSignals()
    lateinit var run: CaptureRun
    val engine =
      Engine(clock, scheduler, commands = { executed += it; run.execute(it) }, snapshots = {}, record = SessionRecord { lines += it })

    init {
      // BridgeCore's cameraBusy: the camera is taken (its `holds` check is BridgeCoreTest's).
      val busy = { request: PairRequest -> told.busy += request; engine.send(Input.CameraContended); scheduler.advanceBy(0) }
      val calls = told.calls(report = { told.reports += it; engine.send(it); scheduler.advanceBy(0) }, cameraBusy = busy)
      run = CaptureRun(parts, signals, cameras, calls, { Side.LEFT }, scope.queueScope())
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
}
