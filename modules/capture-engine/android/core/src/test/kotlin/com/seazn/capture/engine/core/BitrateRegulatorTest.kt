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
  fun `F-P5-7 a tested clean interval raises 20 percent per 10 s`() {
    // The controller's step (R-990P, 2026-10-26): 1_500_000 × 20 / 100 = 300_000, then 1_800_000 × 20 / 100 = 360_000.
    val start = BitrateRegulator.sessionStarted()
    assertEquals(1_500_000, run(start, 1_000, 10_000).targetBps)
    assertEquals(1_800_000, run(start, 1_000, 11_000).targetBps)
    assertEquals(2_160_000, run(start, 1_000, 21_000).targetBps)
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
    assertEquals(1_800_000, atGate.targetBps)
    assertEquals(1_500_000, underGate.targetBps)
  }

  @Test
  fun `a busy picture on a link that carries it climbs from the floor to 3000k in 10 raises, 100 s, and stays`() {
    // Owner, 2026-10-27: "make sure that do we reach that always 3000k". 4 Mbps of egress passes every gate on the way
    // (the highest, at 2_579_889: (2_579_889 + 128_000) × 1.15 × 0.7 = 2_179_850). Each raise is 20% of the target,
    // whole b/s, and never under 100k; the first falls due 10 s after the first clean reading, each next 10 s after it:
    // 500_000 → 600_000 (100k, the minimum) → 720_000 → 864_000 → 1_036_800 → 1_244_160 → 1_492_992 → 1_791_590
    // → 2_149_908 → 2_579_889 → 3_000_000 (3_095_866, held to the ceiling), at 11 s, 21 s, … 101 s.
    val steps = listOf(600_000, 720_000, 864_000, 1_036_800, 1_244_160, 1_492_992, 1_791_590, 2_149_908, 2_579_889, 3_000_000)
    var state = Regulation(Encode.FLOOR_BPS)
    val seen = mutableListOf<Pair<Long, Int>>()
    for (t in 1_000L..200_000L step 1_000) {
      val before = state.targetBps
      state = BitrateRegulator.next(state, reading(), t, Transport.SRT, latency)
      if (state.targetBps != before) seen += t to state.targetBps
    }
    assertEquals((0 until 10).map { 11_000L + it * 10_000L }.zip(steps), seen)
    assertEquals(3_000_000, state.targetBps, "and it stays at the ceiling, to 200 s")
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
    // At 300 s the cap has lapsed: 1_401_600 × 20 / 100 = 280_320, so 1_681_920.
    assertEquals(1_681_920, run(start, 1_000, 300_000).targetBps)
  }

  @Test
  fun `no raise within 30 s of a cut`() {
    val start = Regulation(1_000_000, lastCutAtMs = 0)
    assertEquals(1_000_000, run(start, 1_000, 29_000).targetBps)
    assertEquals(1_200_000, run(start, 1_000, 30_000).targetBps)
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
    assertEquals(1_200_000, rtmps.targetBps)
  }

  /**
   * P5 saw every SRT failure as sender drops ("SRT dropped 184,022 packets at the sender"); what it keeps
   * out of thresholds is the send buffer's value (−336), not the drops. With no value to read, drops still
   * cut, loss still marks the link failing, and nothing reads clean.
   */
  private fun assertDropsCutWithout(buffer: Int?) {
    val start = Regulation(3_000_000)
    val cut = run(start, 1_000, 1_000) { reading(buffer = buffer, dropped = 10) }
    assertEquals(1_500_000, cut.targetBps)
    assertEquals(FailedRate(3_000_000, 1_000), cut.failed)
    val drained = run(start, 1_000, 2_000) { reading(buffer = buffer, dropped = 10) }
    assertEquals(1_500_000, drained.targetBps, "draining")
    assertEquals(2_000, drained.cleanSinceMs, "drops while draining are not clean")
    assertEquals(750_000, run(start, 1_000, 3_000) { reading(buffer = buffer, dropped = 10) }.targetBps)
    val lossy = run(Regulation(1_500_000), 1_000, 1_000) { reading(buffer = buffer, lost = 5) }
    assertEquals(750_000, BitrateRegulator.afterDrop(lossy, nowMs = 5_000).targetBps)
    assertEquals(1_000, lossy.cleanSinceMs)
    val quiet = run(Regulation(1_000_000), 1_000, 11_000) { reading(buffer = buffer) }
    assertEquals(1_000_000, quiet.targetBps)
    assertNull(quiet.cleanSinceMs)
  }

  @Test
  fun `F-P5-5 sender drops cut on SRT even when the send buffer is missing`() = assertDropsCutWithout(buffer = null)

  @Test
  fun `F-P5-5 sender drops cut on SRT even when the send buffer reads negative`() = assertDropsCutWithout(buffer = -336)

  @Test
  fun `a send buffer of 0 ms is drained, not missing`() {
    assertEquals(1_200_000, run(Regulation(1_000_000), 1_000, 11_000) { reading(buffer = 0) }.targetBps)
    // B7 m4: a drained buffer is still a reading, so SRT sender drops on it cut by half: 3_000_000 → 1_500_000.
    assertEquals(1_500_000, run(Regulation(3_000_000), 1_000, 1_000) { reading(buffer = 0, dropped = 10) }.targetBps)
  }

  @Test
  fun `a cut restarts the clean interval, so egress from before it never passes a raise gate`() {
    // Clean at 4000k egress from 1 s to 9 s, then drops at 10 s cut 2000k to 1000k: the halving is
    // under the egress sizing, 4_000_000 * 80 / 115 - 128_000 = 2_654_608. Then 500k of egress every
    // 4 s. The raise is first due at 42 s, 32 s after the cut, and the interval since the cut is 8 readings
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
  fun `B7 BR-04 a halving in the same millisecond as the last healthy reading is that episode's, so a clean restart forgets it`() {
    // Loss at 1 s marks the link failing. The reading at 2 s is clean, and a far-end drop lands in the
    // same millisecond: the link failed within 10 s, so it halves 1_500_000 to 750_000. At 12.5 s the
    // failing reading is 11.5 s old, so a clean far-end drop restarts at the healthy 1_500_000 and,
    // the tie counting as this episode's, forgets the rate. Only the tie is the ruling's: a halving
    // 1 ms after the reading is this episode's under `>` too, and one 1 ms before it belongs to the
    // episode before, whose rate a clean restart keeps.
    val lossy = run(BitrateRegulator.sessionStarted(), 1_000, 1_000) { reading(lost = 5) }
    val healthy = run(lossy, 2_000, 2_000)
    val halved = BitrateRegulator.afterDrop(healthy, nowMs = 2_000)
    assertEquals(750_000, halved.targetBps)
    assertEquals(FailedRate(1_500_000, 2_000), halved.failed)
    val restarted = BitrateRegulator.afterDrop(halved, nowMs = 12_500)
    assertEquals(1_500_000, restarted.targetBps)
    assertNull(restarted.failed)
  }

  @Test
  fun `regulator restart - the healthy target follows raises`() {
    // Raised at 11 s to 1_800_000, clean at 12 s, a backlog at 13 s cuts by a quarter to 1_350_000.
    val raised = run(Regulation(1_500_000), 1_000, 12_000)
    val cut = run(raised, 13_000, 13_000) { reading(buffer = 1_000) }
    assertEquals(1_350_000, cut.targetBps)
    val restarted = BitrateRegulator.afterDrop(cut, nowMs = 14_000)
    assertEquals(1_800_000, restarted.targetBps)
    assertEquals(1_800_000, BitrateRegulator.afterDrop(restarted, nowMs = 15_000).targetBps)
  }

  @Test
  fun `with a negative send buffer, drops still cut and loss still restarts the clean wait`() {
    // Clean from 1 s at 4000k of egress. Drops at 10 s halve 1000k to the 500k floor.
    val clean = run(Regulation(1_000_000), 1_000, 9_000)
    assertEquals(500_000, run(clean, 10_000, 10_000) { reading(buffer = -336, dropped = 1) }.targetBps)
    // A raise was due at 11 s; loss at 10 s moves that to 20 s.
    val lossy = run(clean, 10_000, 10_000) { reading(buffer = -336, lost = 1) }
    assertEquals(1_000_000, run(lossy, 11_000, 19_000).targetBps)
    assertEquals(1_200_000, run(lossy, 11_000, 20_000).targetBps)
  }

  @Test
  fun `no reading at all holds the target and the clean wait`() {
    // Clean from 1 s, nothing read at 6 s, clean again to 11 s: the raise is still due at 11 s.
    val before = run(Regulation(1_000_000), 1_000, 5_000)
    val gap = BitrateRegulator.next(before, null, 6_000, Transport.SRT, latency)
    assertEquals(before, gap)
    assertEquals(1_200_000, run(gap, 7_000, 11_000).targetBps)
  }

  @Test
  fun `loss, or a send buffer over a tenth of the latency, restarts the clean wait`() {
    // 300 ms is over 2_000 / 10 and under the 1_000 ms backlog: not clean, and no cut.
    for (unclean in listOf(reading(lost = 1), reading(buffer = 300))) {
      // Clean from 1 s, so due at 11 s; the unclean reading at 11 s moves that to 21 s.
      val restarted = run(run(Regulation(1_000_000), 1_000, 10_000), 11_000, 11_000) { unclean }
      assertEquals(1_000_000, restarted.targetBps, "$unclean")
      assertEquals(1_000_000, run(restarted, 12_000, 20_000).targetBps, "$unclean")
      assertEquals(1_200_000, run(restarted, 12_000, 21_000).targetBps, "$unclean")
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
    assertEquals(1_800_000, run(quiet, 12_000, 21_000) { reading(egress = 4_000_000) }.targetBps)
  }

  @Test
  fun `F-P5-7 only the current interval's egress tests a raise`() {
    // Readings 2 s apart. 3_000_000 from 2 s tests the raise at 12 s to 1_800_000. Then 500_000 from
    // 14 s: the interval due at 22 s holds five quiet readings, under 1800k's gate of
    // (1_800_000 + 128_000) × 1.15 × 70% = 1_552_040. The last ten readings, five of them busy,
    // would average (5 × 3_000_000 + 5 × 500_000) / 10 = 1_750_000 and pass it.
    var state = Regulation(1_500_000)
    for (t in 2_000L..22_000L step 2_000) {
      state = BitrateRegulator.next(state, reading(egress = if (t <= 12_000) 3_000_000 else 500_000), t, Transport.SRT, latency)
      if (t == 12_000L) assertEquals(1_800_000, state.targetBps)
    }
    assertEquals(1_800_000, state.targetBps)
  }

  @Test
  fun `F-P5-7 raises come at most one step per 10 s`() {
    // Only a hand-built state reaches this: through next(), every raise also restarts the clean wait.
    // Clean since 1 s makes 11 s due; the raise at 5 s holds it to 15 s.
    val start = Regulation(1_000_000, lastRaiseAtMs = 5_000, cleanSinceMs = 1_000)
    assertEquals(1_000_000, run(start, 1_000, 14_000).targetBps)
    assertEquals(1_200_000, run(start, 1_000, 15_000).targetBps)
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

  // R-990P (2026-10-26): a raise is 20% of the target, never under 100k. The 20% is the controller's call.

  @Test
  fun `a raise step is 20 percent of the target, never under 100k`() {
    // 400_000 × 20 / 100 = 80_000, under the minimum. Only a hand-built call reaches it: next() brings
    // any target up to the 500k floor first, where 20% is exactly the minimum.
    assertEquals(100_000, BitrateRegulator.raiseStepBps(400_000))
    assertEquals(100_000, BitrateRegulator.raiseStepBps(500_000))
    assertEquals(120_000, BitrateRegulator.raiseStepBps(600_000))
    // 2_579_889 × 20 / 100 = 515_977.8, rounded down.
    assertEquals(515_977, BitrateRegulator.raiseStepBps(2_579_889))
  }

  @Test
  fun `at the floor a raise is 100k, and then 20 percent`() {
    // 500_000 × 20 / 100 = 100_000; 600_000 × 20 / 100 = 120_000.
    assertEquals(600_000, run(Regulation(500_000), 1_000, 11_000).targetBps)
    assertEquals(720_000, run(Regulation(600_000), 1_000, 11_000).targetBps)
  }

  @Test
  fun `a busy clean link climbs from the floor to the ceiling in 100 s`() {
    // Clean from 1 s at 4000k of egress, which passes every gate on the way (2_276_540 at 2700k). Each raise
    // restarts the 10 s wait, so raises land at 11 s, 21 s, … 101 s. Each step is 20% rounded down:
    // 500_000 + 100_000 = 600_000; + 120_000 = 720_000; + 144_000 = 864_000; + 172_800 = 1_036_800;
    // + 207_360 = 1_244_160; + 248_832 = 1_492_992; + 298_598 = 1_791_590; + 358_318 = 2_149_908;
    // + 429_981 = 2_579_889; + 515_977 = 3_095_866, capped at 3_000_000. Ten raises in 100 s, where
    // 100k a step took 25 raises, 250 s. Nothing moves after.
    val expected =
      listOf(
        11_000L to 600_000,
        21_000L to 720_000,
        31_000L to 864_000,
        41_000L to 1_036_800,
        51_000L to 1_244_160,
        61_000L to 1_492_992,
        71_000L to 1_791_590,
        81_000L to 2_149_908,
        91_000L to 2_579_889,
        101_000L to 3_000_000,
      )
    val raises = mutableListOf<Pair<Long, Int>>()
    var state = Regulation(Encode.FLOOR_BPS)
    for (t in 1_000L..200_000L step 1_000) {
      val next = BitrateRegulator.next(state, reading(), t, Transport.SRT, latency)
      if (next.targetBps != state.targetBps) raises += t to next.targetBps
      state = next
    }
    assertEquals(expected, raises)
  }

  @Test
  fun `a 20 percent step is capped by the ceiling`() {
    // 2_700_000 × 20 / 100 = 540_000 would make 3_240_000.
    assertEquals(3_000_000, run(Regulation(2_700_000), 1_000, 11_000).targetBps)
  }

  @Test
  fun `a 20 percent step is capped at 80 percent of a rate that failed`() {
    // 1_000_000 × 20 / 100 = 200_000 would make 1_200_000; 80% of 1_400_000 is 1_120_000.
    val start = Regulation(1_000_000, failed = FailedRate(1_400_000, 0))
    assertEquals(1_120_000, run(start, 1_000, 11_000).targetBps)
  }

  // R-990P (2026-10-26): the record says why the regulator moved, and when F-P5-7's gate held a due raise.

  private fun regulated(start: Regulation, sample: LinkSample, nowMs: Long = 1_000, transport: Transport = Transport.SRT) =
    BitrateRegulator.regulate(start, sample, nowMs, transport, latency)

  /** Every `bitrate-held` line due from [fromMs] to [toMs], one reading a second, with when it fell due. */
  private fun heldLines(start: Regulation, fromMs: Long, toMs: Long, sample: (Long) -> LinkSample): Pair<Regulation, List<Pair<Long, HeldRaise>>> {
    val lines = mutableListOf<Pair<Long, HeldRaise>>()
    var state = start
    for (t in fromMs..toMs step 1_000) {
      val regulated = BitrateRegulator.regulate(state, sample(t), t, Transport.SRT, latency)
      regulated.held?.let { lines += t to it }
      state = regulated.state
    }
    return state to lines
  }

  private val quiet = { _: Long -> reading(egress = 500_000) }

  @Test
  fun `the bitrate line's reason words`() {
    assertEquals(listOf("drops", "backlog", "raise", "clamp"), BitrateMove.entries.map { it.wire })
  }

  @Test
  fun `each move names the rule that made it`() {
    assertEquals(BitrateMove.DROPS, regulated(Regulation(3_000_000), reading(dropped = 10)).move)
    assertEquals(BitrateMove.BACKLOG, regulated(Regulation(3_000_000), reading(buffer = 1_000)).move)
    // Drops on a backlogged reading halve: drops.
    assertEquals(BitrateMove.DROPS, regulated(Regulation(3_000_000), reading(buffer = 1_000, dropped = 10)).move)
    // RTMPS has no send buffer, and its drops cut all the same.
    assertEquals(BitrateMove.DROPS, regulated(Regulation(2_000_000), reading(buffer = null, dropped = 3), transport = Transport.RTMPS).move)
    // SRT with no usable send buffer (P5's −336, or none at all): drops still cut, and say so.
    assertEquals(BitrateMove.DROPS, regulated(Regulation(3_000_000), reading(buffer = -336, dropped = 10)).move)
    assertEquals(BitrateMove.DROPS, regulated(Regulation(3_000_000), reading(buffer = null, dropped = 10)).move)
    // A target outside 500k to 3000k, brought inside on a reading that does nothing else.
    assertEquals(BitrateMove.CLAMP, regulated(Regulation(4_000_000), reading()).move)
    assertEquals(BitrateMove.CLAMP, regulated(Regulation(100_000), reading()).move)
    // Brought inside, then cut by a quarter, 3_000_000 → 2_250_000: the cut's word.
    assertEquals(BitrateMove.BACKLOG, regulated(Regulation(4_000_000), reading(buffer = 1_000)).move)
    val due = run(Regulation(1_000_000), 1_000, 10_000)
    assertEquals(BitrateMove.RAISE, regulated(due, reading(), nowMs = 11_000).move)
  }

  @Test
  fun `a reading that leaves the target where it was names no move`() {
    assertNull(regulated(Regulation(1_000_000), reading()).move)
    // Drops at the floor: 500_000 / 2 is under it, so the cut lands where it started.
    assertNull(regulated(Regulation(500_000), reading(dropped = 10)).move)
    // Drops inside one latency of a cut are the old rate draining.
    val cut = run(Regulation(3_000_000), 1_000, 1_000) { reading(dropped = 9) }
    assertNull(regulated(cut, reading(dropped = 9), nowMs = 2_000).move)
    assertNull(BitrateRegulator.regulate(Regulation(1_000_000), null, 1_000, Transport.SRT, latency).move)
  }

  @Test
  fun `F-P5-7 a quiet picture at the floor says the gate held, once a minute, with how many raises it held`() {
    // R-990P: 500k of egress at the 500k floor. The gate there: (500_000 + 128_000) × 115 / 100 = 722_200, × 70 / 100
    // = 505_540. A raise falls due at 11 s, 21 s, 31 s, …, each untested, each restarting the wait. The first line
    // goes at once; the next 60 s later, at 71 s, counting those due at 21 s to 71 s: 6. Then 131 s: 81 s to 131 s, 6.
    val (state, lines) = heldLines(Regulation(500_000), 1_000, 131_000, quiet)
    val held = { count: Int -> HeldRaise(500_000, 500_000, 505_540, count) }
    assertEquals(listOf(11_000L to held(1), 71_000L to held(6), 131_000L to held(6)), lines)
    assertEquals(500_000, state.targetBps)
  }

  @Test
  fun `R-990P 18 minutes held at the floor read as 18 lines, not 108`() {
    // Raises fall due every 10 s from 11 s to 1_081 s: (1_081 − 11) / 10 + 1 = 108. Lines at 11 s, 71 s, … 1_031 s:
    // 18. Their counts: 1, then 6 each, 1 + 17 × 6 = 103; the 5 due at 1_041 s to 1_081 s wait for the next line.
    val (state, lines) = heldLines(Regulation(500_000), 1_000, 1_081_000, quiet)
    assertEquals((0 until 18).map { 11_000L + it * 60_000L }, lines.map { it.first })
    assertEquals(103, lines.sumOf { it.second.count })
    assertEquals(5, state.untestedRaises)
  }

  @Test
  fun `the held line's gate is F-P5-7's raise gate`() {
    // At 1500k the gate is 1_310_540 (the gate test above): 1_310_539 is held, and the line says by how little.
    val (_, lines) = heldLines(Regulation(1_500_000), 1_000, 11_000) { reading(egress = 1_310_539) }
    assertEquals(listOf(11_000L to HeldRaise(1_500_000, 1_310_539, 1_310_540, 1)), lines)
  }

  @Test
  fun `with nothing to raise to, a quiet picture writes no held line`() {
    // At the ceiling, and at 80% of 1_500_000 failed at 0 s: 1_200_000, the target itself.
    assertEquals(emptyList(), heldLines(Regulation(3_000_000), 1_000, 80_000, quiet).second)
    val capped = Regulation(1_200_000, failed = FailedRate(1_500_000, 0))
    assertEquals(emptyList(), heldLines(capped, 1_000, 80_000, quiet).second)
  }

  @Test
  fun `a held line waits for a raise to fall due`() {
    // Clean from 1 s: nothing is due before 11 s. Cut at 0 s: nothing is due before 30 s.
    assertEquals(emptyList(), heldLines(Regulation(500_000), 1_000, 10_000, quiet).second)
    val cut = Regulation(1_000_000, lastCutAtMs = 0)
    assertEquals(listOf(30_000L), heldLines(cut, 1_000, 30_000, quiet).second.map { it.first })
  }

  @Test
  fun `a busy picture's raises write no held line`() {
    assertEquals(emptyList(), heldLines(Regulation(Encode.FLOOR_BPS), 1_000, 200_000) { reading() }.second)
  }

  @Test
  fun `readings with no egress hold a due raise, and the line says there was none to judge`() {
    // The gate at 1000k: (1_000_000 + 128_000) × 115 / 100 = 1_297_200, × 70 / 100 = 908_040.
    val (_, lines) = heldLines(Regulation(1_000_000), 1_000, 11_000) { reading(egress = null) }
    assertEquals(listOf(11_000L to HeldRaise(1_000_000, null, 908_040, 1)), lines)
  }

  @Test
  fun `a drop and a new attempt keep the minute and the count`() {
    // Held at 11 s, and said. Raises fall due again at 21 s and 31 s, inside the minute: counted, not said. A
    // far-end drop at 32 s restarts at the healthy 500k, and the next attempt's first clean reading is at 33 s, so
    // raises fall due at 43 s, 53 s, 63 s and 73 s. The minute from 11 s runs through the drop: the next line is at
    // 73 s, and counts 2 + 4 = 6. A count reset by the drop would say 4; a minute that restarted would write at 43 s.
    val (held, before) = heldLines(Regulation(500_000), 1_000, 31_000, quiet)
    assertEquals(listOf(11_000L), before.map { it.first })
    assertEquals(2, held.untestedRaises)
    val reconnected = BitrateRegulator.attemptStarted(BitrateRegulator.afterDrop(held, nowMs = 32_000))
    val (_, after) = heldLines(reconnected, 33_000, 80_000, quiet)
    assertEquals(listOf(73_000L to HeldRaise(500_000, 500_000, 505_540, 6)), after)
  }

  @Test
  fun `a raise names the interval's mean egress it passed the gate on, not the reading it fell due on`() {
    // Review of #23. Clean from 1 s at 1000k; the interval keeps its last 10 readings, 2 s to 11 s: nine of 2_000_000
    // and the 11 s reading of 4_000_000, a mean of (9 × 2_000_000 + 4_000_000) / 10 = 2_200_000. Nothing held before it.
    val due = run(Regulation(1_000_000), 1_000, 10_000) { reading(egress = 2_000_000) }
    val raise = regulated(due, reading(egress = 4_000_000), nowMs = 11_000)
    assertEquals(BitrateMove.RAISE, raise.move)
    assertEquals(Tested(2_200_000, heldBefore = 0), raise.tested)
  }

  @Test
  fun `a raise says the due raises held since the last held line, and the count starts again`() {
    // Review of #23: held at 11 s and said; held again at 21 s and 31 s, counted, unsaid (the drop test above). The
    // picture gets busy from 32 s: the wait restarted at 31 s, so the raise falls due at 41 s on the readings of 32 s to
    // 41 s, 4_000_000 each, and 500k rises by its 100k minimum step. It carries the 2 no held line said.
    val (held, _) = heldLines(Regulation(500_000), 1_000, 31_000, quiet)
    val due = run(held, 32_000, 40_000)
    val raise = regulated(due, reading(), nowMs = 41_000)
    assertEquals(BitrateMove.RAISE, raise.move)
    assertEquals(600_000, raise.state.targetBps)
    assertEquals(Tested(4_000_000, heldBefore = 2), raise.tested)
    assertEquals(0, raise.state.untestedRaises)
  }

  @Test
  fun `a cut, a clamp and a held raise name nothing tested`() {
    val cut = regulated(Regulation(3_000_000), reading(dropped = 10))
    assertEquals(BitrateMove.DROPS, cut.move)
    assertNull(cut.tested)
    val clamp = regulated(Regulation(4_000_000), reading())
    assertEquals(BitrateMove.CLAMP, clamp.move)
    assertNull(clamp.tested)
    val held = heldLines(Regulation(500_000), 1_000, 10_000, quiet).first.let { regulated(it, quiet(11_000), nowMs = 11_000) }
    assertEquals(HeldRaise(500_000, 500_000, 505_540, 1), held.held)
    assertNull(held.tested)
  }

  @Test
  fun `the held line's gate is the least egress that passes, rounded up`() {
    // Review of #23, at R-C5WC's 918_251: (918_251 + 128_000) × 115 / 100 = 1_203_188 (whole b/s), × 70 / 100 =
    // 842_231.6. A mean of 842_231 is held, and the line names 842_232, which raises; rounded down it named 842_231,
    // the mean that was held.
    val (_, lines) = heldLines(Regulation(918_251), 1_000, 11_000) { reading(egress = 842_231) }
    assertEquals(listOf(11_000L to HeldRaise(918_251, 842_231, 842_232, 1)), lines)
    val passing = run(Regulation(918_251), 1_000, 10_000) { reading(egress = 842_232) }
    assertEquals(BitrateMove.RAISE, regulated(passing, reading(egress = 842_232), nowMs = 11_000).move)
    assertEquals(842_232L, BitrateRegulator.gateBps(918_251))
  }

  @Test
  fun `a new session starts with no held raises and no minute running`() {
    val started = BitrateRegulator.sessionStarted()
    assertEquals(0, started.untestedRaises)
    assertNull(started.heldSaidAtMs)
  }
}
