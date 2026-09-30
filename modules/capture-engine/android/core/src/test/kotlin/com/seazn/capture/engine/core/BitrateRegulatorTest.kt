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
}
