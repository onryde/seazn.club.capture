package com.seazn.capture.engine.core

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlin.test.assertTrue

class LinkTest {
  private fun counters(bytes: Long, dropped: Long = 0, lost: Long = 0, buffer: Int? = 50) =
    LinkCounters(bytes, 0, 0, dropped, lost, 20, buffer, null)

  @Test
  fun `the first reading has no interval, so no egress`() {
    val (_, sample) = LinkMeter().read(counters(1_000), nowMs = 1_000)
    assertNull(sample.egressBps)
    assertEquals(0, sample.bytes)
  }

  @Test
  fun `egress is bits per second over the real interval`() {
    val (meter, _) = LinkMeter().read(counters(0), nowMs = 1_000)
    val (_, sample) = meter.read(counters(250_000), nowMs = 3_000)
    assertEquals(1_000_000, sample.egressBps)
    assertEquals(250_000, sample.bytes)
  }

  @Test
  fun `drops and losses are deltas`() {
    val (meter, _) = LinkMeter().read(counters(0, dropped = 249, lost = 10), nowMs = 0)
    val (_, sample) = meter.read(counters(0, dropped = 528, lost = 10), nowMs = 1_000)
    assertEquals(279, sample.droppedPackets)
    assertEquals(0, sample.lostPackets)
  }

  @Test
  fun `a counter that went backwards is no reading, not a negative one`() {
    val (meter, _) = LinkMeter().read(counters(5_000, dropped = 10), nowMs = 0)
    val (_, sample) = meter.read(counters(1_000, dropped = 2), nowMs = 1_000)
    assertNull(sample.egressBps)
    assertEquals(0, sample.bytes)
    assertEquals(0, sample.droppedPackets)
  }

  @Test
  fun `the first reading has no interval, so no drops or losses either`() {
    val (_, sample) = LinkMeter().read(counters(0, dropped = 249, lost = 10), nowMs = 1_000)
    assertEquals(0, sample.droppedPackets)
    assertEquals(0, sample.lostPackets)
  }

  // A second read in the same millisecond (a double tick) has no interval to divide by. Its bytes still count.
  @Test
  fun `a second reading at the same instant has no egress, and its bytes still count`() {
    val (meter, _) = LinkMeter().read(counters(0), nowMs = 1_000)
    val (_, sample) = meter.read(counters(1_000), nowMs = 1_000)
    assertNull(sample.egressBps)
    assertEquals(1_000, sample.bytes)
  }

  // Expected bytes/s worked by hand from the rule: (target + 128k) × 115% × 2 / 8.
  @Test
  fun `F-P5-11 SRTO_MAXBW follows the target`() {
    assertEquals(180_550, SrtBandwidth.maxBwBytesPerSecond(500_000))
    assertEquals(468_050, SrtBandwidth.maxBwBytesPerSecond(1_500_000))
    assertEquals(899_300, SrtBandwidth.maxBwBytesPerSecond(3_000_000))
  }

  @Test
  fun `F-P5-11 the cap at the floor sits under the throttled link and over the encoder's measured overshoot`() {
    val capBps = SrtBandwidth.maxBwBytesPerSecond(Encode.FLOOR_BPS) * 8
    assertTrue(capBps < 1_500_000, "P5's thin link was 1.5 Mbps; the burst was 13.9–17 Mbps")
    assertTrue(capBps > 1_000_000, "a 500k target measured 0.95–1.0 Mbps on a busy picture")
  }

  // The range's ends, worked by hand above: 3 000 000 gives 899 300, and 500 000 gives 180 550.
  @Test
  fun `a target outside the encode range is capped as the range`() {
    assertEquals(899_300, SrtBandwidth.maxBwBytesPerSecond(9_000_000))
    assertEquals(180_550, SrtBandwidth.maxBwBytesPerSecond(0))
  }
}
