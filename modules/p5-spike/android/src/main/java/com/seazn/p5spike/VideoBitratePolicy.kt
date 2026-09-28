package com.seazn.p5spike

/**
 * One tick's view of the uplink, reduced from the transport's own counters by the regulators in
 * `LinkRegulators.kt`. Nothing here reads a socket, so every rule below is proven on the JVM.
 */
data class LinkSample(
  /** Packets the sender gave up on since the last tick: SRT's too-late drops, or StreamPack's RTMP send queue overflowing. */
  val droppedPackets: Long,
  /** Packets reported lost since the last tick (SRT's `pktSndLoss`, each one retransmitted or dropped). RTMP reports none. */
  val lostPackets: Long = 0,
  /**
   * SRT's unacknowledged span (`msSndBuf`); null on a transport that has none. A negative value is
   * no reading: SRT reported -336 and -90 on 2026-09-14, and negatives through Soak A's rotation.
   */
  val sendBufferMs: Int?,
  /** SRT's bandwidth estimate; null when there is none. It sizes a cut and never triggers one. */
  val bandwidthBps: Long?,
  /**
   * What the endpoint wrote since the last tick, in bits per second: column 13's source, so audio,
   * TS packaging and retransmits are all in it. Null when there is no earlier reading to diff.
   */
  val egressBps: Long? = null,
)

/** A target the link failed to carry: the one in force when congestion forced a cut, and when. */
data class FailedRate(val bps: Int, val atMs: Long)

/** What the regulator remembers between ticks, and between the attempts of one operator session. */
data class Regulation(
  val targetBps: Int,
  val lastCutAtMs: Long? = null,
  val lastRaiseAtMs: Long? = null,
  /**
   * Where the current clean interval began: the last step, the last tick that was not clean, or the
   * last due raise the interval did not test (F-P5-7). A tick with no send-buffer reading leaves it
   * alone unless that tick still counted drops or losses.
   * Null before an attempt's first tick, so a new connection proves itself afresh.
   */
  val cleanSinceMs: Long? = null,
  /** The newest failed rate. For [VideoBitratePolicy.FAILED_RATE_MEMORY_MS], raises stay under 80% of it. */
  val failed: FailedRate? = null,
  /** Egress of the most recent clean ticks, oldest first, at most [VideoBitratePolicy.CLEAN_EGRESS_TICKS]. */
  val cleanEgressBps: List<Long> = emptyList(),
  /**
   * How many of [cleanEgressBps]'s newest entries were read inside the current clean interval. A
   * raise is judged on these alone (F-P5-7), so an interval never borrows a busier or quieter picture
   * from before it began.
   */
  val intervalEgressTicks: Int = 0,
)

/**
 * F-P5-5: nothing regulated the encoder, so a VBR burst the uplink could not carry was delivered as
 * nothing. Under SRT's latency an overloaded link does not degrade to lower quality; it drops
 * everything older than the window. This is the decision a regulator makes each tick: stats in, next
 * video target out. Audio, resolution and frame rate are never touched.
 *
 * The triggers are the send buffer and sender drops, calibrated on Soak A's own 1 Hz readings. SRT's
 * bandwidth estimate is not a trigger, because in that run it was wrong in both directions:
 * - 18:20–19:12 it read 0.17–0.3 Mbps on a healthy link carrying 0.5 Mbps at 30 fps with a 34 ms
 *   buffer. An application-limited sender cannot be measured.
 * - At 19:15, as the link failed, it read 247 Mbps.
 *
 * Cutting was right on the device; raising was not. On 2026-09-14's roaming cellular link (0.8–1.0
 * Mbps in all), a +250k raise every 2 s once the buffer drained probed about ten times in four
 * minutes, each probe losing 360–470 packets of picture. So a raise is small, rare, only on a link
 * that has been clean the whole time while carrying close to the target (F-P5-7), never soon after a
 * cut, and never back up to a rate that just failed. And a cut is sized from what the link carried,
 * not from a target that egress overshot by 0.25–0.6 Mbps.
 */
object VideoBitratePolicy {
  /** AGENTS.md §8: 720p30 at 3000k is the encode ceiling. Nothing above it is ever asked for. */
  const val CEILING_BPS = 3_000_000

  /**
   * Below this, 720p30 AVC is a picture of blocks. A smaller target buys nothing a viewer can use:
   * Soak A's still scene already took 0.5–0.7 Mbps with the encoder unconstrained. It is also
   * StreamPack's own default floor (`BitrateRegulatorConfig`). A link that cannot carry this much is
   * the publish loop's problem to report, not the regulator's to hide.
   */
  const val FLOOR_BPS = 500_000

  /** AAC at 128k, set at arm and never regulated. Part of the egress a cut must leave room for. */
  const val AUDIO_BPS = 128_000

  /**
   * A fresh session's first target, half the ceiling. Connecting at the ceiling on 2026-09-14 put
   * 1.3–1.9 s in the send buffer and cost 1,512 sender drops before the floor was reached. A good link
   * climbs from here; a weak one starts closer to what it can carry.
   */
  const val START_BPS = 1_500_000

  /** Sender drops are data already lost to viewers: halve. */
  private const val CUT_ON_DROPS = 0.5

  /**
   * A backlog without drops is a warning, not yet a loss. Soak A had single-second spikes of a
   * buffer at 1 s or more roughly eight times in two healthy hours, each a loss burst being
   * retransmitted, so a quarter keeps what those cost low. 19:15's 1300 ms, a minute before the
   * collapse, still gets a reaction.
   */
  private const val CUT_ON_BACKLOG = 0.75

  /** Room under SRT's estimate when it sizes a cut: it moves, and retransmits need room too. */
  private const val ESTIMATE_HEADROOM = 0.8

  /**
   * A cut leaves expected egress (video target + audio, plus 15% for TS packaging and retransmits) at
   * no more than 80% of the egress last carried cleanly. Percentages, so the arithmetic is exact.
   */
  private const val EGRESS_HEADROOM_PERCENT = 80L
  private const val EGRESS_OVERHEAD_PERCENT = 115L

  /** The clean ticks whose mean egress sizes a cut: ten seconds, enough to average out VBR. */
  const val CLEAN_EGRESS_TICKS = 10

  /** At most +100k at most every 10 s: floor to ceiling in over four minutes, one small probe at a time. */
  const val RAISE_STEP_BPS = 100_000
  const val RAISE_INTERVAL_MS = 10_000L

  /** A cut means the link has just failed to carry the old rate. Probing straight back would recreate the overload. */
  const val RAISE_AFTER_CUT_MS = 30_000L

  /**
   * F-P5-7: a clean interval proves nothing about capacity if the encoder was not using the target. On
   * 2026-09-28 a still picture sent 0.4–0.9 Mbps against 1830k, every interval was clean, and the
   * target climbed to the ceiling on a link carrying about 1 Mbps; the next busy picture overran it
   * and was floored. So a raise also needs the interval's egress at 70% or more of what the current
   * target is expected to send. A quiet picture holds the target where it is.
   */
  private const val TESTED_PERCENT = 70L

  /** Clean means a send buffer under a tenth of the latency (200 ms at 2000): drained, not merely draining. */
  private const val CLEAN_BUFFER_DIVISOR = 10

  /** How long a failed rate caps raises, and the cap: 80% of it. */
  const val FAILED_RATE_MEMORY_MS = 300_000L
  private const val FAILED_RATE_HEADROOM_PERCENT = 80

  /**
   * An attempt's starting regulation. A fresh session starts at [START_BPS]. A reconnect in the same
   * session keeps its target, its last cut and its failed rate, because the link that just dropped
   * is the one it reconnects to. Only the clean interval restarts: the new connection has proven
   * nothing yet, and the gap between attempts was never observed.
   */
  fun attemptStarted(carried: Regulation?): Regulation =
    carried?.cleanWaitRestarted(atMs = null) ?: Regulation(START_BPS)

  /**
   * @param link null when there was nothing to read, which holds like a negative send buffer. Such a
   *   tick neither cuts nor raises. It restarts the clean wait only if it counted drops or losses:
   *   Soak A's healthy hours read a negative buffer on 1,063 of 7,803 ticks with nothing dropped, and
   *   restarting the wait on each cost 17 minutes at the ceiling without avoiding a single cut.
   * @param latencyMs the transport's delivery window. The send buffer is judged against it
   *   (backlogged at half, clean under a tenth). After a cut, it is how long the data queued before
   *   the cut takes to be sent or dropped, so drops inside it say nothing about the new rate.
   */
  fun next(state: Regulation, link: LinkSample?, nowMs: Long, latencyMs: Int): Regulation {
    val current = state.copy(targetBps = state.targetBps.coerceIn(FLOOR_BPS, CEILING_BPS))
    val reading = link?.sendBufferMs
    if (link == null || (reading != null && reading < 0)) {
      val lossy = link != null && (link.droppedPackets > 0 || link.lostPackets > 0)
      return if (lossy) current.cleanWaitRestarted(nowMs) else current
    }
    val sendBufferMs = reading ?: 0
    val dropping = link.droppedPackets > 0
    val backlogged = sendBufferMs >= latencyMs / 2
    val draining = current.lastCutAtMs?.let { nowMs - it < latencyMs } ?: false
    val clean = !dropping && link.lostPackets <= 0 && sendBufferMs < latencyMs / CLEAN_BUFFER_DIVISOR
    return when {
      (dropping || backlogged) && !draining ->
        cut(current, link, nowMs, if (dropping) CUT_ON_DROPS else CUT_ON_BACKLOG)
      !clean -> current.cleanWaitRestarted(nowMs)
      else -> raiseIfDue(carriedCleanly(current, link, nowMs), nowMs)
    }
  }

  private fun cut(state: Regulation, link: LinkSample, nowMs: Long, factor: Double): Regulation {
    val byFactor = (state.targetBps * factor).toLong()
    val byEstimate = link.bandwidthBps?.takeIf { it > 0 }
      ?.let { (it * ESTIMATE_HEADROOM).toLong() - AUDIO_BPS } ?: Long.MAX_VALUE
    val byEgress = state.cleanEgressBps.takeIf { it.isNotEmpty() }
      ?.let { it.sum() / it.size * EGRESS_HEADROOM_PERCENT / EGRESS_OVERHEAD_PERCENT - AUDIO_BPS } ?: Long.MAX_VALUE
    val target = minOf(byFactor, byEstimate, byEgress).coerceIn(FLOOR_BPS.toLong(), state.targetBps.toLong())
    return state.copy(targetBps = target.toInt(), lastCutAtMs = nowMs, failed = FailedRate(state.targetBps, nowMs))
      .cleanWaitRestarted(nowMs)
  }

  /**
   * A clean tick extends the clean interval, and its egress joins the ticks a cut is sized from and
   * the readings the interval's raise is judged on.
   */
  private fun carriedCleanly(state: Regulation, link: LinkSample, nowMs: Long): Regulation {
    val interval = state.copy(cleanSinceMs = state.cleanSinceMs ?: nowMs)
    val egress = link.egressBps ?: return interval
    return interval.copy(
      cleanEgressBps = (state.cleanEgressBps + egress).takeLast(CLEAN_EGRESS_TICKS),
      intervalEgressTicks = (state.intervalEgressTicks + 1).coerceAtMost(CLEAN_EGRESS_TICKS),
    )
  }

  /**
   * A due raise the interval did not test is a decision too (F-P5-7): the wait restarts, so the next
   * raise needs an interval of its own that was tested, not a quiet one topped up by a busy second.
   */
  private fun raiseIfDue(state: Regulation, nowMs: Long): Regulation {
    val due = since(state.cleanSinceMs, nowMs) >= RAISE_INTERVAL_MS &&
      since(state.lastRaiseAtMs, nowMs) >= RAISE_INTERVAL_MS &&
      since(state.lastCutAtMs, nowMs) >= RAISE_AFTER_CUT_MS
    val raised = minOf(state.targetBps + RAISE_STEP_BPS, CEILING_BPS, raiseCap(state, nowMs))
    return when {
      !due || raised <= state.targetBps -> state
      tested(state) -> state.copy(targetBps = raised, lastRaiseAtMs = nowMs).cleanWaitRestarted(nowMs)
      else -> state.cleanWaitRestarted(nowMs)
    }
  }

  /**
   * The interval's mean egress reached [TESTED_PERCENT] of the target's expected egress. The readings
   * are the ones a cut is sized from, only those taken inside this interval; ticks with no send-buffer
   * reading add none. No reading is no test.
   */
  private fun tested(state: Regulation): Boolean {
    val readings = state.cleanEgressBps.takeLast(state.intervalEgressTicks).ifEmpty { return false }
    return readings.sum() / readings.size * 100 >= expectedEgressBps(state.targetBps) * TESTED_PERCENT
  }

  /** What a target is expected to put on the wire: video and audio, plus 15% for TS packaging and retransmits. */
  private fun expectedEgressBps(targetBps: Int): Long = (targetBps + AUDIO_BPS).toLong() * EGRESS_OVERHEAD_PERCENT / 100

  /** A new clean interval from [atMs] (null: from the next clean tick). Nothing read before it counts toward a raise. */
  private fun Regulation.cleanWaitRestarted(atMs: Long?): Regulation = copy(cleanSinceMs = atMs, intervalEgressTicks = 0)

  /** 80% of a rate that failed less than [FAILED_RATE_MEMORY_MS] ago; otherwise only the ceiling. */
  private fun raiseCap(state: Regulation, nowMs: Long): Int =
    state.failed?.takeIf { nowMs - it.atMs < FAILED_RATE_MEMORY_MS }
      ?.let { it.bps / 100 * FAILED_RATE_HEADROOM_PERCENT } ?: CEILING_BPS

  /** Milliseconds since [atMs]; forever if it never happened. */
  private fun since(atMs: Long?, nowMs: Long): Long = atMs?.let { nowMs - it } ?: Long.MAX_VALUE
}
