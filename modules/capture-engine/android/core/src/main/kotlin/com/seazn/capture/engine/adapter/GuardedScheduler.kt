package com.seazn.capture.engine.adapter

import com.seazn.capture.engine.core.Cancellable
import com.seazn.capture.engine.core.Scheduler

/**
 * Carry 15: whatever a task throws, `Error` included, stops at the task boundary. It is handed to
 * [onFailure] (which records it and classifies it) and the thread lives on. Plan B's engine rethrows
 * an `Error` after publishing; on a bare Handler that would end the scheduler and freeze the HUD.
 */
class GuardedScheduler(private val inner: Scheduler, private val onFailure: (Throwable) -> Unit) : Scheduler {
  /** Tasks that threw. Written on the scheduler's thread only; volatile, so any thread reads it current. */
  @Volatile
  var caught: Int = 0
    private set

  override fun schedule(delayMs: Long, task: () -> Unit): Cancellable =
    inner.schedule(delayMs) {
      try {
        task()
      } catch (failure: Throwable) {
        caught += 1
        try {
          onFailure(failure)
        } catch (_: Throwable) {
          // The reporter failing must not end the thread either; the count still says something broke.
        }
      }
    }
}
