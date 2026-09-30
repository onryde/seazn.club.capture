package com.seazn.capture.engine.core

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

/** Every number here is quoted from the P5 results or worked by hand from the rule it names. */
class BitrateRegulatorTest {
  private val latency = 2_000

  private fun reading(
    egress: Long? = 4_000_000,
    buffer: Int? = 50,
    dropped: Long = 0,
    lost: Long = 0,
    estimate: Long? = null,
  ) = LinkSample(dropped, lost, buffer, estimate, egress, bytes = 0)

  /** One reading a second from [fromMs] to [toMs] inclusive, SRT unless told otherwise. */
  private fun run(
    start: Regulation,
    fromMs: Long,
    toMs: Long,
    transport: Transport = Transport.SRT,
    sample: (Long) -> LinkSample = { reading() },
  ): Regulation {
    var state = start
    var t = fromMs
    while (t <= toMs) {
      state = BitrateRegulator.next(state, sample(t), t, transport, latency)
      t += 1_000
    }
    return state
  }

  @Test
  fun `F-P5-5 a session starts at 1500k`() {
    assertEquals(1_500_000, BitrateRegulator.sessionStarted().targetBps)
  }

  @Test
  fun `F-P5-7 a tested clean interval raises 100k per 10 s`() {
    val start = BitrateRegulator.sessionStarted()
    assertEquals(1_500_000, run(start, 1_000, 10_000).targetBps)
    assertEquals(1_600_000, run(start, 1_000, 11_000).targetBps)
    assertEquals(1_700_000, run(start, 1_000, 21_000).targetBps)
  }

  @Test
  fun `F-P5-7 a quiet picture does not raise in 80 s`() {
    // P5, 15:58:54Z: egress ~0.5 Mbps, 0.15–0.17 of expected at 2700k. No raise in 80 s.
    val quiet = run(Regulation(2_700_000), 1_000, 80_000) { reading(egress = 500_000, buffer = 43) }
    assertEquals(2_700_000, quiet.targetBps)
  }

  @Test
  fun `F-P5-7 the raise gate is 70 percent of (target + 128k) x 1_15`() {
    // (1_500_000 + 128_000) × 1.15 = 1_872_200; 70% of that is 1_310_540.
    val atGate = run(Regulation(1_500_000), 1_000, 11_000) { reading(egress = 1_310_540) }
    val underGate = run(Regulation(1_500_000), 1_000, 11_000) { reading(egress = 1_310_539) }
    assertEquals(1_600_000, atGate.targetBps)
    assertEquals(1_500_000, underGate.targetBps)
  }

  @Test
  fun `the target never passes 3000k`() {
    val start = Regulation(2_950_000)
    assertEquals(3_000_000, run(start, 1_000, 11_000).targetBps)
    assertEquals(3_000_000, run(start, 1_000, 31_000).targetBps)
  }

  @Test
  fun `the target never falls under 500k`() {
    val state = run(Regulation(600_000), 1_000, 1_000) { reading(dropped = 40) }
    assertEquals(500_000, state.targetBps)
  }

  @Test
  fun `F-P5-5 sender drops halve the target`() {
    val state = run(Regulation(3_000_000), 1_000, 1_000) { reading(dropped = 10) }
    assertEquals(1_500_000, state.targetBps)
    assertEquals(FailedRate(3_000_000, 1_000), state.failed)
  }

  @Test
  fun `F-P5-5 a backlog of half the latency cuts by a quarter`() {
    val state = run(Regulation(3_000_000), 1_000, 1_000) { reading(buffer = 1_000) }
    assertEquals(2_250_000, state.targetBps)
  }

  @Test
  fun `F-P5-5 a cut is sized from what the link carried`() {
    // P5 retuned-regulator table: "3000k → 1552000 on a 1.1 s send buffer with no drops".
    // 2_415_000 × 80 / 115 − 128_000 = 1_552_000.
    val carried = run(Regulation(3_000_000), 1_000, 10_000) { reading(egress = 2_415_000) }
    val cut = run(carried, 11_000, 11_000) { reading(egress = 2_415_000, buffer = 1_100) }
    assertEquals(1_552_000, cut.targetBps)
  }

  @Test
  fun `F-P5-5 SRT's estimate sizes a cut and never triggers one`() {
    val clean = run(Regulation(2_000_000), 1_000, 1_000) { reading(estimate = 300_000) }
    assertEquals(2_000_000, clean.targetBps)
    // 1_000_000 × 80% − 128_000 = 672_000, under the halving's 1_500_000.
    val cut = run(Regulation(3_000_000), 1_000, 1_000) { reading(dropped = 5, estimate = 1_000_000) }
    assertEquals(672_000, cut.targetBps)
  }

  @Test
  fun `F-P5-7 a failed rate caps raises at 80 percent for 5 min`() {
    // P5 device table: "Caps at 1200000, 1401600 and 630720 (80% of 1500k, 1752k, 788.4k)".
    for ((failed, cap) in listOf(1_500_000 to 1_200_000, 1_752_000 to 1_401_600, 788_400 to 630_720)) {
      assertEquals(cap, BitrateRegulator.raiseCap(Regulation(500_000, failed = FailedRate(failed, 0)), 1_000))
    }
    val start = Regulation(1_300_000, lastCutAtMs = 0, failed = FailedRate(1_752_000, 0))
    assertEquals(1_401_600, run(start, 1_000, 299_000).targetBps)
    assertEquals(1_501_600, run(start, 1_000, 300_000).targetBps)
  }

  @Test
  fun `no raise within 30 s of a cut`() {
    val start = Regulation(1_000_000, lastCutAtMs = 0)
    assertEquals(1_000_000, run(start, 1_000, 29_000).targetBps)
    assertEquals(1_100_000, run(start, 1_000, 30_000).targetBps)
  }

  @Test
  fun `drops inside one latency of a cut are the old rate draining`() {
    val start = Regulation(3_000_000)
    assertEquals(1_500_000, run(start, 1_000, 2_000) { reading(dropped = 9) }.targetBps)
    assertEquals(750_000, run(start, 1_000, 3_000) { reading(dropped = 9) }.targetBps)
  }

  @Test
  fun `a negative send buffer is no reading`() {
    // P5, F-P5-5: "negative `srtSndBufMs` values (e.g. −336) — a reading artefact to keep out of any threshold".
    val state = run(Regulation(2_000_000), 1_000, 20_000) { reading(buffer = -336) }
    assertEquals(2_000_000, state.targetBps)
    assertNull(state.cleanSinceMs)
  }

  @Test
  fun `a missing send buffer is no reading on SRT, which always reports one, and empty on RTMPS, which has none`() {
    // Clean readings from 1 s make a raise due at 11 s; 4000k of egress passes the gate (908_040 at 1000k).
    val srt = run(Regulation(1_000_000), 1_000, 11_000) { reading(buffer = null) }
    assertEquals(1_000_000, srt.targetBps)
    assertNull(srt.cleanSinceMs)
    val rtmps = run(Regulation(1_000_000), 1_000, 11_000, Transport.RTMPS) { reading(buffer = null) }
    assertEquals(1_100_000, rtmps.targetBps)
  }

  @Test
  fun `a send buffer of 0 ms is drained, not missing`() {
    assertEquals(1_100_000, run(Regulation(1_000_000), 1_000, 11_000) { reading(buffer = 0) }.targetBps)
  }

  @Test
  fun `a cut restarts the clean interval, so egress from before it never passes a raise gate`() {
    // Clean at 4000k egress from 1 s to 9 s, then drops at 10 s cut 2000k to 1000k: the halving is
    // under the egress sizing, 4_000_000 * 80 / 115 - 128_000 = 2_654_608. Then 500k of egress every
    // 4 s. The raise is due at 42 s, 30 s after the cut, and the interval since the cut is 8 readings
    // of 500k, under the gate of 908_040. Egress from before the cut would make the last 10 readings
    // 2 of 4000k and 8 of 500k, a mean of 1200k, and raise a link that just failed.
    val clean = run(Regulation(2_000_000), 1_000, 9_000) { reading(egress = 4_000_000) }
    var state = run(clean, 10_000, 10_000) { reading(dropped = 5) }
    assertEquals(1_000_000, state.targetBps)
    for (t in 14_000L..46_000L step 4_000) {
      state = BitrateRegulator.next(state, reading(egress = 500_000), t, Transport.SRT, latency)
    }
    assertEquals(1_000_000, state.targetBps)
  }

  @Test
  fun `regulator restart - a clean far-end drop restarts at the last healthy target`() {
    // P5 final soak: Cloudflare stopped acknowledging on a clean link (no loss), the buffer filled,
    // the sender dropped late packets, and the old build restarted at 1500k → 516k → 500k.
    val healthy = run(BitrateRegulator.sessionStarted(), 1_000, 5_000) { reading(egress = 1_900_000) }
    val filling = run(healthy, 6_000, 6_000) { reading(buffer = 1_200) }
    val dropping = run(filling, 9_000, 9_000) { reading(buffer = 2_000, dropped = 300) }
    assertEquals(1_125_000, filling.targetBps)
    assertEquals(562_500, dropping.targetBps)
    val restarted = BitrateRegulator.afterDrop(dropping, nowMs = 12_000)
    assertEquals(1_500_000, restarted.targetBps)
    assertNull(restarted.failed)
  }

  @Test
  fun `regulator restart - a link that was failing halves`() {
    val lossy = run(Regulation(1_500_000), 1_000, 1_000) { reading(lost = 5) }
    assertEquals(750_000, BitrateRegulator.afterDrop(lossy, nowMs = 5_000).targetBps)
    assertEquals(1_500_000, BitrateRegulator.afterDrop(lossy, nowMs = 12_000).targetBps)
  }

  @Test
  fun `on RTMPS the failing signal is sender drops, since RTMPS reports no loss`() {
    val dropped = run(Regulation(2_000_000), 1_000, 1_000, Transport.RTMPS) { reading(buffer = null, dropped = 3) }
    assertEquals(1_000_000, dropped.targetBps)
    assertEquals(500_000, BitrateRegulator.afterDrop(dropped, nowMs = 2_000).targetBps)
  }

  @Test
  fun `a requested reconnect keeps the target`() {
    // P5 device table: "Reconnect at the last target: 3000k after the stall recovery".
    val state = BitrateRegulator.attemptStarted(Regulation(3_000_000, cleanSinceMs = 4_000))
    assertEquals(3_000_000, state.targetBps)
    assertNull(state.cleanSinceMs)
  }

  // Each test below pins a guard that a mutation of the code above showed no other test kills.

  @Test
  fun `regulator restart - a link failing 10 s before the drop halves and remembers the rate`() {
    // Loss at 1 s; the drop at 11 s is 10 s later, still "within" FAILING_LOOKBACK_MS.
    val lossy = run(Regulation(1_500_000), 1_000, 1_000) { reading(lost = 5) }
    val halved = BitrateRegulator.afterDrop(lossy, nowMs = 11_000)
    assertEquals(750_000, halved.targetBps)
    assertEquals(FailedRate(1_500_000, 11_000), halved.failed)
  }

  @Test
  fun `regulator restart - a halving never falls under 500k`() {
    // 600_000 / 2 = 300_000, under the floor.
    val lossy = run(Regulation(600_000), 1_000, 1_000) { reading(lost = 5) }
    assertEquals(500_000, BitrateRegulator.afterDrop(lossy, nowMs = 2_000).targetBps)
  }

  @Test
  fun `regulator restart - a rate that failed before the link was healthy stays remembered`() {
    // Drops at 1 s cut 3_000_000 to 1_500_000; the link is clean from 2 s to 5 s; the far end drops at 6 s.
    val cut = run(Regulation(3_000_000), 1_000, 1_000) { reading(dropped = 10) }
    val healthy = run(cut, 2_000, 5_000)
    val restarted = BitrateRegulator.afterDrop(healthy, nowMs = 6_000)
    assertEquals(1_500_000, restarted.targetBps)
    assertEquals(FailedRate(3_000_000, 1_000), restarted.failed)
  }

  @Test
  fun `regulator restart - the healthy target follows raises`() {
    // Raised at 11 s to 1_600_000, clean at 12 s, a backlog at 13 s cuts by a quarter to 1_200_000.
    val raised = run(Regulation(1_500_000), 1_000, 12_000)
    val cut = run(raised, 13_000, 13_000) { reading(buffer = 1_000) }
    assertEquals(1_200_000, cut.targetBps)
    val restarted = BitrateRegulator.afterDrop(cut, nowMs = 14_000)
    assertEquals(1_600_000, restarted.targetBps)
    assertEquals(1_600_000, BitrateRegulator.afterDrop(restarted, nowMs = 15_000).targetBps)
  }

  @Test
  fun `a negative send buffer with drops or loss still restarts the clean wait`() {
    for (unclean in listOf(reading(buffer = -336, dropped = 1), reading(buffer = -336, lost = 1))) {
      // Clean from 1 s, so due at 11 s; the unclean reading at 10 s moves that to 20 s.
      val marked = run(run(Regulation(1_000_000), 1_000, 9_000), 10_000, 10_000) { unclean }
      assertEquals(1_000_000, run(marked, 11_000, 19_000).targetBps, "$unclean")
      assertEquals(1_100_000, run(marked, 11_000, 20_000).targetBps, "$unclean")
    }
  }

  @Test
  fun `no reading at all holds the target and the clean wait`() {
    // Clean from 1 s, nothing read at 6 s, clean again to 11 s: the raise is still due at 11 s.
    val before = run(Regulation(1_000_000), 1_000, 5_000)
    val gap = BitrateRegulator.next(before, null, 6_000, Transport.SRT, latency)
    assertEquals(before, gap)
    assertEquals(1_100_000, run(gap, 7_000, 11_000).targetBps)
  }

  @Test
  fun `loss, or a send buffer over a tenth of the latency, restarts the clean wait`() {
    // 300 ms is over 2_000 / 10 and under the 1_000 ms backlog: not clean, and no cut.
    for (unclean in listOf(reading(lost = 1), reading(buffer = 300))) {
      // Clean from 1 s, so due at 11 s; the unclean reading at 11 s moves that to 21 s.
      val restarted = run(run(Regulation(1_000_000), 1_000, 10_000), 11_000, 11_000) { unclean }
      assertEquals(1_000_000, restarted.targetBps, "$unclean")
      assertEquals(1_000_000, run(restarted, 12_000, 20_000).targetBps, "$unclean")
      assertEquals(1_100_000, run(restarted, 12_000, 21_000).targetBps, "$unclean")
    }
  }

  @Test
  fun `on RTMPS a cut drains for 2 s whatever the SRT latency`() {
    val drop = reading(buffer = null, dropped = 3)
    val cut = BitrateRegulator.next(Regulation(2_000_000), drop, 1_000, Transport.RTMPS, srtLatencyMs = 8_000)
    val again = BitrateRegulator.next(cut, drop, 3_000, Transport.RTMPS, srtLatencyMs = 8_000)
    assertEquals(1_000_000, cut.targetBps)
    assertEquals(500_000, again.targetBps)
  }

  @Test
  fun `F-P5-5 an estimate of zero is no estimate`() {
    // Drops halve 3_000_000 to 1_500_000. A zero estimate taken at face value sizes it to the floor.
    val state = run(Regulation(3_000_000), 1_000, 1_000) { reading(dropped = 5, estimate = 0) }
    assertEquals(1_500_000, state.targetBps)
  }

  @Test
  fun `readings with no egress neither test a raise nor size a cut`() {
    val unmeasured = run(Regulation(2_000_000), 1_000, 11_000) { reading(egress = null) }
    assertEquals(2_000_000, unmeasured.targetBps)
    // Drops halve 2_000_000 to 1_000_000. A missing egress taken as zero sizes it to the floor.
    assertEquals(1_000_000, run(unmeasured, 12_000, 12_000) { reading(egress = null, dropped = 5) }.targetBps)
  }

  @Test
  fun `F-P5-5 a cut is sized from the last ten clean readings`() {
    // Ten at 4_000_000, then ten at 2_415_000: 2_415_000 × 80 / 115 − 128_000 = 1_552_000.
    // All twenty would average 3_207_500 and size it to 2_103_304.
    val early = run(Regulation(3_000_000), 1_000, 10_000) { reading(egress = 4_000_000) }
    val late = run(early, 11_000, 20_000) { reading(egress = 2_415_000) }
    val cut = run(late, 21_000, 21_000) { reading(egress = 2_415_000, buffer = 1_100) }
    assertEquals(1_552_000, cut.targetBps)
  }

  @Test
  fun `F-P5-7 an untested interval starts a new one, so a busy picture proves itself for 10 s`() {
    // 500_000 is under 1500k's 1_310_540 gate: no raise at 11 s, and a new interval from 11 s.
    val quiet = run(Regulation(1_500_000), 1_000, 11_000) { reading(egress = 500_000) }
    assertEquals(1_500_000, run(quiet, 12_000, 20_000) { reading(egress = 4_000_000) }.targetBps)
    assertEquals(1_600_000, run(quiet, 12_000, 21_000) { reading(egress = 4_000_000) }.targetBps)
  }

  @Test
  fun `F-P5-7 only the current interval's egress tests a raise`() {
    // Readings 2 s apart. 2_500_000 from 2 s tests the raise at 12 s to 1_600_000. Then 500_000 from
    // 14 s: the interval due at 22 s holds five quiet readings, under 1600k's gate of
    // (1_600_000 + 128_000) × 1.15 × 70% = 1_391_040. The last ten readings, five of them busy,
    // would average 1_500_000 and pass it.
    var state = Regulation(1_500_000)
    for (t in 2_000L..22_000L step 2_000) {
      state = BitrateRegulator.next(state, reading(egress = if (t <= 12_000) 2_500_000 else 500_000), t, Transport.SRT, latency)
      if (t == 12_000L) assertEquals(1_600_000, state.targetBps)
    }
    assertEquals(1_600_000, state.targetBps)
  }

  @Test
  fun `F-P5-7 raises come at most one step per 10 s`() {
    // Only a hand-built state reaches this: through next(), every raise also restarts the clean wait.
    // Clean since 1 s makes 11 s due; the raise at 5 s holds it to 15 s.
    val start = Regulation(1_000_000, lastRaiseAtMs = 5_000, cleanSinceMs = 1_000)
    assertEquals(1_000_000, run(start, 1_000, 14_000).targetBps)
    assertEquals(1_100_000, run(start, 1_000, 15_000).targetBps)
  }

  @Test
  fun `a raise never pulls the target down to a cap under it`() {
    // 80% of a 1_500_000 that failed at 0 s is 1_200_000, under the 1_500_000 target.
    val start = Regulation(1_500_000, failed = FailedRate(1_500_000, 0))
    assertEquals(1_500_000, run(start, 1_000, 11_000).targetBps)
  }

  @Test
  fun `a target outside 500k to 3000k is brought inside at the next reading`() {
    assertEquals(3_000_000, run(Regulation(4_000_000), 1_000, 1_000).targetBps)
    assertEquals(500_000, run(Regulation(100_000), 1_000, 1_000).targetBps)
  }
}
