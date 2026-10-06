package com.seazn.capture.engine.adapter

import com.seazn.capture.engine.core.LinkCounters

/**
 * StreamPack 3.2.1's `RtmpEndpoint.metrics` (javap, `RtmpEndpointMetricsKt`): komuxer's counters for the client of
 * the open connection, all zero before one, so they restart with each connection. Lost is always 0 there.
 */
data class RtmpsMetrics(val bytesWritten: Long, val packetsWritten: Long, val packetsWriteDropped: Long, val packetsWriteLost: Long)

/**
 * RTMPS's link reading for the Link poller (CD12). Session 7, item 2: the poller asked the SRT sink alone, so on
 * RTMPS the machine had no egress: every beat's `bitrateKbps` was null, data used stayed 0, and the regulator,
 * whose RTMPS rules read sender drops, never stepped.
 *
 * One RTMPS attempt at a time, as the SRT sink's: [begin] at its start, [end] at a stop, a release or an SRT start.
 * A reading for any other attempt is null. RTMPS measures no retransmits, round trip, send buffer or bandwidth.
 */
class RtmpsLink {
  @Volatile private var attemptId: Int? = null

  fun begin(attemptId: Int) {
    this.attemptId = attemptId
  }

  fun end() {
    attemptId = null
  }

  fun counters(forAttempt: Int, read: () -> RtmpsMetrics?): LinkCounters? {
    if (attemptId != forAttempt) return null
    val metrics = read() ?: return null
    return LinkCounters(
      bytesSent = metrics.bytesWritten,
      packetsSent = metrics.packetsWritten,
      packetsRetransmitted = 0,
      packetsDropped = metrics.packetsWriteDropped,
      packetsLost = metrics.packetsWriteLost,
      rttMs = null,
      sendBufferMs = null,
      bandwidthBps = null,
    )
  }
}
