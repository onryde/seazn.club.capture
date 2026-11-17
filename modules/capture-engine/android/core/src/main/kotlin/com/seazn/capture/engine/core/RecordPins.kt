package com.seazn.capture.engine.core

/** A line the record pinned, and its seq. A start restored from the last process is seq 0, before every line of this one. */
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
 *
 * After a process death the pins come back CLOSED (fix round 1 of P1, I1 of its review; the controller's ruling): they
 * name the old session and file no line of the new process. The web opens an A2 window at any `pair` line in the body
 * and runs it to a closing line or the next `pair`, and a cold start that does not re-pair writes neither, so a restored
 * pair would file every line of the new process under the dead code. So only the start is kept ([kept]) and restored
 * ([restoring]), with no pair: A1 judges it by its sid alone, and with no pair no window is open, so no later line moves
 * it until a new `pair` replaces it, as a pair always does. A pairing that never started a broadcast restores nothing:
 * its own lines died with the process, so its pair would name none of the body's. No new line kind: the web's allow-list
 * is unchanged.
 */
data class RecordPins(val pair: PinnedLine?, val start: PinnedLine?, val endedAt: Long?) {
  /** The pins once the record has written [line] as seq [seq], of [kind] and with [sid] as the line holds them. */
  fun after(kind: String, sid: Any?, seq: Long, line: String): RecordPins =
    when {
      kind == OPENS -> RecordPins(PinnedLine(seq, line), start = null, endedAt = null)
      pair == null || endedAt != null -> this
      kind in ENDS -> copy(endedAt = seq)
      names(kind, sid) -> copy(start = PinnedLine(seq, line))
      else -> this
    }

  /**
   * The pins once a new process has read back [line], one of the last process's [kept] lines, of [kind] and with [sid]:
   * a start A1 can judge, as seq 0 and closed (no pair), or these pins for any other line. Folded from [NONE] in order.
   */
  fun restoring(kind: String, sid: Any?, line: String): RecordPins =
    if (names(kind, sid)) RecordPins(pair = null, start = PinnedLine(0, line), endedAt = null) else this

  /** These pins while the window is open or the line that ended it is still in a tail from [firstSeq]; else none. */
  fun standing(firstSeq: Long): RecordPins = if (endedAt == null || endedAt >= firstSeq) this else NONE

  /** The pinned lines a tail from [firstSeq] has let go of, the pair first: what the tail carries beside its lines. */
  fun letGo(firstSeq: Long): List<String> = listOfNotNull(pair, start).filter { it.seq < firstSeq }.map { it.line }

  /** What a process death must not lose: the start of an open window or of a closed restore, never the pair; none once ended. */
  val kept: List<String>
    get() = if (endedAt == null) listOfNotNull(start).map { it.line } else emptyList()

  companion object {
    val NONE = RecordPins(null, null, null)

    /** The record contract's A2: a window opens at this kind and runs through the next of [ENDS] (`recordContract.ts`). */
    const val OPENS = "pair"
    val ENDS = setOf("unpaired", "ended", "pair-refused", "reset")

    /** The kind that names a broadcast's sid (`Starts.arm`), as JS's `START_KIND`. */
    const val START = "broadcast-start"

    /** A `broadcast-start` whose sid the contract's A1 can judge ([SID]): the one line a start pin may hold. */
    private fun names(kind: String, sid: Any?): Boolean = kind == START && sid is String && SID.matches(sid)

    /** The contract's `sid` uuid pattern, as `RECORD_SID` and `Bodies`' own: ASCII classes spelled out, matched whole. */
    val SID =
      Regex(
        "[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}" +
          "|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff"
      )
  }
}
