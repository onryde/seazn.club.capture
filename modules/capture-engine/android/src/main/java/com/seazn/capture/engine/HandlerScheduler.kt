package com.seazn.capture.engine

import android.os.Handler
import com.seazn.capture.engine.core.Cancellable
import com.seazn.capture.engine.core.Scheduler

/** CD9: the engine's one serial thread. `postDelayed` runs on uptime; the wake lock (CD10) keeps uptime and the clock together. */
class HandlerScheduler(private val handler: Handler) : Scheduler {
  override fun schedule(delayMs: Long, task: () -> Unit): Cancellable {
    val runnable = Runnable(task)
    handler.postDelayed(runnable, delayMs)
    return Cancellable { handler.removeCallbacks(runnable) }
  }
}
