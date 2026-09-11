package com.seazn.p5spike

import android.content.Context
import java.io.File

/** One row per sample or event, flushed on every write so a crash loses nothing. */
class SpikeLog(context: Context) {
  val file: File = File(context.getExternalFilesDir(null), "p5-${System.currentTimeMillis()}.csv")
  private val writer = file.bufferedWriter()

  init {
    write((listOf("epochMs", "kind") + SAMPLE_KEYS + "detail").joinToString(","))
  }

  @Synchronized
  fun sample(values: Map<String, Any?>) {
    write((listOf(System.currentTimeMillis(), "sample") + SAMPLE_KEYS.map { values[it] ?: "" } + "").joinToString(","))
  }

  @Synchronized
  fun event(kind: String, detail: String) {
    write((listOf(System.currentTimeMillis(), kind) + SAMPLE_KEYS.map { "" } + detail.replace(',', ';')).joinToString(","))
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
  }
}
