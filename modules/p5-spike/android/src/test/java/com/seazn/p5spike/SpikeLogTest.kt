package com.seazn.p5spike

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Test

class SpikeLogTest {
  /**
   * Analysis one-liners and `scripts/p5/telemetry.ts` read these by position. Columns 1–14 are
   * the ones that existed before F-P5-4; the delivery columns may only ever be appended.
   */
  @Test
  fun `columns keep their positions, with delivery appended after detail`() {
    assertEquals(
      listOf(
        "epochMs", "kind", "thermalStatus", "thermalHeadroom", "batteryPercent", "batteryTempC",
        "charging", "currentMicroAmps", "network", "screenOn", "streaming", "transport",
        "videoBitrate", "detail",
        "videoFrames", "audioFrames", "srtPacketsWritten", "srtPacketsRetransmitted",
        "srtPacketsWriteLost", "srtPacketsWriteDropped", "srtRttMs", "srtSndBufMs",
        "srtFlightSizePkts", "srtBandwidthMbps",
      ),
      SpikeLog.COLUMNS,
    )
  }

  @Test
  fun `a comma or a line break in any cell cannot add a column or a row`() {
    val line = SpikeLog.row(SpikeLog.eventCells(1L, "previous-exit", "description=a, b\nc\rd"))

    assertEquals(SpikeLog.COLUMNS.size, line.split(",").size)
    assertFalse(line.contains('\n') || line.contains('\r'))
    assertEquals("description=a; b c d", line.split(",")[SpikeLog.COLUMNS.indexOf("detail")])
  }

  @Test
  fun `a sample lands every value under its own header, and a missing one is blank`() {
    val values = mapOf<String, Any?>(
      "network" to "cellular",
      "videoBitrate" to 3_200_000L,
      "videoFrames" to 900L,
      "srtRttMs" to 48.5,
      "srtPacketsWriteDropped" to null,
    )
    val cells = SpikeLog.row(SpikeLog.sampleCells(7L, values)).split(",")
    val at = { column: String -> cells[SpikeLog.COLUMNS.indexOf(column)] }

    assertEquals(SpikeLog.COLUMNS.size, cells.size)
    assertEquals("cellular", at("network"))
    assertEquals("3200000", at("videoBitrate"))
    assertEquals("", at("detail"))
    assertEquals("900", at("videoFrames"))
    assertEquals("48.5", at("srtRttMs"))
    assertEquals("", at("srtPacketsWriteDropped"))
    assertEquals("", at("audioFrames"))
  }
}
