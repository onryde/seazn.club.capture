package com.seazn.capture.engine.core

enum class StallCause(override val wire: String) : Wire {
  NO_FIRST_FRAME("no-first-frame"),
  NO_VIDEO("no-video"),
  BELOW_FLOOR("below-floor"),
}

sealed interface StallVerdict {
  data object None : StallVerdict

  /** The camera is taken (F-P5-10): video may stop, and nothing is rebuilt, because a rebuild buys nothing. */
  data object Held : StallVerdict

  data class Rebuild(val cause: StallCause, val msSinceAdvance: Long, val videoFps: Double?, val audioFps: Double?) :
    StallVerdict
}

data class FrameReading(val atMs: Long, val video: Long, val audio: Long)

/**
 * One attempt's view of the encoded frame counters (F-P5-4, F-P5-6, F-P5-9, F-P5-10). It decides two
 * things: whether video is advancing, which is the LIVE gate, and when the pipeline must be rebuilt.
 * It rebuilds nothing itself; the machine does, as a new attempt with a new watchdog.
 */
data class StallWatchdog(
  val startedAtMs: Long,
  val lastVideo: Long? = null,
  val lastAdvanceAtMs: Long? = null,
  /** Readings since the first frame, pruned to one window. */
  val readings: List<FrameReading> = emptyList(),
  val videoFps: Double? = null,
  val audioFps: Double? = null,
) {
  /** The LIVE gate: an encoded video frame arrived within the last [STALL_MS]. */
  fun advancing(nowMs: Long): Boolean = lastAdvanceAtMs?.let { nowMs - it < STALL_MS } ?: false

  /**
   * Cumulative counts for this attempt. The rate floor is judged here, on a reading where video
   * advanced, so a picture that stops dead reaches the zero test in [tick] rather than reading as
   * starved on its way there. A camera that is taken is never judged.
   *
   * @param micSilenced the system has silenced the microphone (F-P5-8). The audio floor is not
   *   judged then: the source is silenced, and a rebuild cannot bring it back. The video floor is.
   */
  fun frames(
    video: Long,
    audio: Long,
    nowMs: Long,
    cameraTaken: Boolean,
    micSilenced: Boolean,
  ): Pair<StallWatchdog, StallVerdict> {
    val previous = lastVideo
    if (previous == null || video < previous) return copy(lastVideo = video, readings = emptyList()) to StallVerdict.None
    if (video == previous) {
      val kept = if (lastAdvanceAtMs == null) readings else pruned(readings + FrameReading(nowMs, video, audio), nowMs)
      return copy(readings = kept) to StallVerdict.None
    }
    val advanced =
      copy(lastVideo = video, lastAdvanceAtMs = nowMs, readings = pruned(readings + FrameReading(nowMs, video, audio), nowMs))
    if (cameraTaken) return advanced.copy(readings = emptyList(), videoFps = null, audioFps = null) to StallVerdict.None
    return advanced.judgeRate(nowMs, micSilenced)
  }

  /** The time-based rules: the first-frame grace and the zero test. */
  fun tick(nowMs: Long, cameraTaken: Boolean): Pair<StallWatchdog, StallVerdict> {
    val lastAdvance = lastAdvanceAtMs
    val silentMs = nowMs - (lastAdvance ?: startedAtMs)
    val limit = if (lastAdvance == null) FIRST_FRAME_GRACE_MS else STALL_MS
    return when {
      silentMs < limit -> this to StallVerdict.None
      cameraTaken -> copy(readings = emptyList()) to StallVerdict.Held
      lastAdvance == null -> this to StallVerdict.Rebuild(StallCause.NO_FIRST_FRAME, silentMs, null, null)
      else -> this to StallVerdict.Rebuild(StallCause.NO_VIDEO, silentMs, videoFps, audioFps)
    }
  }

  /** Our own camera reopen finished: the window starts again and the reopened camera gets a full [STALL_MS]. */
  fun rebaselined(nowMs: Long): StallWatchdog =
    copy(lastVideo = null, lastAdvanceAtMs = nowMs, readings = emptyList(), videoFps = null, audioFps = null)

  private fun judgeRate(nowMs: Long, micSilenced: Boolean): Pair<StallWatchdog, StallVerdict> {
    val base = readings.firstOrNull()?.takeIf { it.atMs <= nowMs - WINDOW_MS } ?: return this to StallVerdict.None
    val last = readings.last()
    val seconds = (last.atMs - base.atMs) / 1_000.0
    val video = oneDecimal((last.video - base.video) / seconds)
    val audio = oneDecimal((last.audio - base.audio) / seconds)
    val rated = copy(videoFps = video, audioFps = audio)
    if (video >= VIDEO_FLOOR_FPS && audio >= AUDIO_FLOOR_FPS) return rated to StallVerdict.None
    if (micSilenced && video >= VIDEO_FLOOR_FPS) return rated to StallVerdict.None
    return rated to StallVerdict.Rebuild(StallCause.BELOW_FLOOR, 0, video, audio)
  }

  /** Keeps the newest reading and the latest one at least [WINDOW_MS] older, which a rate is taken over. */
  private fun pruned(all: List<FrameReading>, nowMs: Long): List<FrameReading> {
    val windowStart = nowMs - WINDOW_MS
    val baseIndex = all.indexOfLast { it.atMs <= windowStart }
    return if (baseIndex <= 0) all else all.drop(baseIndex)
  }

  /** Truncated, not rounded: a rate shown is under a floor exactly when the rate judged was. */
  private fun oneDecimal(value: Double): Double = Math.floor(value * 10) / 10.0

  companion object {
    /** 90 missing frames at 30 fps. F-P5-6's counter was flat for 11 minutes: no near miss. */
    const val STALL_MS = 3_000L

    /** The encoders start after the endpoint opens (P5: "video-stalled 5.0 s after publishing"). */
    const val FIRST_FRAME_GRACE_MS = 5_000L

    /** F-P5-9's rolling window. */
    const val WINDOW_MS = 3_000L

    /** F-P5-9: "fewer than 10 video frames/s or 20 audio frames/s over 3 s". */
    const val VIDEO_FLOOR_FPS = 10.0
    const val AUDIO_FLOOR_FPS = 20.0
  }
}
