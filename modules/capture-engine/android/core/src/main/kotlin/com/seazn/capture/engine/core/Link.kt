package com.seazn.capture.engine.core

/** The encode's fixed numbers (decision 3; AGENTS §8's ceiling). */
object Encode {
  const val CEILING_BPS = 3_000_000
  const val FLOOR_BPS = 500_000
  const val START_BPS = 1_500_000

  /** AAC at 128k, set at arm and never regulated. */
  const val AUDIO_BPS = 128_000

  /** Expected egress is (video + audio) × 115%: TS packaging and retransmits (F-P5-7). */
  const val EGRESS_OVERHEAD_PERCENT = 115L

  fun expectedEgressBps(videoTargetBps: Int): Long =
    (videoTargetBps.toLong() + AUDIO_BPS) * EGRESS_OVERHEAD_PERCENT / 100
}

/**
 * Cumulative counters the platform reads about once a second: `srt_bistats` for SRT, StreamPack's
 * endpoint metrics for RTMPS. They restart at zero on every connect.
 */
data class LinkCounters(
  val bytesSent: Long,
  val packetsSent: Long,
  val packetsRetransmitted: Long,
  /** Sender drops: SRT's too-late packets, or StreamPack's RTMP queue overflowing. */
  val packetsDropped: Long,
  /** SRT's `pktSndLoss`. RTMPS reports none. */
  val packetsLost: Long,
  val rttMs: Int?,
  /** SRT's `msSndBuf`. Negative readings happen (P5: −336) and are no reading. */
  val sendBufferMs: Int?,
  /** SRT's bandwidth estimate. It sizes a cut and never triggers one (F-P5-5). */
  val bandwidthBps: Long?,
)

/** One reading of the link, as deltas since the last one. */
data class LinkSample(
  val droppedPackets: Long,
  val lostPackets: Long,
  val sendBufferMs: Int?,
  val bandwidthBps: Long?,
  /** Bits per second written since the last reading; null when there is no interval to judge. */
  val egressBps: Long?,
  /** Bytes written since the last reading, for data used. */
  val bytes: Long,
)

/** Turns cumulative counters into [LinkSample]s. A counter that went backwards counts as none. */
data class LinkMeter(val last: LinkCounters? = null, val lastAtMs: Long = 0) {
  fun read(counters: LinkCounters, nowMs: Long): Pair<LinkMeter, LinkSample> {
    val previous = last
    val elapsedMs = nowMs - lastAtMs
    val bytes = previous?.let { (counters.bytesSent - it.bytesSent).coerceAtLeast(0) } ?: 0
    val egress =
      if (previous == null || elapsedMs <= 0 || counters.bytesSent < previous.bytesSent) null
      else bytes * 8_000 / elapsedMs
    val sample =
      LinkSample(
        droppedPackets = delta(previous?.packetsDropped, counters.packetsDropped),
        lostPackets = delta(previous?.packetsLost, counters.packetsLost),
        sendBufferMs = counters.sendBufferMs,
        bandwidthBps = counters.bandwidthBps,
        egressBps = egress,
        bytes = bytes,
      )
    return LinkMeter(counters, nowMs) to sample
  }

  private fun delta(previous: Long?, now: Long): Long = previous?.let { (now - it).coerceAtLeast(0) } ?: 0
}

/**
 * F-P5-11: libsrt paces nothing in live mode unless told (`SRTO_MAXBW` defaults to −1), so a thin
 * link got its backlog dumped at 13.9–17 Mbps. The cap follows the regulator's target.
 */
object SrtBandwidth {
  /**
   * VBR overshoots its target: 0.95–1.0 Mbps at a 500k target on a busy picture (F-P5-7's thin-link
   * run), ~1.4× the expected egress. Twice the expected egress leaves that room plus retransmits,
   * and still bounds the burst to about the link P5 throttled to.
   */
  const val OVERSHOOT_FACTOR = 2L

  /** `SRTO_MAXBW`, in bytes per second, for a video target. */
  fun maxBwBytesPerSecond(videoTargetBps: Int): Long {
    val target = videoTargetBps.coerceIn(Encode.FLOOR_BPS, Encode.CEILING_BPS)
    return Encode.expectedEgressBps(target) * OVERSHOOT_FACTOR / 8
  }
}
