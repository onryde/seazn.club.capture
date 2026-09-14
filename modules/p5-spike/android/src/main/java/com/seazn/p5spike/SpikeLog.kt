package com.seazn.p5spike

import android.content.Context
import java.io.File

/** One row per sample or event, flushed on every write so a crash loses nothing. */
class SpikeLog(context: Context) {
  val file: File = File(context.getExternalFilesDir(null), "p5-${System.currentTimeMillis()}.csv")
  private val writer = file.bufferedWriter()

  init {
    write(row(COLUMNS))
  }

  @Synchronized
  fun sample(values: Map<String, Any?>) {
    write(row(sampleCells(System.currentTimeMillis(), values)))
  }

  @Synchronized
  fun event(kind: String, detail: String) {
    write(row(eventCells(System.currentTimeMillis(), kind, detail)))
  }

  private fun write(line: String) {
    writer.write(line)
    writer.newLine()
    writer.flush()
  }

  companion object {
    /**
     * One column per key; an empty cell is a missing reading, never a zero.
     * `videoBitrate` is *measured* throughput in bits per second: the delta of the
     * endpoint's cumulative bytes written over the real tick interval. It counts
     * everything the endpoint sends (audio, container overhead, and for SRT
     * retransmissions), and is 0 when not streaming. It is not the encoder target.
     */
    val SAMPLE_KEYS = listOf(
      "thermalStatus", "thermalHeadroom", "batteryPercent", "batteryTempC", "charging",
      "currentMicroAmps", "network", "screenOn", "streaming", "transport", "videoBitrate",
    )

    /**
     * F-P5-4's witnesses, placed after `detail` rather than before it: analysis one-liners read
     * columns 1–14 by position ($9 network … $13 videoBitrate, $14 detail), and a column inserted
     * ahead of `detail` would have moved it with nothing failing. Appending is safe only because
     * [row] strips commas from every cell, `detail` included, so `detail` can never spill into these.
     *
     * Frame counts are cumulative encoded frames handed to the endpoint ([FrameCounts]). The SRT
     * columns are StreamPack's cumulative per-socket counters, then srtdroid's instantaneous
     * readings; all blank unless a connected SRT socket answered, so an RTMPS row or a dead socket
     * never reads as a clean zero.
     */
    val DELIVERY_KEYS = listOf(
      "videoFrames", "audioFrames",
      "srtPacketsWritten", "srtPacketsRetransmitted", "srtPacketsWriteLost", "srtPacketsWriteDropped",
      "srtRttMs", "srtSndBufMs", "srtFlightSizePkts", "srtBandwidthMbps",
    )

    val COLUMNS: List<String> = listOf("epochMs", "kind") + SAMPLE_KEYS + "detail" + DELIVERY_KEYS

    fun sampleCells(atMs: Long, values: Map<String, Any?>): List<Any?> =
      listOf<Any?>(atMs, "sample") + SAMPLE_KEYS.map { values[it] } + "" + DELIVERY_KEYS.map { values[it] }

    fun eventCells(atMs: Long, kind: String, detail: String): List<Any?> =
      listOf<Any?>(atMs, kind) + SAMPLE_KEYS.map { null } + detail + DELIVERY_KEYS.map { null }

    /**
     * The only escaping in the file, and every cell passes through it — header, kind, detail,
     * values — so no value can add a column or break a row. On the values written before this
     * existed it changes nothing: numbers, booleans and fixed words contain neither.
     */
    fun row(cells: List<Any?>): String = cells.joinToString(",") { cell(it) }

    private fun cell(value: Any?): String =
      (value ?: "").toString().replace(',', ';').replace('\n', ' ').replace('\r', ' ')
  }
}
