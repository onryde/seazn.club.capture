package com.seazn.p5spike

import io.github.thibaultbee.streampack.core.elements.utils.CoroutineScheduler
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.concurrent.atomic.AtomicInteger
import kotlin.time.Duration.Companion.milliseconds

/**
 * Vendor behaviour the regulator's wiring depends on, pinned so an upgrade that changes it goes red.
 *
 * StreamPack 3.2.0's `IntervalBitrateRegulatorController` ticks through `CoroutineScheduler`, whose
 * `stop()` cancels its own scope. `EncodingPipelineOutput` stops the controller every time streaming
 * stops and starts the same instance when streaming resumes — into a cancelled scope, where it never
 * ticks. Installed once, regulation would silently end at the first reconnect. So `SpikeSession`
 * installs a fresh controller for every attempt, which is also how the regulator follows the transport.
 */
class StreamPackSchedulerTest {
  @Test
  fun `StreamPack's interval scheduler never ticks again once it has been stopped`() = runBlocking {
    val ticks = AtomicInteger()
    val scheduler = CoroutineScheduler(20.milliseconds, Dispatchers.Default) { ticks.incrementAndGet() }

    scheduler.start()
    delay(200)
    scheduler.stop()
    delay(50)
    val beforeRestart = ticks.get()
    scheduler.start()
    delay(200)
    scheduler.stop()

    assertTrue("it ticked before the stop", beforeRestart > 0)
    assertEquals(beforeRestart, ticks.get())
  }
}
