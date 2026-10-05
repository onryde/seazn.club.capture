package com.seazn.capture.engine.adapter

import com.seazn.capture.engine.core.LinkCounters
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

/**
 * Session 7, item 2: on RTMPS the Link poller read nothing (it asked the SRT sink alone), so every beat's
 * `bitrateKbps` was null. RTMPS's reading is StreamPack 3.2.1's `RtmpEndpoint.metrics`, for the RTMPS attempt only.
 */
class RtmpsLinkTest {
  private val metrics = RtmpsMetrics(bytesWritten = 2_000_000, packetsWritten = 1_400, packetsWriteDropped = 3, packetsWriteLost = 0)

  @Test
  fun `the RTMPS attempt's reading is the endpoint's counters, with what RTMPS cannot measure left unknown`() {
    val link = RtmpsLink()
    link.begin(7)
    assertEquals(LinkCounters(2_000_000, 1_400, 0, 3, 0, null, null, null), link.counters(7) { metrics })
  }

  @Test
  fun `no reading before a begin, for another attempt, after an end, or with no endpoint`() {
    val link = RtmpsLink()
    assertNull(link.counters(7) { metrics }, "before any RTMPS attempt began")
    link.begin(7)
    assertNull(link.counters(6) { metrics }, "an older attempt")
    assertNull(link.counters(7) { null }, "no endpoint to read")
    link.begin(8)
    assertNull(link.counters(7) { metrics }, "the attempt a newer one replaced")
    assertEquals(metrics.bytesWritten, link.counters(8) { metrics }?.bytesSent, "the positive pair")
    link.end()
    assertNull(link.counters(8) { metrics }, "after its stop or an SRT start")
  }
}
