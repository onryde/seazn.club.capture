package com.seazn.capture.engine.core

/** A line the record pinned, and its seq. A line restored from the last process is seq 0, before every line of this one. */
data class PinnedLine(val seq: Long, val line: String)

/**
 * N38 after a JS reload or a process death (device, 2026-11-16: a court code paired for hours sent 34 lines, and the web
 * kept none). JS's ring pins the pairing's latest `pair` line and, while its window is open, its latest `broadcast-start`
 * (`src/services/recordPins.ts`), but a ring seeded after a reload holds only the record's last [SessionRecord.LAST_LINES]
 * lines, and one in a new process none. So the record pins them too, by the same rule, rule for rule: a `pair` opens a
 * window and replaces both pins; the first of [ENDS] after it ends the window ([endedAt]); a `broadcast-start` whose sid
 * the contract's A1 can judge ([SID]) is pinned while the window is open. Only the kind and the sid are read, as written.
 *
 * The controller's amendment to the N38 ruling (2026-10-13) holds here as in JS: the pins stand until the line that ended
 * the window has left the tail ([standing]), so a seed taken just after an unpair still reads the window's end there.
 * Every `broadcast-start` is followed by its `armed` for the same sid (`Starts.arm`, `Starts.opened`), so the start names
 * the sid the `armed` would.
 */
data class RecordPins(val pair: PinnedLine?, val start: PinnedLine?, val endedAt: Long?) {
  /** The pins once the record has written [line] as seq [seq], of [kind] and with [sid] as the line holds them. */
  fun after(kind: String, sid: Any?, seq: Long, line: String): RecordPins =
    when {
      kind == OPENS -> RecordPins(PinnedLine(seq, line), start = null, endedAt = null)
      pair == null || endedAt != null -> this
      kind in ENDS -> copy(endedAt = seq)
      kind == START && sid is String && SID.matches(sid) -> copy(start = PinnedLine(seq, line))
      else -> this
    }

  /** These pins while the window is open or the line that ended it is still in a tail from [firstSeq]; else none. */
  fun standing(firstSeq: Long): RecordPins = if (endedAt == null || endedAt >= firstSeq) this else NONE

  /** The pinned lines a tail from [firstSeq] has let go of, the pair first: what the tail carries beside its lines. */
  fun letGo(firstSeq: Long): List<String> = listOfNotNull(pair, start).filter { it.seq < firstSeq }.map { it.line }

  /** What a process death must not lose: an open window's pinned lines, the pair first, or none once it has ended. */
  val kept: List<String>
    get() = if (endedAt == null) listOfNotNull(pair, start).map { it.line } else emptyList()

  companion object {
    val NONE = RecordPins(null, null, null)

    /** The record contract's A2: a window opens at this kind and runs through the next of [ENDS] (`recordContract.ts`). */
    const val OPENS = "pair"
    val ENDS = setOf("unpaired", "ended", "pair-refused", "reset")

    /** The kind that names a broadcast's sid (`Starts.arm`), as JS's `START_KIND`. */
    const val START = "broadcast-start"

    /** The contract's `sid` uuid pattern, as `RECORD_SID` and `Bodies`' own: ASCII classes spelled out, matched whole. */
    val SID =
      Regex(
        "[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}" +
          "|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff"
      )
  }
}
