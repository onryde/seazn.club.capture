package com.seazn.capture.engine.capture.run

import com.seazn.capture.engine.adapter.AttemptSignals
import com.seazn.capture.engine.adapter.CameraAvailability
import com.seazn.capture.engine.core.Command
import com.seazn.capture.engine.core.Configs
import com.seazn.capture.engine.core.Engine
import com.seazn.capture.engine.core.FakeClock
import com.seazn.capture.engine.core.FakeScheduler
import com.seazn.capture.engine.core.Input
import com.seazn.capture.engine.core.PairRequest
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
  private class Rig(scope: TestScope) {
    val clock = FakeClock()
    val scheduler = FakeScheduler(clock)
    val lines = mutableListOf<String>()
    val executed = mutableListOf<Command>()
    val parts = FakeParts()
    val told = Told()
    lateinit var run: CaptureRun
    val engine =
      Engine(clock, scheduler, commands = { executed += it; run.execute(it) }, snapshots = {}, record = SessionRecord { lines += it })

    init {
      // BridgeCore's cameraBusy: the camera is taken (its `holds` check is BridgeCoreTest's).
      val busy = { request: PairRequest -> told.busy += request; engine.send(Input.CameraContended); scheduler.advanceBy(0) }
      val calls = told.calls(report = { told.reports += it; engine.send(it); scheduler.advanceBy(0) }, cameraBusy = busy)
      run = CaptureRun(parts, AttemptSignals(), CameraAvailability(), calls, { Side.LEFT }, scope.queueScope())
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
   * C7 carry, through the real machine: StreamPack 3.2.0 opens the camera lazily, so another app's hold
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
}
