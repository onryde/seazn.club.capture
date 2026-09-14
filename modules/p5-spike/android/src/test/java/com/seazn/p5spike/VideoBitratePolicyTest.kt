package com.seazn.p5spike

import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * F-P5-5's decision, proven without a handset. Readings are Soak A's own where one exists, so a
 * rule that would have misread that run goes red here rather than on a cellular uplink.
 */
class VideoBitratePolicyTest {
  /** Soak A's session: SRT latency 2000 ms. */
  private val latencyMs = 2_000

  /** Soak A 17:00–17:40: 3.4–4.7 Mbps carried with a ~34 ms buffer and nothing dropped. */
  private val healthy = LinkSample(droppedPackets = 0, sendBufferMs = 34, bandwidthBps = 11_000_000)

  private val dropping = healthy.copy(droppedPackets = 91)

  private fun next(state: Regulation, link: LinkSample, nowMs: Long) =
    VideoBitratePolicy.next(state, link, nowMs, latencyMs)

  @Test
  fun `a healthy link at the ceiling is left alone`() {
    assertEquals(Regulation(3_000_000), next(Regulation(3_000_000), healthy, nowMs = 60_000))
  }

  @Test
  fun `sender drops halve the target`() {
    val cut = next(Regulation(3_000_000), dropping, nowMs = 60_000)

    assertEquals(1_500_000, cut.targetBps)
    assertEquals(60_000L, cut.lastCutAtMs)
  }

  /** Soak A 19:15: the buffer reached 1300 ms a minute before SRT dropped anything, with the estimate at 247 Mbps. */
  @Test
  fun `a send buffer at half the latency cuts a quarter before anything is dropped`() {
    val backlog = LinkSample(droppedPackets = 0, sendBufferMs = 1_300, bandwidthBps = 247_000_000)

    assertEquals(2_250_000, next(Regulation(3_000_000), backlog, nowMs = 60_000).targetBps)
  }

  @Test
  fun `a buffer just under half the latency is not a backlog`() {
    val below = healthy.copy(sendBufferMs = 999)

    assertEquals(3_000_000, next(Regulation(3_000_000), below, nowMs = 60_000).targetBps)
  }

  /** F-P5-5's second session: buffer pinned at the latency limit, drops, SRT estimating 1.2 Mbps. */
  @Test
  fun `once congested, the estimate sizes the cut, leaving room for audio`() {
    val pinned = LinkSample(droppedPackets = 26_000, sendBufferMs = 2_049, bandwidthBps = 1_200_000)

    // 1.2 Mbps x 0.8 headroom, less 128k of audio.
    assertEquals(832_000, next(Regulation(3_000_000), pinned, nowMs = 60_000).targetBps)
  }

  /**
   * Soak A 18:20–19:12: a still scene at 0.5 Mbps, 30 fps, nothing dropped, a 34 ms buffer, and SRT
   * estimating 0.17–0.3 Mbps — below what it was carrying, for most of an hour. Estimate-triggered,
   * this would have floored a healthy broadcast.
   */
  @Test
  fun `an estimate below the sending rate on a healthy link never cuts`() {
    val appLimited = healthy.copy(bandwidthBps = 180_000)

    assertEquals(Regulation(3_000_000), next(Regulation(3_000_000), appLimited, nowMs = 60_000))
  }

  @Test
  fun `no cut goes below the floor`() {
    assertEquals(500_000, next(Regulation(600_000), dropping, nowMs = 0).targetBps)
    assertEquals(500_000, next(Regulation(500_000), dropping, nowMs = 0).targetBps)
    assertEquals(500_000, next(Regulation(3_000_000), dropping.copy(bandwidthBps = 100_000), nowMs = 0).targetBps)
  }

  @Test
  fun `no second cut while the backlog from before the first is still draining`() {
    val cut = next(Regulation(3_000_000), dropping, nowMs = 60_000)

    assertEquals(1_500_000, next(cut, dropping, nowMs = 61_999).targetBps)
    assertEquals(750_000, next(cut, dropping, nowMs = 62_000).targetBps)
  }

  @Test
  fun `a healthy link raises the target one step at a time, up to the ceiling`() {
    val raised = next(Regulation(1_000_000), healthy, nowMs = 0)

    assertEquals(1_250_000, raised.targetBps)
    assertEquals(1_250_000, next(raised, healthy, nowMs = 1_999).targetBps)
    assertEquals(1_500_000, next(raised, healthy, nowMs = 2_000).targetBps)
    assertEquals(3_000_000, next(Regulation(2_900_000), healthy, nowMs = 0).targetBps)
  }

  @Test
  fun `no raise for ten seconds after a cut`() {
    val cut = next(Regulation(2_000_000), dropping, nowMs = 0)

    assertEquals(1_000_000, next(cut, healthy, nowMs = 9_999).targetBps)
    assertEquals(1_250_000, next(cut, healthy, nowMs = 10_000).targetBps)
  }

  @Test
  fun `a buffer at a quarter of the latency holds the target without cutting it`() {
    val strained = healthy.copy(sendBufferMs = 500)

    assertEquals(Regulation(1_000_000), next(Regulation(1_000_000), strained, nowMs = 60_000))
  }

  /** RTMPS has no buffer or estimate to read: StreamPack's 10-tag send queue overflowing is its only signal. */
  @Test
  fun `a link with only a drop counter still regulates`() {
    val rtmp = LinkSample(droppedPackets = 0, sendBufferMs = null, bandwidthBps = null)

    assertEquals(1_500_000, next(Regulation(3_000_000), rtmp.copy(droppedPackets = 3), nowMs = 0).targetBps)
    assertEquals(1_250_000, next(Regulation(1_000_000), rtmp, nowMs = 0).targetBps)
  }
}
