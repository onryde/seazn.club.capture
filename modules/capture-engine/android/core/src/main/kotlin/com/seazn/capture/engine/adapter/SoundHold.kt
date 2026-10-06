package com.seazn.capture.engine.adapter

import com.seazn.capture.engine.core.Readiness

/**
 * Sound, with hysteresis (owner, 2026-10-05, superseding ruling C4a-I1's 300 ms both ways): on a
 * staging viewfinder the two-reading hold still flipped sound 27 times in ten minutes. Now:
 * - a reading at or above the floor is sound at once, however long the silence before it;
 * - sound turns silent only at a reading that finds the readings below the floor [silenceMs] old
 *   without a break; one reading at or above it starts that again;
 * - the system silencing our recording (F-P5-8, [micSilenced]) is silent at once, and a loud reading
 *   is not sound until the system restores it: the meter's next reading is the loudest of the last
 *   500 ms, heard before the silencing;
 * - the capture's close ([reset], the C4a carry) is silent at once.
 *
 * The floor is `Readiness.sound`'s own, unchanged, so a NaN reads silent. The cost, accepted by the
 * owner: a mic that really dies says so up to 15 s late, unless the system silenced it. The glue reads
 * the peak every 500 ms (Task 33, `READINESS_MS`). One thread.
 */
class SoundHold(private val silenceMs: Long = SILENCE_MS) {
  var sound = false
    private set

  /** While sound, when the current run of readings below the floor began; null when there is none. */
  private var quietSinceMs: Long? = null

  /** The system's last word on our recording (`MicSilenceWatch`), kept across the capture's close. */
  private var systemSilenced = false

  /** The capture closed: silent at once, and the next opening's readings start afresh. */
  fun reset() {
    sound = false
    quietSinceMs = null
  }

  /** The system silenced our recording, or restored it. The new [sound] when this turns it, or null. */
  fun micSilenced(silenced: Boolean): Boolean? {
    systemSilenced = silenced
    if (!silenced || !sound) return null
    reset()
    return false
  }

  /** The new [sound] when this reading turns it, or null. */
  fun sample(peak: Double, monoMs: Long): Boolean? {
    val above = Readiness.UNKNOWN.copy(audioPeak = peak).sound
    if (above) {
      quietSinceMs = null
      if (sound || systemSilenced) return null
      sound = true
      return true
    }
    if (!sound) return null
    val since = quietSinceMs ?: monoMs.also { quietSinceMs = it }
    if (monoMs - since < silenceMs) return null
    reset()
    return false
  }

  companion object {
    /**
     * Owner, 2026-10-05 (readiness hysteresis): sound turns silent only after this long below the floor. The
     * phone's, always: only the JVM host, which runs the JS contract in real time, passes a shorter one.
     */
    const val SILENCE_MS = 15_000L
  }
}
