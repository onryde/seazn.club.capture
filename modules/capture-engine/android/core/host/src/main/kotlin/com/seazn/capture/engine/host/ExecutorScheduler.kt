package com.seazn.capture.engine.host

import com.seazn.capture.engine.core.Cancellable
import com.seazn.capture.engine.core.Scheduler
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicLong

/**
 * The engine's one thread, `capture-engine`. A `ScheduledThreadPoolExecutor` runs equal due times in
 * the order they were submitted, so an ack posted after an input's own tasks is written after them (CD8).
 */
class ExecutorScheduler : Scheduler {
  private val executor = Executors.newSingleThreadScheduledExecutor { task -> Thread(task, "capture-engine").apply { isDaemon = true } }
  private val posted = AtomicLong()

  override fun schedule(delayMs: Long, task: () -> Unit): Cancellable {
    posted.incrementAndGet()
    val future = executor.schedule(task, delayMs.coerceAtLeast(0), TimeUnit.MILLISECONDS)
    return Cancellable { future.cancel(false) }
  }

  /**
   * Waits until the work already due has run: a marker task with no delay, repeated until no task was
   * posted while it waited. A task due later (the next tick) is not waited for.
   */
  fun drain() {
    while (true) {
      val before = posted.get()
      executor.schedule({}, 0, TimeUnit.MILLISECONDS).get()
      if (posted.get() == before) return
    }
  }

  fun shutdown() {
    executor.shutdownNow()
  }
}
