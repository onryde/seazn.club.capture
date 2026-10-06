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

    /**
     * [maxDurationMinutes] of zero or less is read as none: a record kept until its own stop is never
     * current, and the operator's Stop would be lost without a word (review C0a, M2).
     */
    fun of(name: PairingName, sid: String, nowWallMs: Long, maxDurationMinutes: Int?): StoppedRecord {
      val keepMs = maxDurationMinutes?.takeIf { it > 0 }?.let { it * 60_000L } ?: DEFAULT_KEEP_MS
      return StoppedRecord(name.code, name.slot, sid, nowWallMs, nowWallMs + keepMs)
    }

    /** At startup: a record past `keepUntil` names a broadcast that cannot still be open. */
    fun pruned(records: List<StoppedRecord>, nowWallMs: Long): List<StoppedRecord> = records.filter { it.current(nowWallMs) }

    /**
     * Whether a beat that carried the record delivered it, by [status] alone: a 2xx or a 410 (A17). A
     * `replaced` or `taken` answer is a 200, sent having read the beat (G0-g), so it delivers it too. A
     * 404, 429, 5xx or no answer keeps it: a null [status] is in no range and equals no code.
     */
    fun delivered(status: Int?): Boolean = status in 200..299 || status == 410
  }
}
