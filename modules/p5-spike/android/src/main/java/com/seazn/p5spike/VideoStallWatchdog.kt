package com.seazn.p5spike

/**
 * What native says about the picture in the ~1 Hz snapshot. JS only renders it (AGENTS.md §2), and
 * the HUD says LIVE for [OK] alone.
 */
enum class VideoState(val wire: String) {
  /** Not publishing, or publishing with no video frame yet. It claims nothing either way. */
  IDLE("idle"),

  /** Publishing, with video frames advancing. */
  OK("ok"),

  /** A stall was detected, and the publish loop has been asked to end the attempt. */
  STALLED("stalled"),

  /** The loop ended the attempt to rebuild the pipeline. Video is awaited in the next publish. */
  RECOVERING("recovering"),

  /**
   * Recoveries did not bring video back, and no more will be tried. Publishing continues. Leaves
   * this state only when video returns or the operator sends a new intent.
   */
  FAILED("failed"),
}

sealed interface VideoVerdict {
  /** No video frame for [msSinceAdvance] while publishing. Answered by a recovery through the publish loop. */
  data class Stalled(
    val msSinceAdvance: Long,
    val videoFrames: Long,
    val audioAdvancing: Boolean,
    val transport: String?,
  ) : VideoVerdict

  /** Video is advancing again after [msStalled] without a frame, any reconnect included. */
  data class Recovered(val msStalled: Long) : VideoVerdict

  /** [attempts] recoveries in a row brought no video back within the resume window. */
  data class RecoveryFailed(val attempts: Int) : VideoVerdict
}

/**
 * F-P5-6: after a reconnect, the encoder received no frames for 11 minutes. Meanwhile audio flowed,
 * Cloudflare said connected, and the HUD said LIVE. Only the video frame counter showed it, and a
 * further reconnect healed it.
 *
 * This watches that counter. It detects stalls and keeps the recovery count; it never reconnects.
 * The publish loop is the single authority over the session (AGENTS.md §2): it ends the attempt when
 * a [VideoVerdict.Stalled] asks, and reports back through [recoveryStarted].
 *
 * Pure, with an injected clock, so every rule is a JVM test. Synchronized because the watchdog tick,
 * the publish loop, the intent actor and the sampler all call in.
 */
class VideoStallWatchdog(private val clock: () -> Long) {
  @Volatile var state: VideoState = VideoState.IDLE
    private set

  /** Recoveries started since video last flowed. */
  private var attempts = 0

  /** When video was last seen before the open stall episode; null when none is open. */
  private var episodeSinceMs: Long? = null

  private var period: Period? = null

  /**
   * One publish, from its first publishing tick to its last. Time between two publishes is never
   * counted: a drop, a retry and a connect are the publish loop's to report, not a stall.
   */
  private class Period(val startedAtMs: Long, var videoFrames: Long, var audioAtAdvance: Long?) {
    var lastAdvanceMs: Long? = null
    var reported = false
  }

  @Synchronized
  fun tick(publishing: Boolean, videoFrames: Long?, audioFrames: Long?, transport: String?): List<VideoVerdict> {
    if (!publishing || videoFrames == null) {
      endPeriod()
      return emptyList()
    }
    val now = clock()
    val current = period ?: Period(now, videoFrames, audioFrames).also { period = it }
    return if (videoFrames > current.videoFrames) {
      advanced(current, now, videoFrames, audioFrames)
    } else {
      judge(current, now, videoFrames, audioFrames, transport)
    }
  }

  /** The publish loop ended the attempt for a stall. The attempt number, or null when no stall was pending. */
  @Synchronized
  fun recoveryStarted(): Int? {
    if (state != VideoState.STALLED) return null
    attempts += 1
    state = VideoState.RECOVERING
    return attempts
  }

  /** A new operator intent: whatever happened before belongs to the last session. */
  @Synchronized
  fun reset() {
    period = null
    episodeSinceMs = null
    attempts = 0
    state = VideoState.IDLE
  }

  private fun advanced(period: Period, now: Long, videoFrames: Long, audioFrames: Long?): List<VideoVerdict> {
    period.videoFrames = videoFrames
    period.lastAdvanceMs = now
    period.audioAtAdvance = audioFrames
    period.reported = false
    state = VideoState.OK
    val since = episodeSinceMs ?: return emptyList()
    episodeSinceMs = null
    attempts = 0
    return listOf(VideoVerdict.Recovered(msStalled = now - since))
  }

  private fun judge(
    period: Period,
    now: Long,
    videoFrames: Long,
    audioFrames: Long?,
    transport: String?,
  ): List<VideoVerdict> {
    if (period.reported || state == VideoState.FAILED) return emptyList()
    val lastSeen = period.lastAdvanceMs
    val silentSince = lastSeen ?: period.startedAtMs
    val limit = when {
      lastSeen != null -> STALL_MS
      episodeSinceMs != null -> RESUME_WINDOW_MS
      else -> FIRST_FRAME_GRACE_MS
    }
    if (now - silentSince < limit) return emptyList()
    period.reported = true
    if (episodeSinceMs != null && attempts >= MAX_RECOVERIES) {
      state = VideoState.FAILED
      return listOf(VideoVerdict.RecoveryFailed(attempts))
    }
    val since = episodeSinceMs ?: silentSince.also { episodeSinceMs = it }
    state = VideoState.STALLED
    val audioAdvancing = audioFrames != null && (period.audioAtAdvance?.let { audioFrames > it } ?: false)
    return listOf(VideoVerdict.Stalled(now - since, videoFrames, audioAdvancing, transport))
  }

  private fun endPeriod() {
    period = null
    if (state == VideoState.OK) state = VideoState.IDLE
  }

  companion object {
    /**
     * 90 missing frames at 30 fps. A healthy counter advances on every 500 ms tick, and F-P5-6's did
     * not advance for 11 minutes, so there is no near miss to confuse with it.
     */
    const val STALL_MS = 3_000L

    /** Before the first frame of a publish: the encoders start after the endpoint opens, so do not fire at startup. */
    const val FIRST_FRAME_GRACE_MS = 5_000L

    /** After a recovery, how long the next publish gets to bring video back before that recovery counts as failed. */
    const val RESUME_WINDOW_MS = 10_000L

    /** Consecutive failed recoveries before auto-recovery stops. Each one costs viewers a reconnect. */
    const val MAX_RECOVERIES = 3
  }
}
