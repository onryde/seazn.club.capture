package com.seazn.capture.engine.adapter

import com.seazn.capture.engine.core.Readiness

/**
 * Review C4a I-1 (ruling C4a-I1): sound is held the way Task 17 holds held ([PoseTracker]). A level on
 * the other side of the floor turns [sound] only at a reading that finds its run on that side at least
 * [HeldPose.HOLD_MS] old: never at a run's first reading, and both ways. The floor is
 * `Readiness.sound`'s own, unchanged, so a NaN reads silent.
 *
 * The glue reads the peak every 500 ms (Task 33, `READINESS_MS`), so a real change shows at its second
 * reading, about 500 ms on. Without the hold, a peak hovering at 0.049 and 0.051 turned sound at every
 * reading: 1 200 record lines in ten minutes, each also an input to the machine. One thread.
 */
class SoundHold {
  var sound = false
    private set

  /** The side of the floor the current run is on, and when it began. Before any reading, silent from 0. */
  private var runAbove = false
  private var runSinceMs = 0L

  /** The new [sound] when this reading turns it, or null. */
  fun sample(peak: Double, monoMs: Long): Boolean? {
    val above = Readiness.UNKNOWN.copy(audioPeak = peak).sound
    if (above != runAbove) {
      runAbove = above
      runSinceMs = monoMs
    }
    if (above == sound || monoMs - runSinceMs < HeldPose.HOLD_MS) return null
    sound = above
    return sound
  }
}
