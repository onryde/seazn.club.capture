package com.seazn.capture.engine.adapter

import com.seazn.capture.engine.core.RecordEntry
import com.seazn.capture.engine.core.RecordPins

/**
 * N38 after a process death: what an open pairing window pins ([RecordPins.kept]), in the private store as record lines
 * are written, one a line, the pair first. They are the record's own lines, scrubbed when written, so they hold no
 * secret. Written on the scheduler thread when the pins change (a pair, a broadcast-start, the window's end, which
 * deletes them), as A17's records are; read once, as the core is built, as the Forget marker is (`PrivateStore`).
 */
internal object RecordPinStore {
  const val KEY = "record-pins"

  /**
   * The pins the last process kept, each line read again by [RecordPins]' own rule as seq 0. Never throws an `Exception`:
   * a read that fails, or a line that is not a JSON object with a kind, is no pins, reported through [problem] as every
   * other key's is (AGENTS §13, class 3).
   */
  fun read(store: PrivateStore, problem: (RecordEntry) -> Unit): RecordPins {
    val text =
      try {
        store.read(KEY)
      } catch (failure: Exception) {
        problem(RecordEntry("store-failed", listOf("op" to "read", "key" to KEY, "error" to failure.javaClass.simpleName)))
        return RecordPins.NONE
      } ?: return RecordPins.NONE
    val lines = text.lines().filter { it.isNotBlank() }.map { line -> fieldsOf(line)?.let { line to it } }
    if (lines.any { it == null }) {
      problem(RecordEntry("store-unreadable", listOf("key" to KEY)))
      return RecordPins.NONE
    }
    return lines.filterNotNull().fold(RecordPins.NONE) { pins, (line, fields) -> pins.after(fields["kind"] as String, fields["sid"], 0, line) }
  }

  /** The lines an open window pins, or none, which deletes the key. Throws when the store refuses, for `store-failed`. */
  fun save(store: PrivateStore, lines: List<String>) = if (lines.isEmpty()) store.delete(KEY) else store.write(KEY, lines.joinToString("\n"))

  /** A JSON object with a string kind, or null. */
  private fun fieldsOf(line: String): Map<*, *>? {
    val fields =
      try {
        JsonReader.parse(line) as? Map<*, *>
      } catch (_: JsonReader.Malformed) {
        null
      }
    return fields?.takeIf { it["kind"] is String }
  }
}
