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
  /**
   * Due raises F-P5-7's gate held since the last `bitrate-held` line or raise, whichever came last; a raise says them
   * ([Tested.heldBefore]). A drop and a new attempt keep it.
   */
  val untestedRaises: Int = 0,
  /** When the last `bitrate-held` line was due; null before the first. A drop and a new attempt keep it. */
  val heldSaidAtMs: Long? = null,
)

/** Why a reading moved the target: the `bitrate` line's `reason` (R-990P). */
enum class BitrateMove(override val wire: String) : Wire {
  /** Sender drops cut it by half, or less when the link's estimate or its carried egress says so. */
  DROPS("drops"),

  /** A send buffer of half the latency cut it by a quarter, or less as for drops. */
  BACKLOG("backlog"),

  /** A tested clean interval raised it. */
  RAISE("raise"),

  /** It was outside the floor and the ceiling, and nothing else moved it. */
  CLAMP("clamp"),
}

/**
 * F-P5-7's gate held due raises: the `bitrate-held` line (R-990P). [egressBps] is the mean egress of the interval that
 * failed, null when none of its readings measured any; [gateBps] is the least egress that passes at [targetBps], so a
 * mean of [gateBps] − 1 is held and one of [gateBps] raises.
 */
data class HeldRaise(val targetBps: Int, val egressBps: Long?, val gateBps: Long, val count: Int)

/**
 * What a raise was decided on (review of #23): [egressBps], the interval's mean egress that passed F-P5-7's gate, which
 * the `bitrate` line carries in place of the one reading the raise fell due on; and [heldBefore], the due raises the gate
 * held since the last `bitrate-held` line, which no held line will now say.
 */
data class Tested(val egressBps: Long, val heldBefore: Int)

/**
 * One reading's outcome: the next state, the rule that moved the target (null when it is where it was), a held line due,
 * and what a raise was decided on.
 */
data class Regulated(val state: Regulation, val move: BitrateMove? = null, val held: HeldRaise? = null, val tested: Tested? = null)

/**
 * F-P5-5: nothing regulated the encoder, so a VBR burst the uplink could not carry was delivered as
 * nothing. One reading in, the next video target out. Audio, resolution and frame rate are never
 * touched. The triggers are sender drops and the send buffer; SRT's bandwidth estimate only sizes a
 * cut, because on 2026-09-28 it was wrong in both directions. F-P5-7's table has it at 1.6 Mbps while
 * the link carried 2149 kbps with no new drops, and the raise-gate run on a fat link read 10–320 Mbps.
 */
object BitrateRegulator {
  /** The smallest raise. Above the 500k floor 20% is never less, so it binds at the floor only, where they are equal. */
  const val RAISE_STEP_BPS = 100_000

  /**
   * A raise is this share of the target (R-990P, 2026-10-26: the controller's call, the owner having asked for a faster
   * tested climb). At 100k a step the floor needs 13 raises, 130 s or more, to reach 1.8M; at 20% it passes it in 8.
   */
  const val RAISE_STEP_PERCENT = 20L
  const val RAISE_INTERVAL_MS = 10_000L

  /** A cut means the link just failed the old rate. Probing straight back would recreate the overload. */
  const val RAISE_AFTER_CUT_MS = 30_000L

  /** F-P5-7's raise gate: the interval's mean egress at 70% or more of the target's expected egress. */
  const val TESTED_PERCENT = 70L
  const val FAILED_RATE_MEMORY_MS = 300_000L
  const val FAILED_RATE_PERCENT = 80
  const val CLEAN_EGRESS_TICKS = 10

  /** At most one `bitrate-held` line in this long: R-990P's 18 min hold reads as 18 lines, not 108. */
  const val HELD_LINE_MS = 60_000L

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
   *
   * A clean restart forgets a rate that failed in its own episode, since the last healthy reading. A
   * failure in the same millisecond as that reading is the episode's (B7 BR-04): the failing drop wins
   * the tie. A drop ends the on-air phase, and the next reading comes a retry later, so a tie can only
   * be a reading and then a drop.
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
    val failedInEpisode = state.failed?.let { it.atMs >= healthySince } ?: false
    return state
      .copy(targetBps = state.healthyTargetBps, failed = if (failedInEpisode) null else state.failed)
      .cleanWaitRestarted(null)
  }

  /** [regulate]'s next state alone. */
  fun next(state: Regulation, link: LinkSample?, nowMs: Long, transport: Transport, srtLatencyMs: Int): Regulation =
    regulate(state, link, nowMs, transport, srtLatencyMs).state

  /**
   * One reading in: the next state, the rule that moved the target, and a `bitrate-held` line when one is due.
   *
   * @param link null when nothing could be read, which holds the target and the clean wait. A reading
   *   with no usable send buffer ([usableBufferMs]) is still judged on its drops and loss.
   */
  fun regulate(state: Regulation, link: LinkSample?, nowMs: Long, transport: Transport, srtLatencyMs: Int): Regulated {
    val current = state.copy(targetBps = state.targetBps.coerceIn(Encode.FLOOR_BPS, Encode.CEILING_BPS))
    val judged = if (link == null) Regulated(current) else judged(current, link, nowMs, transport, srtLatencyMs)
    // A cut or a raise names the move, after a clamp too. A target no rule moved can only have moved by the clamp, and
    // a target still where it was did not move at all, whatever ran: a cut at the floor lands on it.
    val move = judged.move ?: BitrateMove.CLAMP
    return judged.copy(move = move.takeIf { judged.state.targetBps != state.targetBps })
  }

  private fun judged(current: Regulation, link: LinkSample, nowMs: Long, transport: Transport, srtLatencyMs: Int): Regulated {
    val windowMs = if (transport == Transport.SRT) srtLatencyMs else RTMPS_DRAIN_MS
    val marked = if (failing(link, transport)) current.copy(failingAtMs = nowMs) else current
    val dropping = link.droppedPackets > 0
    val draining = marked.lastCutAtMs?.let { nowMs - it < windowMs } ?: false
    val sendBufferMs =
      usableBufferMs(link, transport) ?: return withoutBuffer(marked, link, nowMs, dropping && !draining)
    val backlogged = sendBufferMs >= windowMs / 2
    val clean = !dropping && link.lostPackets <= 0 && sendBufferMs < windowMs / CLEAN_BUFFER_DIVISOR
    return when {
      dropping && !draining -> Regulated(cut(marked, link, nowMs, CUT_ON_DROPS_PERCENT), BitrateMove.DROPS)
      backlogged && !draining -> Regulated(cut(marked, link, nowMs, CUT_ON_BACKLOG_PERCENT), BitrateMove.BACKLOG)
      !clean -> Regulated(marked.cleanWaitRestarted(nowMs))
      else -> raiseIfDue(carriedCleanly(marked, link, nowMs), nowMs)
    }
  }

  /** [RAISE_STEP_PERCENT] of [targetBps], rounded down, and never under [RAISE_STEP_BPS]. */
  fun raiseStepBps(targetBps: Int): Int = maxOf((targetBps * RAISE_STEP_PERCENT / 100).toInt(), RAISE_STEP_BPS)

  /** 80% of a rate that failed less than [FAILED_RATE_MEMORY_MS] ago; otherwise the ceiling. */
  fun raiseCap(state: Regulation, nowMs: Long): Int =
    state.failed
      ?.takeIf { nowMs - it.atMs < FAILED_RATE_MEMORY_MS }
      ?.let { it.bps / 100 * FAILED_RATE_PERCENT } ?: Encode.CEILING_BPS

  /**
   * The send buffer, or null when it has no value to judge: negative (P5: −336, "a reading artefact to
   * keep out of any threshold"), or missing on SRT, which always reports one. RTMPS has none: empty.
   */
  private fun usableBufferMs(link: LinkSample, transport: Transport): Int? {
    val reported = link.sendBufferMs ?: return if (transport == Transport.SRT) null else 0
    return reported.takeIf { it >= 0 }
  }

  /**
   * Only the buffer's value is unknown (F-P5-5). Drops still cut, since P5 saw every SRT failure as
   * sender drops, and loss has already marked the link failing; neither is clean. A quiet reading holds.
   */
  private fun withoutBuffer(state: Regulation, link: LinkSample, nowMs: Long, cutDue: Boolean): Regulated =
    when {
      cutDue -> Regulated(cut(state, link, nowMs, CUT_ON_DROPS_PERCENT), BitrateMove.DROPS)
      link.droppedPackets > 0 || link.lostPackets > 0 -> Regulated(state.cleanWaitRestarted(nowMs))
      else -> Regulated(state)
    }

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
  private fun raiseIfDue(state: Regulation, nowMs: Long): Regulated {
    val due =
      since(state.cleanSinceMs, nowMs) >= RAISE_INTERVAL_MS &&
        since(state.lastRaiseAtMs, nowMs) >= RAISE_INTERVAL_MS &&
        since(state.lastCutAtMs, nowMs) >= RAISE_AFTER_CUT_MS
    val raised = minOf(state.targetBps + raiseStepBps(state.targetBps), Encode.CEILING_BPS, raiseCap(state, nowMs))
    val mean = intervalEgressBps(state)
    return when {
      !due || raised <= state.targetBps -> Regulated(state)
      mean != null && mean >= gateBps(state.targetBps) -> {
        val next = state.copy(targetBps = raised, lastRaiseAtMs = nowMs, untestedRaises = 0).cleanWaitRestarted(nowMs)
        Regulated(next, BitrateMove.RAISE, tested = Tested(mean, state.untestedRaises))
      }
      else -> held(state, nowMs)
    }
  }

  /**
   * F-P5-7's gate at [targetBps]: [TESTED_PERCENT] of the expected egress, rounded up, so the least whole egress that
   * passes (review of #23: rounded down, the held line named a gate 1 b/s under the one that held it).
   */
  fun gateBps(targetBps: Int): Long = (Encode.expectedEgressBps(targetBps) * TESTED_PERCENT + 99) / 100

  /**
   * The gate held a due raise. The first since [HELD_LINE_MS] is said, with the count since the last line said or the
   * last raise, which says its own ([Tested.heldBefore]).
   */
  private fun held(state: Regulation, nowMs: Long): Regulated {
    val count = state.untestedRaises + 1
    val waiting = state.cleanWaitRestarted(nowMs)
    if (since(state.heldSaidAtMs, nowMs) < HELD_LINE_MS) return Regulated(waiting.copy(untestedRaises = count))
    val line = HeldRaise(state.targetBps, intervalEgressBps(state), gateBps(state.targetBps), count)
    return Regulated(waiting.copy(untestedRaises = 0, heldSaidAtMs = nowMs), held = line)
  }

  /** The mean egress of the current clean interval's readings; null when none measured any. */
  private fun intervalEgressBps(state: Regulation): Long? {
    val readings = state.cleanEgressBps.takeLast(state.intervalEgressTicks).ifEmpty { return null }
    return readings.sum() / readings.size
  }

  private fun Regulation.cleanWaitRestarted(atMs: Long?): Regulation =
    copy(cleanSinceMs = atMs, intervalEgressTicks = 0)

  private fun since(atMs: Long?, nowMs: Long): Long = atMs?.let { nowMs - it } ?: Long.MAX_VALUE
}
