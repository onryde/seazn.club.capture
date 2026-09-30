package com.seazn.capture.engine.core

/** A target the link failed to carry, and when. */
data class FailedRate(val bps: Int, val atMs: Long)

/** What the regulator remembers between readings, and across the attempts of one session. */
data class Regulation(
  val targetBps: Int,
  val lastCutAtMs: Long? = null,
  val lastRaiseAtMs: Long? = null,
  /** Where the current clean interval began; null until the next clean reading. */
  val cleanSinceMs: Long? = null,
  val failed: FailedRate? = null,
  /** Egress of the most recent clean readings, oldest first, at most [BitrateRegulator.CLEAN_EGRESS_TICKS]. */
  val cleanEgressBps: List<Long> = emptyList(),
  /** How many of [cleanEgressBps]'s newest entries fall inside the current clean interval. */
  val intervalEgressTicks: Int = 0,
  /** The target at the last clean reading: what a far-end drop restarts at. */
  val healthyTargetBps: Int = targetBps,
  val healthyAtMs: Long? = null,
  /** The last reading where the link itself was failing: loss on SRT, sender drops on RTMPS. */
  val failingAtMs: Long? = null,
)

/**
 * F-P5-5: nothing regulated the encoder, so a VBR burst the uplink could not carry was delivered as
 * nothing. One reading in, the next video target out. Audio, resolution and frame rate are never
 * touched. The triggers are sender drops and the send buffer; SRT's bandwidth estimate only sizes a
 * cut, because on 2026-09-28 it was wrong in both directions. F-P5-7's table has it at 1.6 Mbps while
 * the link carried 2149 kbps with no new drops, and the raise-gate run on a fat link read 10–320 Mbps.
 */
object BitrateRegulator {
  const val RAISE_STEP_BPS = 100_000
  const val RAISE_INTERVAL_MS = 10_000L

  /** A cut means the link just failed the old rate. Probing straight back would recreate the overload. */
  const val RAISE_AFTER_CUT_MS = 30_000L

  /** F-P5-7's raise gate: the interval's mean egress at 70% or more of the target's expected egress. */
  const val TESTED_PERCENT = 70L
  const val FAILED_RATE_MEMORY_MS = 300_000L
  const val FAILED_RATE_PERCENT = 80
  const val CLEAN_EGRESS_TICKS = 10

  /** A drop within this long of the link failing restarts at half; later, at the healthy target. */
  const val FAILING_LOOKBACK_MS = 10_000L

  /** RTMPS has no latency window. How long a cut waits before drops speak for the new rate. */
  const val RTMPS_DRAIN_MS = 2_000
  private const val CUT_ON_DROPS_PERCENT = 50L
  private const val CUT_ON_BACKLOG_PERCENT = 75L
  private const val ESTIMATE_HEADROOM_PERCENT = 80L
  private const val EGRESS_HEADROOM_PERCENT = 80L

  /** Clean means a send buffer under a tenth of the latency: drained, not merely draining. */
  private const val CLEAN_BUFFER_DIVISOR = 10

  fun sessionStarted(): Regulation = Regulation(Encode.START_BPS)

  /** A new attempt keeps the target, the cut and the failed rate. Only the clean interval restarts. */
  fun attemptStarted(state: Regulation): Regulation = state.cleanWaitRestarted(null)

  /**
   * The regulator restart (P5 final soak): a drop after a clean link was the far end's, and restarts
   * at the last healthy target. Only a link that was failing within [FAILING_LOOKBACK_MS] halves.
   */
  fun afterDrop(state: Regulation, nowMs: Long): Regulation {
    val failing = state.failingAtMs?.let { nowMs - it <= FAILING_LOOKBACK_MS } ?: false
    if (failing) {
      val halved = (state.targetBps / 2).coerceAtLeast(Encode.FLOOR_BPS)
      return state
        .copy(targetBps = halved, lastCutAtMs = nowMs, failed = FailedRate(state.targetBps, nowMs))
        .cleanWaitRestarted(null)
    }
    val healthySince = state.healthyAtMs ?: Long.MIN_VALUE
    val failedInEpisode = state.failed?.let { it.atMs > healthySince } ?: false
    return state
      .copy(targetBps = state.healthyTargetBps, failed = if (failedInEpisode) null else state.failed)
      .cleanWaitRestarted(null)
  }

  /**
   * @param link null when nothing could be read. A negative send buffer is no reading either, and so
   *   is a missing one on SRT, which always reports it. RTMPS has none, and reads as empty.
   */
  fun next(state: Regulation, link: LinkSample?, nowMs: Long, transport: Transport, srtLatencyMs: Int): Regulation {
    val current = state.copy(targetBps = state.targetBps.coerceIn(Encode.FLOOR_BPS, Encode.CEILING_BPS))
    val reading = link?.sendBufferMs
    val unreadable = reading?.let { it < 0 } ?: (transport == Transport.SRT)
    if (link == null || unreadable) {
      val lossy = link != null && (link.droppedPackets > 0 || link.lostPackets > 0)
      return if (lossy) current.cleanWaitRestarted(nowMs) else current
    }
    val windowMs = if (transport == Transport.SRT) srtLatencyMs else RTMPS_DRAIN_MS
    val marked = if (failing(link, transport)) current.copy(failingAtMs = nowMs) else current
    val sendBufferMs = reading ?: 0
    val dropping = link.droppedPackets > 0
    val backlogged = sendBufferMs >= windowMs / 2
    val draining = marked.lastCutAtMs?.let { nowMs - it < windowMs } ?: false
    val clean = !dropping && link.lostPackets <= 0 && sendBufferMs < windowMs / CLEAN_BUFFER_DIVISOR
    return when {
      (dropping || backlogged) && !draining ->
        cut(marked, link, nowMs, if (dropping) CUT_ON_DROPS_PERCENT else CUT_ON_BACKLOG_PERCENT)
      !clean -> marked.cleanWaitRestarted(nowMs)
      else -> raiseIfDue(carriedCleanly(marked, link, nowMs), nowMs)
    }
  }

  /** 80% of a rate that failed less than [FAILED_RATE_MEMORY_MS] ago; otherwise the ceiling. */
  fun raiseCap(state: Regulation, nowMs: Long): Int =
    state.failed
      ?.takeIf { nowMs - it.atMs < FAILED_RATE_MEMORY_MS }
      ?.let { it.bps / 100 * FAILED_RATE_PERCENT } ?: Encode.CEILING_BPS

  /** Loss is the SRT link failing; a far end that stops acknowledging drops packets but reports none. */
  private fun failing(link: LinkSample, transport: Transport): Boolean =
    if (transport == Transport.SRT) link.lostPackets > 0 else link.droppedPackets > 0

  private fun cut(state: Regulation, link: LinkSample, nowMs: Long, percent: Long): Regulation {
    val byFactor = state.targetBps.toLong() * percent / 100
    val byEstimate =
      link.bandwidthBps?.takeIf { it > 0 }?.let { it * ESTIMATE_HEADROOM_PERCENT / 100 - Encode.AUDIO_BPS }
        ?: Long.MAX_VALUE
    val byEgress =
      state.cleanEgressBps
        .takeIf { it.isNotEmpty() }
        ?.let { it.sum() / it.size * EGRESS_HEADROOM_PERCENT / Encode.EGRESS_OVERHEAD_PERCENT - Encode.AUDIO_BPS }
        ?: Long.MAX_VALUE
    val target = minOf(byFactor, byEstimate, byEgress).coerceIn(Encode.FLOOR_BPS.toLong(), state.targetBps.toLong())
    return state
      .copy(targetBps = target.toInt(), lastCutAtMs = nowMs, failed = FailedRate(state.targetBps, nowMs))
      .cleanWaitRestarted(nowMs)
  }

  private fun carriedCleanly(state: Regulation, link: LinkSample, nowMs: Long): Regulation {
    val interval =
      state.copy(
        cleanSinceMs = state.cleanSinceMs ?: nowMs,
        healthyTargetBps = state.targetBps,
        healthyAtMs = nowMs,
      )
    val egress = link.egressBps ?: return interval
    return interval.copy(
      cleanEgressBps = (state.cleanEgressBps + egress).takeLast(CLEAN_EGRESS_TICKS),
      intervalEgressTicks = (state.intervalEgressTicks + 1).coerceAtMost(CLEAN_EGRESS_TICKS),
    )
  }

  /** A due raise the interval did not test restarts the wait (F-P5-7): a quiet picture holds. */
  private fun raiseIfDue(state: Regulation, nowMs: Long): Regulation {
    val due =
      since(state.cleanSinceMs, nowMs) >= RAISE_INTERVAL_MS &&
        since(state.lastRaiseAtMs, nowMs) >= RAISE_INTERVAL_MS &&
        since(state.lastCutAtMs, nowMs) >= RAISE_AFTER_CUT_MS
    val raised = minOf(state.targetBps + RAISE_STEP_BPS, Encode.CEILING_BPS, raiseCap(state, nowMs))
    return when {
      !due || raised <= state.targetBps -> state
      tested(state) -> state.copy(targetBps = raised, lastRaiseAtMs = nowMs).cleanWaitRestarted(nowMs)
      else -> state.cleanWaitRestarted(nowMs)
    }
  }

  private fun tested(state: Regulation): Boolean {
    val readings = state.cleanEgressBps.takeLast(state.intervalEgressTicks).ifEmpty { return false }
    return readings.sum() / readings.size * 100 >= Encode.expectedEgressBps(state.targetBps) * TESTED_PERCENT
  }

  private fun Regulation.cleanWaitRestarted(atMs: Long?): Regulation =
    copy(cleanSinceMs = atMs, intervalEgressTicks = 0)

  private fun since(atMs: Long?, nowMs: Long): Long = atMs?.let { nowMs - it } ?: Long.MAX_VALUE
}
