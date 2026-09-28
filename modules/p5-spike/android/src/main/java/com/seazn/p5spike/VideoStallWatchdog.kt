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

  /**
   * F-P5-9: publishing with frames still advancing, but the last full window fell below a rate
   * floor. The broadcast is a slideshow or has broken audio. Surfaced only: a reconnect cannot give
   * a camera back to us, so nothing is recovered. Leaves when every judgement for a full window has
   * been above both floors.
   */
  STARVED("starved"),

  /**
   * A stall was detected, and the publish loop has been asked to end the attempt. Under F-P5-10's
   * `hold`, a stall while another app holds a camera stays here with no recovery asked for, until
   * the camera is released or video resumes.
   */
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
  /**
   * No video frame for [msSinceAdvance] while publishing. Answered by a recovery through the publish
   * loop, unless [held].
   */
  data class Stalled(
    val msSinceAdvance: Long,
    val videoFrames: Long,
    val audioAdvancing: Boolean,
    val transport: String?,
    /**
     * How long a starvation episode had been open when this stall took it over, or null when none
     * was. The stall owns the story from here, so that episode ends without a `delivery-restored`.
     */
    val msStarved: Long? = null,
    /**
     * F-P5-10 `hold`: another app held a camera when this stall was judged, so no recovery is asked
     * for. The stall waits for [HoldReleased] or for video to resume.
     */
    val held: Boolean = false,
  ) : VideoVerdict

  /**
   * F-P5-10 `hold`: the camera was released with the held stall still stalled, [msStalled] after the
   * last frame. Answered at once by the recovery the hold deferred.
   */
  data class HoldReleased(val msStalled: Long) : VideoVerdict

  /**
   * F-P5-9: a full window below a floor while frames still advance. Rates are per second over the
   * window, to one decimal; [audioFps] is null when no audio count was read.
   */
  data class Starved(val videoFps: Double, val audioFps: Double?, val transport: String?) : VideoVerdict

  /**
   * Every judgement for a full window has been above both floors, [msStarved] after starvation was
   * detected. Detection lags the onset by up to a window. This lags the end by up to two (the last
   * low window, then 3000 ms of good ones), so [msStarved] can overstate the starvation by a window.
   */
  data class DeliveryRestored(val msStarved: Long) : VideoVerdict

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
 * F-P5-9 adds a rate floor beside the zero test. A WhatsApp call held video at 1–20 fps and audio
 * at 1–9 frames/s for 20 s, and a zero test never fires while any frame arrives. Starvation is
 * surfaced and never recovered, because the cause is another app holding a camera.
 *
 * F-P5-10 adds `hold`, a per-session experiment: a stall judged while another app holds a camera
 * asks for no recovery until the camera is released ([contentionEnded]) or video resumes.
 *
 * Pure, with an injected clock, so every rule is a JVM test. Synchronized because the watchdog tick,
 * the publish loop, the intent actor and the sampler all call in.
 */
class VideoStallWatchdog(private val clock: () -> Long) {
  @Volatile var state: VideoState = VideoState.IDLE
    private set

  /**
   * The video frame rate of the last starvation judgement's window, to one decimal, for the snapshot
   * and the HUD (F-P5-9). Published only from a judgement that agrees with the state: while starved,
   * only from windows below a floor, so the HUD never quotes a rate above the floor under LOW VIDEO
   * (and holds the last low one through the 3000 ms it takes to clear). Null while not publishing,
   * before a full window exists in this publish, and after a stall heals, until a fresh window.
   */
  @Volatile var videoFps: Double? = null
    private set

  /**
   * The audio frame rate over the same window, one decimal; null exactly when [videoFps] is, or
   * when no audio count was read. The HUD uses it only to word starvation as LOW AUDIO rather than
   * a LOW VIDEO that quotes a healthy picture (AGENTS.md §6).
   */
  @Volatile var audioFps: Double? = null
    private set

  /** When the open starvation episode was detected; null when none is open. */
  private var starvedSinceMs: Long? = null

  /** The last judgement below a floor in the open episode. It clears only [WINDOW_MS] after this. */
  private var lastBelowFloorMs: Long? = null

  /** Recoveries started since video last flowed. */
  private var attempts = 0

  /**
   * F-P5-10's `hold`, set per session from the `p5-f10-mode` file. After WhatsApp took camera 1, the
   * recovery that rebuilt the stream while the camera was held was followed by noise at 30 fps, so
   * under `hold` a stall judged while contended is surfaced and waited out, not rebuilt.
   */
  private var holdWhileContended = false

  /** The open stall is held for contention: no recovery is asked for, and none may start. */
  private var held = false

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

    /**
     * Every tick's counts from this publish's first video frame on. Starting at the first frame is
     * the grace: startup, and every reconnect (a new period), get a full window before any judgement.
     */
    val readings = ArrayDeque<Reading>()
  }

  private class Reading(val atMs: Long, val videoFrames: Long, val audioFrames: Long?)

  /** Frames per second over one full window. [audio] is null when either end had no audio count. */
  private class Rate(val video: Double, val audio: Double?) {
    val starved: Boolean get() = video < VIDEO_FLOOR_FPS || (audio != null && audio < AUDIO_FLOOR_FPS)
  }

  /** [contended]: another app holds a camera now (F-P5-10). It matters only under `hold`. */
  @Synchronized
  fun tick(
    publishing: Boolean,
    videoFrames: Long?,
    audioFrames: Long?,
    transport: String?,
    contended: Boolean = false,
  ): List<VideoVerdict> {
    if (!publishing || videoFrames == null) {
      endPeriod()
      return emptyList()
    }
    val now = clock()
    val current = period ?: Period(now, videoFrames, audioFrames).also { period = it }
    val advancing = videoFrames > current.videoFrames
    // A stall healing within this publish: the window across the gap is not the picture now, and
    // would read as starved on the first frame back. The next judgement needs a fresh full window.
    if (advancing && episodeSinceMs != null) healWindow(current)
    if (advancing || current.lastAdvanceMs != null) current.readings.addLast(Reading(now, videoFrames, audioFrames))
    val rate = windowRate(current, now)
    return if (advancing) {
      advanced(current, now, videoFrames, audioFrames) + judgeDelivery(now, rate, transport)
    } else {
      judge(current, now, videoFrames, audioFrames, transport, contended)
    }
  }

  /** The publish loop ended the attempt for a stall. The attempt number, or null when no stall was pending. */
  @Synchronized
  fun recoveryStarted(): Int? {
    if (state != VideoState.STALLED || held) return null
    attempts += 1
    state = VideoState.RECOVERING
    return attempts
  }

  /**
   * F-P5-10: no camera is held by another app any more. A held stall that is still stalled is
   * answered now, with the recovery the hold deferred. Holding was never an attempt; if the
   * recoveries before the hold had already used up the cap, it is [VideoVerdict.RecoveryFailed], as
   * the judgement the hold replaced would have been.
   */
  @Synchronized
  fun contentionEnded(): List<VideoVerdict> {
    if (!held) return emptyList()
    held = false
    if (attempts >= MAX_RECOVERIES) {
      state = VideoState.FAILED
      return listOf(VideoVerdict.RecoveryFailed(attempts))
    }
    val since = episodeSinceMs ?: return emptyList()
    return listOf(VideoVerdict.HoldReleased(msStalled = clock() - since))
  }

  /**
   * A new operator intent: whatever happened before belongs to the last session. [holdWhileContended]
   * is this session's F-P5-10 `hold`, read from the mode file at the start intent.
   */
  @Synchronized
  fun reset(holdWhileContended: Boolean = false) {
    this.holdWhileContended = holdWhileContended
    held = false
    period = null
    episodeSinceMs = null
    starvedSinceMs = null
    lastBelowFloorMs = null
    attempts = 0
    videoFps = null
    audioFps = null
    state = VideoState.IDLE
  }

  private fun healWindow(period: Period) {
    period.readings.clear()
    videoFps = null
    audioFps = null
  }

  /**
   * Rates over the newest reading and the latest one at least [WINDOW_MS] older, which is dropped
   * down to. Ticks drift, so the real span divides, never 3 s. Null until a full window exists.
   */
  private fun windowRate(period: Period, now: Long): Rate? {
    val readings = period.readings
    val windowStart = now - WINDOW_MS
    while (readings.size >= 2 && readings[1].atMs <= windowStart) readings.removeFirst()
    val base = readings.firstOrNull()?.takeIf { it.atMs <= windowStart } ?: return null
    val last = readings.last()
    val seconds = (last.atMs - base.atMs) / 1_000.0
    val audio = if (last.audioFrames != null && base.audioFrames != null) last.audioFrames - base.audioFrames else null
    return Rate((last.videoFrames - base.videoFrames) / seconds, audio?.let { it / seconds })
  }

  /**
   * F-P5-9, judged only on a tick where video advanced. A picture that stops dead therefore never
   * reads as starved on its way to the zero-frame stall, which keeps precedence and recovers as
   * before. At 1 fps a frame still lands within a second, so real starvation is never missed.
   *
   * Clearing has hysteresis: every judgement over the last [WINDOW_MS] must be above both floors.
   * Call C's video alone ran 8.3, 8.0, 11.7, 7.7 fps windows; clearing on the single 11.7 would have
   * split one starvation into three rows and flickered the HUD.
   */
  private fun judgeDelivery(now: Long, rate: Rate?, transport: String?): List<VideoVerdict> {
    if (rate == null) return emptyList()
    val since = starvedSinceMs
    if (rate.starved) lastBelowFloorMs = now
    val verdicts = when {
      rate.starved && since == null -> {
        starvedSinceMs = now
        listOf(VideoVerdict.Starved(oneDecimal(rate.video), rate.audio?.let(::oneDecimal), transport))
      }
      !rate.starved && since != null && now - (lastBelowFloorMs ?: since) >= WINDOW_MS -> {
        starvedSinceMs = null
        lastBelowFloorMs = null
        listOf(VideoVerdict.DeliveryRestored(msStarved = now - since))
      }
      else -> emptyList()
    }
    publish(rate)
    state = if (starvedSinceMs != null) VideoState.STARVED else VideoState.OK
    return verdicts
  }

  /** Only rates that agree with the state reach the snapshot: a low one while starved, any while not. */
  private fun publish(rate: Rate) {
    if (starvedSinceMs != null && !rate.starved) return
    videoFps = oneDecimal(rate.video)
    audioFps = rate.audio?.let(::oneDecimal)
  }

  private fun advanced(period: Period, now: Long, videoFrames: Long, audioFrames: Long?): List<VideoVerdict> {
    period.videoFrames = videoFrames
    period.lastAdvanceMs = now
    period.audioAtAdvance = audioFrames
    period.reported = false
    // An open starvation episode survives a reconnect: until a full window judges, the last
    // judgement stands, rather than a LIVE that nothing has measured yet.
    state = if (starvedSinceMs != null) VideoState.STARVED else VideoState.OK
    val since = episodeSinceMs ?: return emptyList()
    episodeSinceMs = null
    attempts = 0
    held = false
    return listOf(VideoVerdict.Recovered(msStalled = now - since))
  }

  private fun judge(
    period: Period,
    now: Long,
    videoFrames: Long,
    audioFrames: Long?,
    transport: String?,
    contended: Boolean,
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
    // F-P5-10: a hold is not an attempt, so it neither counts toward the cap nor ends in FAILED.
    val holding = holdWhileContended && contended
    if (!holding && episodeSinceMs != null && attempts >= MAX_RECOVERIES) {
      state = VideoState.FAILED
      return listOf(VideoVerdict.RecoveryFailed(attempts))
    }
    val since = episodeSinceMs ?: silentSince.also { episodeSinceMs = it }
    state = VideoState.STALLED
    held = holding
    val audioAdvancing = audioFrames != null && (period.audioAtAdvance?.let { audioFrames > it } ?: false)
    // A stall is starvation at its worst: it takes the episode over and recovers as before.
    val msStarved = starvedSinceMs?.let { now - it }
    starvedSinceMs = null
    lastBelowFloorMs = null
    return listOf(VideoVerdict.Stalled(now - since, videoFrames, audioAdvancing, transport, msStarved, holding))
  }

  /**
   * Off air claims nothing. An open starvation episode stays open: a drop does not give the camera
   * back, and the next publish's first full window decides.
   */
  private fun endPeriod() {
    period = null
    videoFps = null
    audioFps = null
    if (state == VideoState.OK || state == VideoState.STARVED) state = VideoState.IDLE
  }

  /**
   * Truncated, not rounded: a rate shown is below a floor exactly when the rate judged was. Rounded,
   * 9.96 fps was judged starved and shown as 10.0, and the HUD picks LOW VIDEO or LOW AUDIO by
   * comparing the shown rate with the floor.
   */
  private fun oneDecimal(value: Double): Double = Math.floor(value * 10) / 10.0

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

    /**
     * F-P5-9's rolling window. Three seconds, like [STALL_MS]: long enough that the browser's
     * single 12 fps second and the phone call's two 13 fps seconds (2026-09-28) average above the
     * floors, short enough that call C is caught within a window of its onset.
     */
    const val WINDOW_MS = 3_000L

    /** Below this, the picture is a slideshow: fewer than 30 frames in a window. Healthy is 30. */
    const val VIDEO_FLOOR_FPS = 10.0

    /**
     * Below this, audio is broken: fewer than 60 AAC frames in a window. Healthy is ~47; call C
     * gave 1–9, and answering a phone call dipped to 15–18 for two seconds, which averages above.
     */
    const val AUDIO_FLOOR_FPS = 20.0
  }
}
