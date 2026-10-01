package com.seazn.capture.engine.core

/**
 * The operator's Stop wins (A17): the sid this phone stopped, kept in native app-private storage
 * until the server has heard the stop or the broadcast cannot still be open. It holds a sid, which
 * is no secret, and no token. One per code and slot: a newer Stop on the same pair replaces it.
 */
data class StoppedRecord(val code: String, val slot: Int, val sid: String, val stoppedAtEpochMs: Long, val keepUntilEpochMs: Long) {
  fun current(nowWallMs: Long): Boolean = nowWallMs < keepUntilEpochMs

  /** Per code and slot, whatever issue of the code: a re-issued code still names the same broadcasts. */
  fun isFor(name: PairingName): Boolean = code == name.code && slot == name.slot

  companion object {
    /**
     * RR2: a Stop before the descriptor answered has no `maxDurationMinutes`. Twelve hours is longer
     * than any match broadcast we expect, so the record cannot lapse while the broadcast might be
     * open, and short enough that a stale record ignores one dead sid for an afternoon at most.
     */
    const val DEFAULT_KEEP_MS = 12 * 60 * 60 * 1_000L

    fun of(name: PairingName, sid: String, nowWallMs: Long, maxDurationMinutes: Int?): StoppedRecord {
      val keepMs = maxDurationMinutes?.let { it * 60_000L } ?: DEFAULT_KEEP_MS
      return StoppedRecord(name.code, name.slot, sid, nowWallMs, nowWallMs + keepMs)
    }

    /** At startup: a record past `keepUntil` names a broadcast that cannot still be open. */
    fun pruned(records: List<StoppedRecord>, nowWallMs: Long): List<StoppedRecord> = records.filter { it.current(nowWallMs) }

    /**
     * Whether a beat that carried the record delivered it: a 2xx or a 410 (A17), and a `replaced` or
     * `taken` answer, which the server sends having read the beat (2026-10-01). A 404, 429, 5xx or
     * no answer keeps it.
     */
    fun delivered(status: Int?, word: ServerWord): Boolean =
      status != null && (status in 200..299 || status == 410 || word == ServerWord.Replaced || word == ServerWord.Taken)
  }
}
