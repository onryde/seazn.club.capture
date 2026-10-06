package com.seazn.capture.engine

import java.io.File
import java.io.IOException
import java.util.concurrent.Executors

/** The record on disk, for Share after a crash (CD7). Its own thread: the record's IO stays off the scheduler thread (CD9; A17's store is the one exception). */
class RecordFile(private val dir: File) {
  private val io = Executors.newSingleThreadExecutor { task -> Thread(task, "capture-record") }

  /** Lines the disk refused, counted and never thrown. Written on the record thread only. */
  @Volatile
  var failures = 0
    private set

  fun append(line: String) {
    io.execute { write(line) }
  }

  private fun write(line: String) {
    try {
      dir.mkdirs()
      val file = File(dir, NAME)
      if (file.length() >= MAX_BYTES) file.renameTo(File(dir, ROTATED)) // replaces the old rotation
      file.appendText(line + "\n")
    } catch (e: IOException) {
      failures += 1
    }
  }

  companion object {
    const val NAME = "session-record.ndjson"
    const val ROTATED = "session-record.1.ndjson"
    const val MAX_BYTES = 5L * 1024 * 1024
  }
}
