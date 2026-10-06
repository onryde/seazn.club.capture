package com.seazn.capture.engine.host

import com.seazn.capture.engine.core.Cancellable
import com.seazn.capture.engine.core.Scheduler
import java.util.concurrent.Delayed
import java.util.concurrent.Future
import java.util.concurrent.ScheduledThreadPoolExecutor
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger
import java.util.concurrent.atomic.AtomicLong

/**
 * The engine's one thread, `capture-engine`. A `ScheduledThreadPoolExecutor` runs equal due times in
 * the order they were submitted, so an ack posted after an input's own tasks is written after them (CD8).
 */
class ExecutorScheduler : Scheduler {
  private val executor = ScheduledThreadPoolExecutor(1) { task -> Thread(task, "capture-engine").apply { isDaemon = true } }
  private val posted = AtomicLong()
  private val running = AtomicInteger()

  override fun schedule(delayMs: Long, task: () -> Unit): Cancellable {
    posted.incrementAndGet()
    val counted = {
      running.incrementAndGet()
      try {
        task()
      } finally {
        running.decrementAndGet()
      }
    }
    val future = executor.schedule(counted, delayMs.coerceAtLeast(0), TimeUnit.MILLISECONDS)
    return Cancellable { future.cancel(false) }
  }

  /**
   * The engine's work now (Task 27's quiet): the queued tasks already due, cancelled ones aside, and
   * the one running. A task due later (the next tick, the next beat) is not work now.
   */
  fun dueNow(): Int {
    val due = executor.queue.count { task -> !(task as Future<*>).isCancelled && (task as Delayed).getDelay(TimeUnit.MILLISECONDS) <= 0 }
    return due + running.get()
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
