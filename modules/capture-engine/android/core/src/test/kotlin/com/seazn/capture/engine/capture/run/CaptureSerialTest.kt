package com.seazn.capture.engine.capture.run

import com.seazn.capture.engine.adapter.AttemptSignals
import com.seazn.capture.engine.adapter.CameraAvailability
import com.seazn.capture.engine.adapter.EncoderKeys
import com.seazn.capture.engine.core.Command
import com.seazn.capture.engine.core.Configs
import com.seazn.capture.engine.core.Side
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertIs
import kotlin.test.assertTrue

/**
 * PV38: the capture's calls run one at a time, in the order they were made, and the caller returns at
 * once. Each fake call takes virtual time, so two calls that overlapped would interleave in the log.
 * Single-mode: the capture has no sport, orientation aside (the Orient case).
 */
@OptIn(ExperimentalCoroutinesApi::class) // advanceUntilIdle and runCurrent
class CaptureSerialTest {
  private val left = EncoderKeys.surfaceRotation(Side.LEFT)
  private val right = EncoderKeys.surfaceRotation(Side.RIGHT)

  private fun connect(id: Int) = Command.Connect(id, Configs.srt, startBitrateBps = 3_000_000, maxBwBytesPerSecond = 1_000_000)

  private fun TestScope.opened(parts: FakeParts, told: Told = Told()): CaptureRun {
    val run = CaptureRun(parts, AttemptSignals(), CameraAvailability(), told.calls(), { Side.LEFT }, queueScope())
    run.open(Configs.pairRequest())
    advanceUntilIdle()
    assertEquals(listOf("build $left", "build done"), parts.log)
    parts.log.clear()
    return run
  }

  @Test
  fun `PV38 close then open - the release ends before the build starts, and neither runs on the caller`() =
    runTest {
      val parts = FakeParts()
      val run = opened(parts)
      run.close()
      run.open(Configs.pairRequest())
      assertEquals(emptyList(), parts.log, "close and open returned before either ran")
      advanceUntilIdle()
      assertEquals(listOf("release", "release done", "build $left", "build done"), parts.log)
    }

  @Test
  fun `PV38 Orient then Connect - the rebuild for the other side ends before the connect starts`() =
    runTest {
      val parts = FakeParts()
      val told = Told()
      val run = opened(parts, told)
      run.execute(Command.Orient(Side.RIGHT))
      run.execute(connect(1))
      advanceUntilIdle()
      assertTrue(left != right, "the two sides encode at different rotations, so the rebuild is witnessed")
      assertEquals(listOf("release", "release done", "build $right", "build done", "before 1", "start 1", "start done"), parts.log)
      assertEquals(listOf("capture-rebuilt"), told.lines.map { it.kind })
    }

  @Test
  fun `PV38 Stop then close - the stop and the broadcast's end come before the release`() =
    runTest {
      val parts = FakeParts()
      val run = opened(parts)
      run.execute(connect(1))
      advanceUntilIdle()
      parts.log.clear()
      run.execute(Command.StopBroadcast)
      run.close()
      advanceUntilIdle()
      assertEquals(listOf("stop 1", "stop done", "after", "release", "release done"), parts.log)
    }

  @Test
  fun `I5 a block that throws is handed to failure, and the next block still runs`() =
    runTest {
      val failures = mutableListOf<Throwable>()
      val serial = CaptureSerial(queueScope()) { failures += it }
      val ran = mutableListOf<String>()
      serial.submit { throw IllegalStateException("first") }
      serial.submit { ran += "second" }
      advanceUntilIdle()
      assertEquals(listOf("first"), failures.map { it.message })
      assertEquals(listOf("second"), ran)
    }

  @Test
  fun `the scope's cancellation is no block's failure, and a block submitted after it is reported, never lost`() =
    runTest {
      val failures = mutableListOf<Throwable>()
      val scope = CoroutineScope(StandardTestDispatcher(testScheduler) + Job())
      val serial = CaptureSerial(scope) { failures += it }
      serial.submit { delay(1_000) }
      runCurrent()
      scope.cancel()
      advanceUntilIdle()
      assertEquals(emptyList(), failures, "the waiting block was cancelled with its scope")
      serial.submit { error("never runs") }
      advanceUntilIdle()
      assertEquals(1, failures.size, failures.toString())
      assertIs<IllegalStateException>(failures.single())
      assertEquals("the capture's queue has ended", failures.single().message)
    }
}
