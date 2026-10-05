package com.seazn.capture.engine.capture.run

import com.seazn.capture.engine.adapter.AttemptSignals
import com.seazn.capture.engine.adapter.CameraAvailability
import com.seazn.capture.engine.core.Command
import com.seazn.capture.engine.core.Configs
import com.seazn.capture.engine.core.Engine
import com.seazn.capture.engine.core.FakeClock
import com.seazn.capture.engine.core.FakeScheduler
import com.seazn.capture.engine.core.Phase
import com.seazn.capture.engine.core.SessionMachine
import com.seazn.capture.engine.core.SessionRecord
import com.seazn.capture.engine.core.Side
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.advanceUntilIdle
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
      val calls = told.calls(report = { told.reports += it; engine.send(it); scheduler.advanceBy(0) })
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
      advanceUntilIdle()
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
}
