package com.seazn.capture.engine.core

enum class StallCause(override val wire: String) : Wire {
  NO_FIRST_FRAME("no-first-frame"),
  NO_VIDEO("no-video"),
  BELOW_FLOOR("below-floor"),
}

sealed interface StallVerdict {
  data object None : StallVerdict

  /**
   * The camera is taken (F-P5-10): video may stop, and nothing is rebuilt, because a rebuild buys
   * nothing. Informational only: production acts on [Rebuild] alone, and the Projection reads the
   * hold from the camera state, not from this verdict.
   */
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
  /** When an encoded video frame last arrived. Only a frame sets it: it is the LIVE gate. */
  val lastAdvanceAtMs: Long? = null,
  /** Our own reopen or switch, which starts the zero test's clock without opening the gate (F-P5-10). */
  val stallFromMs: Long? = null,
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
   * @param micSilenced the system has silenced the microphone (F-P5-8). No rate floor is judged
   *   then: P5's call starved video as well as audio (9.7 and 15.2 a second), and a rebuild cannot
   *   end the call. The rates are still taken, for Diagnostics, and a picture that stops dead is
   *   still rebuilt by the zero test in [tick].
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
    val reading = FrameReading(nowMs, video, audio)
    // An audio counter that went backwards restarts the window at this reading, as video's does, and
    // any video advance in it still counts. Kept readings would rate the restart as negative audio.
    val kept = if (audio < (readings.lastOrNull()?.audio ?: audio)) emptyList() else readings
    if (video == previous) {
      val flat = if (lastAdvanceAtMs == null) kept else pruned(kept + reading, nowMs)
      return copy(readings = flat) to StallVerdict.None
    }
    val advanced = copy(lastVideo = video, lastAdvanceAtMs = nowMs, readings = pruned(kept + reading, nowMs))
    if (cameraTaken) return advanced.copy(readings = emptyList(), videoFps = null, audioFps = null) to StallVerdict.None
    return advanced.judgeRate(nowMs, micSilenced)
  }

  /** The time-based rules: the first-frame grace and the zero test, which a reopen restarts. */
  fun tick(nowMs: Long, cameraTaken: Boolean): Pair<StallWatchdog, StallVerdict> {
    val stallFrom = lastAdvanceAtMs ?: stallFromMs
    val silentMs = nowMs - (stallFrom ?: startedAtMs)
    val limit = if (stallFrom == null) FIRST_FRAME_GRACE_MS else STALL_MS
    return when {
      silentMs < limit -> this to StallVerdict.None
      cameraTaken -> copy(readings = emptyList(), videoFps = null, audioFps = null) to StallVerdict.Held
      stallFrom == null -> this to StallVerdict.Rebuild(StallCause.NO_FIRST_FRAME, silentMs, null, null)
      else -> this to StallVerdict.Rebuild(StallCause.NO_VIDEO, silentMs, videoFps, audioFps)
    }
  }

  /**
   * Our own camera reopen finished, or our own switch began. The zero test counts [STALL_MS] from
   * [fromMs]: the reopen itself, or for a switch the tap when a frame came within [FRAME_SAMPLE_MS]
   * of it (B7 N3), and otherwise the last frame before it (B6 fix 2). Neither is a new frame:
   * [advancing] stays false until one arrives, and the rate window starts at it.
   */
  fun rebaselined(fromMs: Long): StallWatchdog =
    copy(
      lastVideo = null,
      lastAdvanceAtMs = null,
      stallFromMs = fromMs,
      readings = emptyList(),
      videoFps = null,
      audioFps = null,
    )

  private fun judgeRate(nowMs: Long, micSilenced: Boolean): Pair<StallWatchdog, StallVerdict> {
    val base = readings.firstOrNull()?.takeIf { it.atMs <= nowMs - WINDOW_MS } ?: return this to StallVerdict.None
    val last = readings.last()
    val seconds = (last.atMs - base.atMs) / 1_000.0
    val video = oneDecimal((last.video - base.video) / seconds)
    val audio = oneDecimal((last.audio - base.audio) / seconds)
    val rated = copy(videoFps = video, audioFps = audio)
    if (video >= VIDEO_FLOOR_FPS && audio >= AUDIO_FLOOR_FPS) return rated to StallVerdict.None
    if (micSilenced) return rated to StallVerdict.None
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

    /**
     * Frame readings come at least twice a second ([Input.Frames]). A frame within this long of now is
     * the latest reading's: frames were still advancing (B7 N3).
     */
    const val FRAME_SAMPLE_MS = 500L

    /** F-P5-9: "fewer than 10 video frames/s or 20 audio frames/s over 3 s". */
    const val VIDEO_FLOOR_FPS = 10.0
    const val AUDIO_FLOOR_FPS = 20.0
  }
}
