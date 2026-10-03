package com.seazn.capture.engine.adapter

import com.seazn.capture.engine.core.RecordEntry

/**
 * CD33, carry 14's evidence. Ticks are 500 ms apart; two more than [LATE_MS] apart while [observe]'s
 * `wakeHeld` is true mean the thread stalled or the phone slept through the wake lock. `wakeHeld` is
 * the caller's `phase is Phase.Paired || phase.holdsBroadcast` (Task 20's `BridgeCore.published`):
 * Paired, or a broadcast held. Otherwise the tick may pause in deep sleep, which is harmless (CD10),
 * so it is not recorded and the baseline restarts. Scheduler thread only.
 */
class TickLateness {
  private var lastMs: Long? = null

  fun observe(monoMs: Long, wakeHeld: Boolean): RecordEntry? {
    val last = lastMs
    lastMs = if (wakeHeld) monoMs else null
    if (!wakeHeld || last == null) return null
    val gap = monoMs - last
    return if (gap > LATE_MS) RecordEntry("tick-late", listOf("gapMs" to gap)) else null
  }

  companion object {
    const val LATE_MS = 1_000L
  }
}

/**
 * CD33, research Open 11. Read with each Frames poll (500 ms). The video count not moving for more
 * than [GAP_MS] while publishing is one gap, written once, with its length, when video moves again.
 * A stall that never ends is the machine's own business: it becomes a drop or a stall there. A read
 * while not publishing, or for another attempt, is no baseline: the next publishing read is.
 * Scheduler thread only.
 */
class FrameGaps {
  private var attempt: Int? = null
  private var lastVideo = 0L
  private var movedAtMs = 0L

  fun read(attemptId: Int, video: Long, monoMs: Long, publishing: Boolean): RecordEntry? {
    if (!publishing || attemptId != attempt) {
      attempt = if (publishing) attemptId else null
      lastVideo = video
      movedAtMs = monoMs
      return null
    }
    if (video == lastVideo) return null
    val gap = monoMs - movedAtMs
    lastVideo = video
    movedAtMs = monoMs
    return if (gap > GAP_MS) RecordEntry("frames-gap", listOf("attempt" to attemptId, "gapMs" to gap)) else null
  }

  companion object {
    const val GAP_MS = 500L
  }
}
