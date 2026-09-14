package com.seazn.p5spike

import kotlin.math.min

/**
 * One tick's view of the uplink, reduced from the transport's own counters by the regulators in
 * `LinkRegulators.kt`. Nothing here reads a socket, so every rule below is proven on the JVM.
 */
data class LinkSample(
  /** Packets the sender gave up on since the last tick: SRT's too-late drops, or StreamPack's RTMP send queue overflowing. */
  val droppedPackets: Long,
  /** SRT's unacknowledged span (`msSndBuf`); null on a transport that has none. */
  val sendBufferMs: Int?,
  /** SRT's bandwidth estimate; null when there is none. It sizes a cut and never triggers one. */
  val bandwidthBps: Long?,
)

/** What the regulator remembers between ticks. */
data class Regulation(
  val targetBps: Int,
  val lastCutAtMs: Long? = null,
  val lastRaiseAtMs: Long? = null,
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
 * So the estimate only sizes a cut once congestion is already visible.
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

  /** AAC at 128k, set at arm and never regulated. Subtracted when the estimate sizes a cut. */
  const val AUDIO_BPS = 128_000

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
   * 250k at most every 2 s, so floor to ceiling in 20 s. That is small enough that one step cannot
   * turn a carried rate into F-P5-5's overload before the send buffer shows it.
   */
  const val RAISE_STEP_BPS = 250_000
  const val RAISE_INTERVAL_MS = 2_000L

  /** A cut means the link has just failed to carry the old rate. Probing straight back would recreate the overload. */
  const val RAISE_AFTER_CUT_MS = 10_000L

  /**
   * @param latencyMs the transport's delivery window. The send buffer is judged against it
   *   (backlogged at half, strained at a quarter). After a cut, it is how long the data queued before
   *   the cut takes to be sent or dropped, so drops inside it say nothing about the new rate.
   */
  fun next(state: Regulation, link: LinkSample, nowMs: Long, latencyMs: Int): Regulation {
    val current = state.copy(targetBps = state.targetBps.coerceIn(FLOOR_BPS, CEILING_BPS))
    val sendBufferMs = link.sendBufferMs ?: 0
    val dropping = link.droppedPackets > 0
    val backlogged = sendBufferMs >= latencyMs / 2
    val draining = current.lastCutAtMs?.let { nowMs - it < latencyMs } ?: false
    return when {
      (dropping || backlogged) && !draining ->
        cut(current, link, nowMs, if (dropping) CUT_ON_DROPS else CUT_ON_BACKLOG)
      dropping || backlogged || sendBufferMs >= latencyMs / 4 -> current
      raiseDue(current, nowMs) ->
        current.copy(targetBps = min(current.targetBps + RAISE_STEP_BPS, CEILING_BPS), lastRaiseAtMs = nowMs)
      else -> current
    }
  }

  private fun cut(state: Regulation, link: LinkSample, nowMs: Long, factor: Double): Regulation {
    val byFactor = (state.targetBps * factor).toLong()
    val byEstimate = link.bandwidthBps?.takeIf { it > 0 }
      ?.let { (it * ESTIMATE_HEADROOM).toLong() - AUDIO_BPS } ?: Long.MAX_VALUE
    val target = min(byFactor, byEstimate).coerceIn(FLOOR_BPS.toLong(), state.targetBps.toLong())
    return state.copy(targetBps = target.toInt(), lastCutAtMs = nowMs)
  }

  private fun raiseDue(state: Regulation, nowMs: Long): Boolean =
    state.targetBps < CEILING_BPS &&
      (state.lastCutAtMs?.let { nowMs - it >= RAISE_AFTER_CUT_MS } ?: true) &&
      (state.lastRaiseAtMs?.let { nowMs - it >= RAISE_INTERVAL_MS } ?: true)
}
