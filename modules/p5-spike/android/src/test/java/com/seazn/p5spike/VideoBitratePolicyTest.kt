package com.seazn.p5spike

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/**
 * F-P5-5's decision, proven without a handset. Readings are Soak A's, or the safeguards run's on a
 * roaming cellular link carrying 0.8–1.0 Mbps (2026-09-14 evening), so a rule that would have
 * misread either goes red here rather than on a cellular uplink.
 */
class VideoBitratePolicyTest {
  /** Both sessions: SRT latency 2000 ms. */
  private val latencyMs = 2_000

  /** Soak A 17:00–17:40: 3.4–4.7 Mbps carried with a ~34 ms buffer, nothing dropped or lost. */
  private val healthy = LinkSample(droppedPackets = 0, sendBufferMs = 34, bandwidthBps = 11_000_000)

  private val dropping = healthy.copy(droppedPackets = 91)

  /** Soak A 19:15: the buffer reached 1300 ms a minute before SRT dropped anything, with the estimate at 247 Mbps. */
  private val backlogged = LinkSample(droppedPackets = 0, sendBufferMs = 1_300, bandwidthBps = 247_000_000)

  private fun next(state: Regulation, link: LinkSample?, nowMs: Long) =
    VideoBitratePolicy.next(state, link, nowMs, latencyMs)

  /** One tick a second, the regulator's own cadence, from [fromMs] through [toMs], each reading [link]. */
  private fun ride(state: Regulation, link: LinkSample?, fromMs: Long, toMs: Long): Regulation =
    (fromMs..toMs step 1_000).fold(state) { regulation, nowMs -> next(regulation, link, nowMs) }

  // Cuts

  @Test
  fun `a healthy link at the ceiling is left alone`() {
    val held = next(Regulation(3_000_000), healthy, nowMs = 60_000)

    assertEquals(3_000_000, held.targetBps)
    assertNull(held.lastCutAtMs)
  }

  @Test
  fun `sender drops halve the target`() {
    val cut = next(Regulation(3_000_000), dropping, nowMs = 60_000)

    assertEquals(1_500_000, cut.targetBps)
    assertEquals(60_000L, cut.lastCutAtMs)
  }

  @Test
  fun `a send buffer at half the latency cuts a quarter before anything is dropped`() {
    assertEquals(2_250_000, next(Regulation(3_000_000), backlogged, nowMs = 60_000).targetBps)
  }

  @Test
  fun `a buffer just under half the latency is not a backlog`() {
    val below = next(Regulation(3_000_000), healthy.copy(sendBufferMs = 999), nowMs = 60_000)

    assertEquals(3_000_000, below.targetBps)
    assertNull(below.lastCutAtMs)
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
    val appLimited = next(Regulation(3_000_000), healthy.copy(bandwidthBps = 180_000), nowMs = 60_000)

    assertEquals(3_000_000, appLimited.targetBps)
    assertNull(appLimited.lastCutAtMs)
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
  fun `a buffer at a quarter of the latency neither cuts nor raises`() {
    val strained = ride(Regulation(1_000_000), healthy.copy(sendBufferMs = 500), fromMs = 0, toMs = 60_000)

    assertEquals(1_000_000, strained.targetBps)
    assertNull(strained.lastCutAtMs)
  }

  /** RTMPS has no buffer or estimate to read: StreamPack's 10-tag send queue overflowing is its only signal. */
  @Test
  fun `a link with only a drop counter still regulates`() {
    val rtmp = LinkSample(droppedPackets = 0, sendBufferMs = null, bandwidthBps = null)

    assertEquals(1_500_000, next(Regulation(3_000_000), rtmp.copy(droppedPackets = 3), nowMs = 0).targetBps)
    assertEquals(1_100_000, ride(Regulation(1_000_000), rtmp, fromMs = 0, toMs = 10_000).targetBps)
  }

  // Requirement 1: where a session starts, and where a reconnect starts

  /** The safeguards run connected at the ceiling: send buffer 1.3–1.9 s and 1,512 sender drops. */
  @Test
  fun `a fresh session starts at 1,500,000 bps`() {
    assertEquals(1_500_000, VideoBitratePolicy.attemptStarted(carried = null).targetBps)
  }

  /**
   * The safeguards run's 20 s data cut: the reconnect raised on its first tick into a link that had
   * just failed, and dropped about 1,350 packets.
   */
  @Test
  fun `a reconnect starts at the last target and keeps the failed rate, but proves the new connection clean`() {
    val carried = Regulation(targetBps = 600_000, lastCutAtMs = 0, cleanSinceMs = 0, failed = FailedRate(1_200_000, atMs = 0))
    val resumed = VideoBitratePolicy.attemptStarted(carried)

    assertEquals(600_000, resumed.targetBps)
    assertEquals(carried.failed, resumed.failed)
    assertEquals(carried.lastCutAtMs, resumed.lastCutAtMs)
    // 34 s after the cut, but the new connection has been clean for only 9 s of it.
    assertEquals(600_000, ride(resumed, healthy, fromMs = 25_000, toMs = 34_000).targetBps)
    assertEquals(700_000, ride(resumed, healthy, fromMs = 25_000, toMs = 35_000).targetBps)
  }

  // Requirement 2: raise slowly, and only on a clean link

  /** The safeguards run raised 750k -> 1750k in 8 s, and the buffer was back at ~1.9 s within seconds. */
  @Test
  fun `a raise is one 100k step after ten clean seconds, and the next waits ten more`() {
    val start = Regulation(1_000_000)
    val raised = ride(start, healthy, fromMs = 0, toMs = 10_000)

    assertEquals(1_000_000, ride(start, healthy, fromMs = 0, toMs = 9_000).targetBps)
    assertEquals(1_100_000, raised.targetBps)
    assertEquals(1_100_000, ride(raised, healthy, fromMs = 11_000, toMs = 19_000).targetBps)
    assertEquals(1_200_000, ride(raised, healthy, fromMs = 11_000, toMs = 20_000).targetBps)
  }

  @Test
  fun `no raise passes the ceiling`() {
    assertEquals(3_000_000, ride(Regulation(2_950_000), healthy, fromMs = 0, toMs = 10_000).targetBps)
    assertEquals(3_000_000, ride(Regulation(3_000_000), healthy, fromMs = 0, toMs = 60_000).targetBps)
  }

  @Test
  fun `a send buffer at a tenth of the latency is not clean, and restarts the wait`() {
    val interrupted = next(ride(Regulation(1_000_000), healthy, fromMs = 0, toMs = 8_000), healthy.copy(sendBufferMs = 200), 9_000)

    assertEquals(1_100_000, ride(Regulation(1_000_000), healthy.copy(sendBufferMs = 199), fromMs = 0, toMs = 10_000).targetBps)
    assertEquals(1_000_000, ride(interrupted, healthy, fromMs = 10_000, toMs = 18_000).targetBps)
    assertEquals(1_100_000, ride(interrupted, healthy, fromMs = 10_000, toMs = 19_000).targetBps)
  }

  @Test
  fun `a new write-loss restarts the wait, with nothing dropped and an empty buffer`() {
    val interrupted = next(ride(Regulation(1_000_000), healthy, fromMs = 0, toMs = 4_000), healthy.copy(lostPackets = 12), 5_000)

    assertEquals(1_000_000, ride(interrupted, healthy, fromMs = 6_000, toMs = 14_000).targetBps)
    assertEquals(1_100_000, ride(interrupted, healthy, fromMs = 6_000, toMs = 15_000).targetBps)
  }

  @Test
  fun `no raise within 30 s of a cut`() {
    val cut = next(Regulation(2_000_000), dropping, nowMs = 0)

    assertEquals(1_000_000, ride(cut, healthy, fromMs = 1_000, toMs = 29_000).targetBps)
    assertEquals(1_100_000, ride(cut, healthy, fromMs = 1_000, toMs = 30_000).targetBps)
  }

  // Requirement 3: remember a failed rate

  /** The safeguards run probed about ten times in four minutes, each probe dropping 360–470 packets. */
  @Test
  fun `for five minutes after a cut, no raise passes 80 percent of the target that failed`() {
    val cut = next(Regulation(1_000_000), dropping, nowMs = 0)
    val capped = ride(cut, healthy, fromMs = 1_000, toMs = 299_000)

    assertEquals(800_000, capped.targetBps)
    // Expired: raises resume, one slow step at a time.
    assertEquals(900_000, ride(capped, healthy, fromMs = 300_000, toMs = 309_000).targetBps)
    assertEquals(1_000_000, ride(capped, healthy, fromMs = 300_000, toMs = 310_000).targetBps)
  }

  @Test
  fun `a new cut replaces the failed rate with the newer one`() {
    val first = ride(next(Regulation(1_000_000), dropping, nowMs = 0), healthy, fromMs = 1_000, toMs = 59_000)
    val second = next(first, backlogged, nowMs = 60_000)
    val capped = ride(second, healthy, fromMs = 61_000, toMs = 359_000)

    assertEquals(800_000, first.targetBps)
    assertEquals(600_000, second.targetBps)
    assertEquals(640_000, capped.targetBps)
    assertEquals(740_000, ride(capped, healthy, fromMs = 360_000, toMs = 360_000).targetBps)
  }

  // Requirement 4: judge capacity from what is sent

  /** The safeguards run: egress ran 0.25–0.6 Mbps above the target (audio, TS overhead, retransmits). */
  @Test
  fun `a cut leaves expected egress at no more than 80 percent of the egress last carried cleanly`() {
    val carrying = ride(Regulation(1_000_000), healthy.copy(egressBps = 1_150_000), fromMs = 0, toMs = 9_000)
    val cut = next(carrying, backlogged.copy(egressBps = 1_900_000), nowMs = 10_000)

    // (672k video + 128k audio) x 1.15 = 920k, 80% of 1.15 Mbps. The factor alone would give 750k.
    assertEquals(672_000, cut.targetBps)
  }

  @Test
  fun `the egress that sizes a cut is the mean of the last ten clean ticks, never an unclean one`() {
    val older = ride(Regulation(3_000_000), healthy.copy(egressBps = 3_000_000), fromMs = 0, toMs = 4_000)
    val recent = (5L..14L).fold(older) { state, second ->
      next(state, healthy.copy(egressBps = if (second % 2 == 0L) 1_000_000 else 1_300_000), second * 1_000)
    }
    val strained = next(recent, healthy.copy(sendBufferMs = 600, egressBps = 4_000_000), nowMs = 15_000)

    assertEquals(672_000, next(strained, backlogged.copy(egressBps = 4_000_000), nowMs = 16_000).targetBps)
  }

  /** The safeguards run at the 500k floor: about 0.75 Mbps of egress, carried with a buffer under 100 ms. */
  @Test
  fun `an egress-sized cut never goes below the floor`() {
    val atFloor = ride(Regulation(1_000_000), healthy.copy(egressBps = 750_000), fromMs = 0, toMs = 9_000)

    assertEquals(500_000, next(atFloor, backlogged, nowMs = 10_000).targetBps)
  }

  // Requirement 5: a negative or missing send buffer is no reading

  /** The safeguards run read msSndBuf as -336 and -90; Soak A read negatives through its rotation disruption. */
  @Test
  fun `a negative send buffer is no reading, so the tick holds even with drops`() {
    val unread = next(Regulation(1_000_000), dropping.copy(sendBufferMs = -336), nowMs = 60_000)

    assertEquals(1_000_000, unread.targetBps)
    assertNull(unread.lastCutAtMs)
  }

  /**
   * Soak A's healthy hours read a negative buffer on 1,063 of 7,803 ticks with nothing dropped.
   * Restarting the wait on each cost 17 minutes at the ceiling and avoided no cut (open-loop replay).
   */
  @Test
  fun `a tick with no reading neither raises nor restarts the wait, unless it saw drops or losses`() {
    val clean = ride(Regulation(1_000_000), healthy, fromMs = 0, toMs = 9_000)
    val lossy = next(clean, healthy.copy(sendBufferMs = -90, lostPackets = 30), 10_000)

    for (unread in listOf(next(clean, healthy.copy(sendBufferMs = -90), 10_000), next(clean, null, 10_000))) {
      assertEquals(1_000_000, unread.targetBps)
      assertEquals(1_100_000, next(unread, healthy, 11_000).targetBps)
    }
    assertEquals(1_000_000, lossy.targetBps)
    assertEquals(1_000_000, ride(lossy, healthy, fromMs = 11_000, toMs = 19_000).targetBps)
    assertEquals(1_100_000, ride(lossy, healthy, fromMs = 11_000, toMs = 20_000).targetBps)
  }
}
