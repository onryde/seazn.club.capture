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
 *
 * Session 7, F-S7-3: the poller reads [AttemptPollers.FRAMES_MS] after its last read ENDED, so reads land
 * a little more than that apart (384 of 390 device lines were 501–520 ms, video moving at every read).
 * A gap is therefore a publishing read that saw the count unmoved, then a move more than [GAP_MS] after
 * the last one. Its lines are held to [CappedLines.MAX_LINES] a minute; they carry no state, so a
 * minute's held count rides on the next line written, never a flush.
 */
class FrameGaps {
  private var attempt: Int? = null
  private var lastVideo = 0L
  private var movedAtMs = 0L

  /** A publishing read since the last move saw the count where it was. */
  private var unmoved = false
  private val lines = CappedLines("frames-gap")

  fun read(attemptId: Int, video: Long, monoMs: Long, publishing: Boolean): RecordEntry? {
    if (!publishing || attemptId != attempt) {
      attempt = if (publishing) attemptId else null
      lastVideo = video
      movedAtMs = monoMs
      unmoved = false
      return null
    }
    if (video == lastVideo) {
      unmoved = true
      return null
    }
    val gap = monoMs - movedAtMs
    val seen = unmoved
    lastVideo = video
    movedAtMs = monoMs
    unmoved = false
    return if (seen && gap > GAP_MS) lines.line(monoMs, listOf("attempt" to attemptId, "gapMs" to gap)) else null
  }

  companion object {
    const val GAP_MS = 500L
  }
}
