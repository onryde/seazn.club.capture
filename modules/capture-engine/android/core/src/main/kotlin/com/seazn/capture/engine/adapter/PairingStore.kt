package com.seazn.capture.engine.adapter

import com.seazn.capture.engine.core.Json
import com.seazn.capture.engine.core.PairingName
import com.seazn.capture.engine.core.PhoneFacts
import com.seazn.capture.engine.core.RecordEntry
import com.seazn.capture.engine.core.StoppedRecord
import com.seazn.capture.engine.core.characters

/**
 * The install's phone id and the A17 records. The id is random, made once and kept, not derived from
 * hardware, and not a secret. Records are one JSON object per line. Nothing here throws an
 * `Exception`: every intent reads the id, and a throw would lose the operator's Stop with it (review
 * 11, gap 1). A file no rule can read, a read that fails and a write that is refused are each
 * reported through [problem], never a silent loss (AGENTS §13, class 3); `write` and `delete` alone
 * throw, for [BridgeCore]'s `store-failed` line. An `Error` is the scheduler guard's.
 */
class PairingStore(
  private val store: PrivateStore,
  private val newId: () -> String,
  private val problem: (RecordEntry) -> Unit,
) {
  /**
   * G2: a kept id outside `capture-beat.v1`'s `phone` bounds is made again, or every pair would be
   * refused for good. A read that fails makes an id for this run alone and leaves the kept one, which
   * the next run may read; a refused write still gives this run its id.
   */
  fun phone(appVersion: String, model: String): PhoneFacts {
    val kept = attempt("read", PHONE_ID) { store.read(PHONE_ID) } ?: return PhoneFacts(newId(), appVersion, model)
    val trimmed = kept.getOrNull()?.trim()?.takeIf { it.isNotEmpty() }
    val valid = trimmed?.takeIf { it.characters in PHONE_ID_CHARACTERS }
    if (trimmed != null && valid == null) problem(RecordEntry("store-unreadable", listOf("key" to PHONE_ID)))
    val id = valid ?: newId().also { made -> attempt("write", PHONE_ID) { store.write(PHONE_ID, made) } }
    return PhoneFacts(id, appVersion, model)
  }

  /** This code and slot's current record, pruning the rest past `keepUntil` (RR2). Never throws an `Exception`. */
  fun stopped(name: PairingName, nowWallMs: Long): StoppedRecord? {
    val all = attempt("read", STOPPED) { records() }?.getOrNull() ?: return null
    val kept = StoppedRecord.pruned(all, nowWallMs)
    if (kept.size != all.size) attempt("prune", STOPPED) { save(kept) }
    return kept.lastOrNull { it.isFor(name) }
  }

  /** A newer record for the same code and slot replaces the older. Throws when the store refuses. */
  fun write(record: StoppedRecord) = save(records().filterNot { it.code == record.code && it.slot == record.slot } + record)

  /** Throws when the store refuses. */
  fun delete(code: String, slot: Int) = save(records().filterNot { it.code == code && it.slot == slot })

  /** R6 of the D3 findings design: the Forget marker. Throws when the store refuses, for BridgeCore's `store-failed` line. */
  fun writeForgotten(name: PairingName) = store.write(FORGOTTEN, Json.obj(listOf("code" to name.code, "slot" to name.slot, "tokenTag" to name.tokenTag)))

  /** The next pair's: the marker has been heard, or a new pairing replaces it. Throws when the store refuses. */
  fun clearForgotten() = store.delete(FORGOTTEN)

  /** [action]'s value, as a [Result] that holds a null value too; or null, reported, when it threw. */
  private fun <T> attempt(op: String, key: String, action: () -> T): Result<T>? =
    try {
      Result.success(action())
    } catch (failure: Exception) {
      problem(RecordEntry("store-failed", listOf("op" to op, "key" to key, "error" to failure.javaClass.simpleName)))
      null
    }

  private fun records(): List<StoppedRecord> =
    store.read(STOPPED).orEmpty().lines().filter { it.isNotBlank() }.mapNotNull { line ->
      parse(line) ?: null.also { problem(RecordEntry("store-unreadable", listOf("key" to STOPPED))) }
    }

  private fun parse(line: String): StoppedRecord? {
    val map =
      try {
        JsonReader.parse(line) as? Map<*, *>
      } catch (_: JsonReader.Malformed) {
        null
      } ?: return null
    return StoppedRecord(
      map["code"] as? String ?: return null,
      WireValues.int(map["slot"]) ?: return null,
      map["sid"] as? String ?: return null,
      whole(map["stoppedAt"]) ?: return null,
      whole(map["keepUntil"]) ?: return null,
    )
  }

  /** Epoch milliseconds, as JSON wrote them: a whole number a Long holds exactly. */
  private fun whole(value: Any?): Long? = (value as? Double)?.let { d -> d.toLong().takeIf { it.toDouble() == d } }

  private fun save(records: List<StoppedRecord>) {
    if (records.isEmpty()) return store.delete(STOPPED)
    store.write(STOPPED, records.joinToString("\n") { line(it) })
  }

  private fun line(record: StoppedRecord): String =
    Json.obj(listOf("code" to record.code, "slot" to record.slot, "sid" to record.sid, "stoppedAt" to record.stoppedAtEpochMs, "keepUntil" to record.keepUntilEpochMs))

  companion object {
    const val PHONE_ID = "phone-id"
    const val STOPPED = "stopped-records"

    /** R6 of the D3 findings design: the pairing the notification's Forget left, until the next pair. */
    const val FORGOTTEN = "forgotten-pairing"

    /**
     * R6: the pairing the notification's Forget left, read once as the core is built, before the engine exists: on the
     * thread that builds it, before the scheduler runs any task, so no scheduler-thread write can race it. Never throws
     * an `Exception`: a read that fails, or a marker no rule can read, is no marker, and is reported through [problem]
     * as every other key's is (AGENTS §13, class 3), for the bridge to log once the engine exists.
     */
    fun readForgotten(store: PrivateStore, problem: (RecordEntry) -> Unit): PairingName? {
      val text =
        try {
          store.read(FORGOTTEN)
        } catch (failure: Exception) {
          problem(RecordEntry("store-failed", listOf("op" to "read", "key" to FORGOTTEN, "error" to failure.javaClass.simpleName)))
          return null
        } ?: return null
      return named(text) ?: null.also { problem(RecordEntry("store-unreadable", listOf("key" to FORGOTTEN))) }
    }

    private fun named(text: String): PairingName? {
      val map =
        try {
          JsonReader.parse(text) as? Map<*, *>
        } catch (_: JsonReader.Malformed) {
          null
        } ?: return null
      val code = map["code"] as? String ?: return null
      val slot = WireValues.int(map["slot"]) ?: return null
      val tag = map["tokenTag"] as? String ?: return null
      return PairingName(code, slot, tag)
    }

    /** `capture-beat.v1`'s `phone`, which [PhoneFacts.problems] holds every pair to: 16 to 64 characters. */
    val PHONE_ID_CHARACTERS = 16..64
  }
}
