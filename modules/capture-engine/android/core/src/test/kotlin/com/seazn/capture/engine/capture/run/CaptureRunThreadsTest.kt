package com.seazn.capture.engine.capture.run

import com.seazn.capture.engine.adapter.AttemptSignals
import com.seazn.capture.engine.adapter.CameraAvailability
import com.seazn.capture.engine.core.Command
import com.seazn.capture.engine.core.Configs
import com.seazn.capture.engine.core.Input
import com.seazn.capture.engine.core.Side
import java.util.Collections
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.asCoroutineDispatcher
import kotlinx.coroutines.cancel
import kotlinx.coroutines.job
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/**
 * R3 on real threads, as `Dispatchers.Default` runs the capture: the drop watch and the run's consumer
 * are two coroutines, and the watch can already be past the endpoint's close when the consumer stops
 * that attempt. Cancelling the watch is then too late; the stop asked for is what keeps it from a drop,
 * even once a newer attempt has begun. Latches order the two threads, the same on every run.
 */
class CaptureRunThreadsTest {
  private fun connect(id: Int) = Command.Connect(id, Configs.srt, startBitrateBps = 3_000_000, maxBwBytesPerSecond = 1_000_000)

  /**
   * Attempt 1 publishes; the far end closes it and the watch holds, past the close, while [stop] runs on
   * the other thread to the point [reached] names. Returns what the run reported once the watch ended.
   */
  private fun raced(stop: (CaptureRun, FakeParts, CountDownLatch) -> Unit): List<Input> {
    val pool = Executors.newFixedThreadPool(2)
    val scope = CoroutineScope(pool.asCoroutineDispatcher() + SupervisorJob())
    try {
      val parts = FakeParts()
      val reports = Collections.synchronizedList(mutableListOf<Input>())
      val connected = CountDownLatch(1)
      val seen = CountDownLatch(1)
      val go = CountDownLatch(1)
      val reached = CountDownLatch(1)
      parts.afterClose = {
        seen.countDown()
        go.await(5, TimeUnit.SECONDS) // this thread holds here, past the close, until the stop has run
      }
      val calls = Told().calls(report = { reports += it; if (it == Input.Connected(1)) connected.countDown() })
      val run = CaptureRun(parts, AttemptSignals(), CameraAvailability(), calls, { Side.LEFT }, scope)
      run.open(Configs.pairRequest())
      run.execute(connect(1))
      assertTrue(connected.await(5, TimeUnit.SECONDS), "attempt 1 connected")
      parts.farEndCloses()
      assertTrue(seen.await(5, TimeUnit.SECONDS), "the watch saw the close")
      stop(run, parts, reached)
      assertTrue(reached.await(5, TimeUnit.SECONDS), "the stop ran on the other thread")
      go.countDown()
      val consumer = scope.coroutineContext.job.children.first()
      runBlocking { withTimeout(5_000) { scope.coroutineContext.job.children.filter { it !== consumer }.forEach { it.join() } } }
      parts.gates.values.forEach { it.complete(true) }
      return reports.toList()
    } finally {
      scope.cancel()
      pool.shutdownNow()
    }
  }

  @Test
  fun `R3 a Disconnect asked while the drop watch is already past the close is no drop`() {
    val reports = raced { run, parts, reached ->
      parts.stopped = { reached.countDown() }
      run.execute(Command.Disconnect(1))
    }
    assertEquals(listOf<Input>(Input.Connected(1)), reports)
  }

  @Test
  fun `R3 a close while the drop watch is already past the close is no drop`() {
    val reports = raced { run, parts, reached ->
      parts.stopped = { reached.countDown() }
      run.close()
    }
    assertEquals(listOf<Input>(Input.Connected(1)), reports)
  }

  @Test
  fun `R3 a Rebuild's stop stays asked once its next attempt has begun - the late watch is no drop`() {
    val reports = raced { run, parts, reached ->
      parts.gates[2] = CompletableDeferred() // attempt 2 is mid-connect, not yet heard by the signals
      parts.starting = { id -> if (id == 2) reached.countDown() }
      run.execute(Command.Rebuild(1, connect(2)))
    }
    assertEquals(emptyList(), reports.filterIsInstance<Input.Dropped>(), "$reports")
    assertEquals(Input.Connected(1), reports.first())
  }
}
