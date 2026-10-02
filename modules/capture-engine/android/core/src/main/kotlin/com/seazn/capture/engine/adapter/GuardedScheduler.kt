package com.seazn.capture.engine.adapter

import com.seazn.capture.engine.core.Cancellable
import com.seazn.capture.engine.core.Scheduler

/**
 * Carry 15: whatever a task throws, `Error` included, stops at the task boundary. It is handed to
 * [onFailure] (which records it and classifies it) and the thread lives on. Plan B's engine rethrows
 * an `Error` after publishing; on a bare Handler that would end the scheduler and freeze the HUD.
 *
 * [onFailure] runs on the scheduler's thread, and must not post work that can fail the same way: a
 * record line it posts, which throws again, would come back to it for ever (review 13, I2). It appends
 * its line where it runs instead. What [onFailure] itself throws is counted and dropped, never handed
 * back to it and never posted again.
 */
class GuardedScheduler(private val inner: Scheduler, private val onFailure: (Throwable) -> Unit) : Scheduler {
  /** Tasks that threw. Written on the scheduler's thread only; volatile, so any thread reads it current. */
  @Volatile
  var caught: Int = 0
    private set

  /** Throws from [onFailure] itself, `Error` included. Task 20 carries both counts to Diagnostics. */
  @Volatile
  var reporterFailures: Int = 0
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
          // The reporter failing must not end the thread either, nor be reported to itself again.
          reporterFailures += 1
        }
      }
    }
}
