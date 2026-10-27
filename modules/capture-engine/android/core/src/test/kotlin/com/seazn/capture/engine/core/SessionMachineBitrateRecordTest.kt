package com.seazn.capture.engine.core

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/**
 * R-990P (stg, 2026-10-26): the regulator held the 500k floor for 18 min, and the record could not say why it cut
 * or why it held. Each `bitrate` line now names its rule and the reading behind it, and F-P5-7's gate holding a due
 * raise writes `bitrate-held`, at most once a minute while on air. Every number is worked by hand.
 */
class SessionMachineBitrateRecordTest {
  private val list = Shared.read("scrub/allow-list.json")

  /** [bps] of egress on a clean link, read once a second: 4 Mbps by default. */
  private fun steady(bps: Long = 4_000_000, buffer: Int? = 50): (Long) -> LinkCounters {
    var bytes = 0L
    return { t ->
      bytes += bps / 8
      LinkCounters(bytes, t, 0, 0, 0, 20, buffer, null)
    }
  }

  private fun RecordEntry.word(key: String): String? = (field(key) as Wire?)?.wire

  @Test
  fun `a cut on sender drops says drops, with the reading behind it`() {
    // Carry 13's reading: 250_000 bytes in the 1_000 ms since the connect is 2_000_000 b/s, and 3 drops halve 1500k.
    val rig = MachineRig().live()
    rig.send(Input.Link(1, LinkCounters(250_000, 400, 0, 3, 0, 20, 40, null)))
    val line = rig.records("bitrate").single()
    val reading = listOf("egressBps" to 2_000_000L, "dropped" to 3L, "lost" to 0L, "sendBufferMs" to 40, "bandwidthBps" to null)
    assertEquals(listOf("from" to 1_500_000, "to" to 750_000, "reason" to BitrateMove.DROPS) + reading, line.fields)
    assertEquals("drops", line.word("reason"))
  }

  @Test
  fun `a cut on a backlog says backlog, with SRT's estimate`() {
    // 1_200 ms of send buffer is over half of SRT's 2_000 ms latency: a quarter off, 1_125_000. The estimate would
    // size it to 5_000_000 × 80% − 128_000 = 3_872_000, above that.
    val rig = MachineRig().live()
    rig.send(Input.Link(1, LinkCounters(250_000, 400, 0, 0, 0, 20, 1_200, 5_000_000)))
    val line = rig.records("bitrate").single()
    val reading = listOf("egressBps" to 2_000_000L, "dropped" to 0L, "lost" to 0L, "sendBufferMs" to 1_200, "bandwidthBps" to 5_000_000L)
    assertEquals(listOf("from" to 1_500_000, "to" to 1_125_000, "reason" to BitrateMove.BACKLOG) + reading, line.fields)
    assertEquals("backlog", line.word("reason"))
  }

  @Test
  fun `a raise says raise, with the reading it fell due on, its interval's mean egress and no held raises`() {
    // Steady 4 Mbps: the interval's mean is the reading's, 4_000_000, and nothing was held before it (count 0).
    // 4 Mbps clean: the raise at 11 s is 20% of 1_500_000, 300_000.
    val rig = MachineRig()
    rig.link = steady()
    rig.live()
    rig.advance(12_000)
    val line = rig.records("bitrate").single()
    val reading = listOf("egressBps" to 4_000_000L, "dropped" to 0L, "lost" to 0L, "sendBufferMs" to 50, "bandwidthBps" to null)
    assertEquals(listOf("from" to 1_500_000, "to" to 1_800_000, "reason" to BitrateMove.RAISE) + reading + ("count" to 0), line.fields)
    assertEquals("raise", line.word("reason"))
  }

  @Test
  fun `a raise's line carries the interval's mean egress and the raises held before it, and a cut's carries neither`() {
    // Review of #23. 2 Mbps clean, then 4 Mbps on the reading the raise falls due on: the line's egressBps is the
    // interval's mean, not 4_000_000. The rig's own regulator decides the mean; this pins the line to it, and the
    // regulator's test pins the mean by hand.
    val rig = MachineRig()
    var bytes = 0L
    rig.link = { t ->
      bytes += if (t >= 11_000) 500_000 else 250_000
      LinkCounters(bytes, t, 0, 0, 0, 20, 50, null)
    }
    rig.live()
    rig.advance(12_000)
    val line = rig.records("bitrate").single()
    assertEquals(BitrateMove.RAISE, line.field("reason"))
    val egress = line.field("egressBps") as Long
    assertEquals(2_200_000L, egress, "the mean of nine 2 Mbps readings and one of 4 Mbps, (9 × 2_000_000 + 4_000_000) / 10")
    assertEquals(0, line.field("count"))
    rig.send(Input.Link(1, LinkCounters(bytes + 250_000, 13_000, 0, 3, 0, 20, 40, null)))
    assertTrue(rig.records("bitrate").last().fields.none { it.first == "count" }, "a cut names no held raises")
  }

  @Test
  fun `on RTMPS a cut says drops, with no send buffer and no estimate`() {
    val rig = MachineRig(descriptor = Configs.descriptor(primary = Configs.rtmps, fallback = Configs.srt)).live()
    rig.send(Input.Link(1, LinkCounters(250_000, 400, 0, 3, 0, null, null, null)))
    val line = rig.records("bitrate").single()
    val reading = listOf("egressBps" to 2_000_000L, "dropped" to 3L, "lost" to 0L, "sendBufferMs" to null, "bandwidthBps" to null)
    assertEquals(listOf("from" to 1_500_000, "to" to 750_000, "reason" to BitrateMove.DROPS) + reading, line.fields)
  }

  @Test
  fun `a quiet picture writes bitrate-held once a minute on air, with the encoded frame rate`() {
    // 500_000 b/s is under 1500k's gate: (1_500_000 + 128_000) × 115 / 100 = 1_872_200, × 70 / 100 = 1_310_540. The
    // rig encodes 15 frames every 500 ms: 30 a second. A raise falls due 10 s after the first clean reading, and
    // every 10 s after: the first line counts 1, the next, a minute later, 6. 80 s holds two.
    val rig = MachineRig()
    rig.link = steady(bps = 500_000)
    rig.live()
    rig.advance(80_000)
    val lines = rig.records("bitrate-held")
    val held = listOf("target" to 1_500_000, "egressBps" to 500_000L, "gateBps" to 1_310_540L)
    assertEquals(listOf(held + ("count" to 1) + ("videoFps" to 30.0), held + ("count" to 6) + ("videoFps" to 30.0)), lines.map { it.fields })
    assertTrue(rig.records("bitrate").isEmpty(), "nothing moved: ${rig.records("bitrate")}")
  }

  @Test
  fun `off air a link reading writes no held line`() {
    val rig = MachineRig()
    rig.link = steady(bps = 500_000)
    rig.live()
    rig.advance(15_000)
    assertEquals(1, rig.records("bitrate-held").size, "held once on air")
    rig.send(Input.Dropped(1, DropReason.ENDPOINT_CLOSED, null))
    // Off air, the attempt's readings are no one's: a minute and more of them changes nothing.
    var bytes = 1_000_000L
    for (step in 1..70) {
      rig.at(rig.mono + 1_000)
      bytes += 62_500
      rig.send(Input.Link(1, LinkCounters(bytes, step.toLong(), 0, 0, 0, 20, 50, null)))
    }
    assertEquals(1, rig.records("bitrate-held").size)
  }

  /** 500 kb/s at 1500k, under its gate of 1_310_540, until [busyFromMs], then 4 Mbps. */
  private fun quietThenBusy(busyFromMs: Long): (Long) -> LinkCounters {
    var bytes = 0L
    return { t ->
      bytes += if (t >= busyFromMs) 500_000 else 62_500
      LinkCounters(bytes, t, 0, 0, 0, 20, 50, null)
    }
  }

  @Test
  fun `a raise after held raises names how many no held line said`() {
    // Review of #23. Quiet at 1500k: a raise falls due and is held at 11 s (said, count 1), 21 s and 31 s (counted,
    // unsaid). Busy from 32 s: the wait restarted at 31 s, so the raise falls due at 41 s on ten 4 Mbps readings, and
    // 1500k rises by 20% to 1800k. Its line carries the 2 no held line said.
    val rig = MachineRig()
    rig.link = quietThenBusy(busyFromMs = 32_000)
    rig.live()
    rig.advance(42_000)
    assertEquals(listOf(1), rig.records("bitrate-held").map { it.field("count") })
    val line = rig.records("bitrate").single()
    assertEquals(BitrateMove.RAISE, line.field("reason"))
    assertEquals(1_800_000, line.field("to"))
    assertEquals(4_000_000L, line.field("egressBps"))
    assertEquals(2, line.field("count"))
  }

  @Test
  fun `the bitrate and bitrate-held lines are the allow-list's, each key plain or a scalar`() {
    val cut = MachineRig().live()
    cut.send(Input.Link(1, LinkCounters(250_000, 400, 0, 3, 0, 20, 40, null)))
    // The raise line is the only bitrate line with `count`.
    val raised = MachineRig()
    raised.link = quietThenBusy(busyFromMs = 32_000)
    raised.live()
    raised.advance(42_000)
    val lines = cut.records("bitrate") + raised.records("bitrate") + raised.records("bitrate-held")
    assertEquals(listOf("bitrate", "bitrate", "bitrate-held"), lines.map { it.kind })
    assertTrue(lines[1].fields.any { it.first == "count" }, "the raise line carries count: ${lines[1]}")
    val kinds = list.getJSONObject("kinds").keySet()
    val plain = list.getJSONArray("plain").let { a -> (0 until a.length()).map { a.getString(it) }.toSet() }
    val scalars = list.getJSONObject("scalars").keySet()
    val undecided =
      lines.flatMap { line ->
        listOfNotNull(line.kind.takeUnless { it in kinds }?.let { "kind $it" }) +
          line.fields.map { it.first }.filterNot { it in plain || it in scalars }.map { "${line.kind}.$it" }
      }
    assertEquals(emptyList(), undecided)
    // A word under `reason` passes only on the plain list; the scalars carry numbers or null.
    assertTrue("reason" in plain)
  }
}
