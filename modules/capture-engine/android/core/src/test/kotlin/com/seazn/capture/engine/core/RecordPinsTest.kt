package com.seazn.capture.engine.core

import kotlin.test.Test
import kotlin.test.assertEquals

/**
 * N38 after a JS reload or a process death (device, 2026-11-16: a court code paired for hours sent 34 lines, and the web
 * kept none): JS's ring is seeded from the record's last [SessionRecord.LAST_LINES] lines, so the pairing's `pair` line
 * and its `broadcast-start` were gone from it. The record now pins them by `recordPins.ts`'s own rule and hands on, with
 * its tail, the ones the tail has let go of; what an open window pins is handed to [SessionRecord]'s `onKept`, for the
 * bridge to keep on disk. The made-up tag and sids belong to nothing (AGENTS §13).
 */
class RecordPinsTest {
  private val lines = mutableListOf<String>()
  private val kept = mutableListOf<List<String>>()
  private val record = recordOver(RecordPins.NONE)

  private fun recordOver(restored: RecordPins) = SessionRecord(restored, { kept += it }) { lines += it }

  private fun write(kind: String, vararg fields: Pair<String, Any?>, into: SessionRecord = record): String {
    into.append(AT, RecordEntry(kind, fields.toList()))
    return lines.last()
  }

  private fun pair(slot: Int = 0, into: SessionRecord = record) =
    write("pair", "claim" to "new", "slot" to slot, "tokenTag" to TAG, "stopped" to false, into = into)

  private fun start(sid: String = SID, into: SessionRecord = record) = write("broadcast-start", "sid" to sid, "cause" to "organiser", into = into)

  private fun beats(count: Int, into: SessionRecord = record) = repeat(count) { write("beats", "count" to it, into = into) }

  private fun pins(of: SessionRecord = record) = of.numberedTail().pins

  @Test
  fun `a pair and its broadcast-start the tail has let go of are carried with it, pair first`() {
    val pair = pair()
    val start = start()
    beats(25)
    val tail = record.numberedTail()
    assertEquals(listOf(pair, start), tail.pins)
    assertEquals(SessionRecord.LAST_LINES, tail.lines.size)
    assertEquals(lines.takeLast(SessionRecord.LAST_LINES), tail.lines, "the tail is still the last lines alone")
  }

  @Test
  fun `a pinned line still in the tail is not carried twice`() {
    pair()
    start()
    beats(3)
    assertEquals(emptyList(), pins(), "both are in the tail")
    val pair = pair()
    beats(25)
    start()
    beats(3)
    assertEquals(listOf(pair), pins(), "the start is in the tail: JS's ring pins it there")
  }

  @Test
  fun `no pair, no pins - a broadcast-start with no pair before it is never pinned (an empty input)`() {
    assertEquals(emptyList(), pins(), "a record with no line")
    start()
    beats(25)
    assertEquals(emptyList(), pins())
    assertEquals(emptyList(), kept, "nothing to keep")
  }

  /** The contract's A1 judges a uuid sid by its session; a masked one, or a word, names none. */
  @Test
  fun `a broadcast-start whose sid A1 cannot judge is never pinned`() {
    val pair = pair()
    val masked = start("sid with spaces")
    val word = start("sess_42")
    beats(25)
    assertEquals(listOf(true, false), listOf(""""sid":"***"""" in masked, """"sid":"***"""" in word), "one masked, one a plain word")
    assertEquals(listOf(pair), pins())
  }

  @Test
  fun `the latest broadcast-start of the pairing is the one pinned (a second call)`() {
    val pair = pair()
    start()
    beats(25)
    val second = start(SID_2)
    beats(25)
    assertEquals(listOf(pair, second), pins())
  }

  @Test
  fun `a second pairing replaces the first's pins, its start included`() {
    pair(slot = 0)
    start()
    beats(25)
    val second = pair(slot = 1)
    beats(25)
    assertEquals(listOf(second), pins())
  }

  /**
   * The controller's amendment to the N38 ruling (2026-10-13), as JS's ring keeps it: Send is off air only, so the pins
   * stand while the line that ended the window is still in the tail, which JS's seed then reads as the window's end.
   */
  @Test
  fun `the pins stand until the line that ended the window has left the tail, then clear`() {
    val pair = pair()
    val start = start()
    beats(25)
    write("unpaired", "reason" to "operator")
    beats(SessionRecord.LAST_LINES - 1)
    assertEquals(listOf(pair, start), pins(), "the unpaired line is the tail's first")
    beats(1)
    assertEquals(emptyList(), pins(), "after unpair the pins clear: no stale pair from a previous code")
    start(SID_2)
    beats(25)
    assertEquals(emptyList(), pins(), "a start after the window's end opens nothing")
  }

  /** A re-pair writes `unpaired` before its `pair`, and an end writes `ended` then `reset`: the first end is the end. */
  @Test
  fun `once the window has ended, a later start or a second end moves nothing`() {
    val pair = pair()
    val start = start()
    beats(25)
    write("ended", "reason" to "operator-stopped", "wasLive" to true)
    start(SID_2)
    write("reset")
    assertEquals(listOf(pair, start), pins(), "the start after the end is not the pairing's")
    beats(SessionRecord.LAST_LINES - 2)
    assertEquals(emptyList(), pins(), "the ended line has left the tail: the reset after it held nothing")
  }

  @Test
  fun `every kind that ends a window ends it, and engine-error does not`() {
    val ends = listOf("unpaired", "ended", "pair-refused", "reset", "engine-error")
    val after =
      ends.associateWith { kind ->
        val one = recordOver(RecordPins.NONE)
        pair(into = one)
        start(into = one)
        write(kind, into = one)
        beats(SessionRecord.LAST_LINES, into = one)
        pins(one).size
      }
    assertEquals(mapOf("unpaired" to 0, "ended" to 0, "pair-refused" to 0, "reset" to 0, "engine-error" to 2), after)
  }

  /**
   * Fix round 1 of P1 (the controller's ruling): a process death restores the start alone, closed, so the pair is never
   * kept. A pair alone keeps nothing, and a re-pair keeps nothing new until its own start.
   */
  @Test
  fun `what an open window pins is kept on each change - its start alone, and nothing once it ends`() {
    pair()
    beats(3)
    val start = start()
    beats(25)
    write("ended", "reason" to "operator-stopped", "wasLive" to true)
    beats(25)
    pair(slot = 1)
    beats(3)
    val second = start(SID_2)
    assertEquals(listOf(listOf(start), emptyList(), listOf(second)), kept)
  }

  /**
   * Fix round 1 of P1 (the controller's ruling): after a process death the kept start comes back CLOSED. It is carried
   * before any line, seq 0, so the upload still names the old session (A1 judges it by its sid alone), but no pair comes
   * back: the web opens an A2 window at any `pair` line in the body, and no line of the new process ends it.
   */
  @Test
  fun `a restored start is carried before any line, closed - no pair, and no later line moves it or is kept`() {
    pair()
    val start = start()
    val reborn = recordOver(RecordPins.NONE.restoring("broadcast-start", SID, IsoTime.utc(AT), start, AT))
    kept.clear()
    assertEquals(RecordTail(1, emptyList(), listOf(start)), reborn.numberedTail())
    beats(25, into = reborn)
    start(SID_2, into = reborn)
    write("unpaired", "reason" to "operator", into = reborn)
    write("ended", "reason" to "operator-stopped", "wasLive" to true, into = reborn)
    beats(SessionRecord.LAST_LINES, into = reborn)
    assertEquals(listOf(start), pins(reborn), "no window is open: a start or an end of the new process moves nothing")
    assertEquals(emptyList(), kept, "restored, not changed: nothing to write")
  }

  /** The new process re-pairs: its pair opens a fresh window, as today, and replaces the restored start. */
  @Test
  fun `a re-pair after a restore replaces the restored start, and keeps the new window's own`() {
    val start = start()
    val reborn = recordOver(RecordPins.NONE.restoring("broadcast-start", SID, IsoTime.utc(AT), start, AT))
    kept.clear()
    val again = pair(slot = 1, into = reborn)
    beats(25, into = reborn)
    assertEquals(listOf(again), pins(reborn), "the restored start is gone")
    val second = start(SID_2, into = reborn)
    beats(25, into = reborn)
    assertEquals(listOf(again, second), pins(reborn))
    assertEquals(listOf(emptyList(), listOf(second)), kept, "the re-pair deletes the restored start; its own start is kept")
  }

  /** What the last process kept, read again line by line: the latest start A1 can judge, and nothing else. */
  @Test
  fun `a restore takes the latest judgeable start of the kept lines, and nothing from any other line`() {
    val pair = pair()
    val start = start()
    val second = start(SID_2)
    val unjudged = start("sess_42")
    val pairKept = Triple("pair", null, pair)
    fun startKept(sid: String, line: String) = Triple("broadcast-start", sid, line)
    fun restore(vararg kept: Triple<String, String?, String>) =
      kept.fold(RecordPins.NONE) { pins, (kind, sid, line) -> pins.restoring(kind, sid, IsoTime.utc(AT), line, AT) }
    assertEquals(RecordPins(null, PinnedLine(0, start), null), restore(pairKept, startKept(SID, start)))
    assertEquals(
      RecordPins(null, PinnedLine(0, second), null),
      restore(startKept(SID, start), startKept(SID_2, second), startKept("sess_42", unjudged)),
    )
    assertEquals(RecordPins.NONE, restore(pairKept), "a pair alone restores nothing")
    assertEquals(RecordPins.NONE, restore(), "an empty input")
  }

  /**
   * Fix round 2 of P1: the restored start is bounded. A Send names it only under its code's upload credential, which
   * outlives the code by 24 h (R4, JS's `KEEP_AFTER_DROP_MS`), so a start written longer ago than that is not restored.
   */
  @Test
  fun `a kept start is restored up to 24 h after it was written, and not a millisecond later`() {
    pair()
    val start = start()
    val at = IsoTime.utc(AT)
    fun restoredAt(now: Long, written: Any? = at) = RecordPins.NONE.restoring("broadcast-start", SID, written, start, now)
    assertEquals(86_400_000L, RecordPins.KEEP_AFTER_DROP_MS, "R4's 24 h")
    assertEquals(RecordPins(null, PinnedLine(0, start), null), restoredAt(AT + 86_400_000), "exactly 24 h old")
    assertEquals(RecordPins.NONE, restoredAt(AT + 86_400_001), "older than 24 h")
    assertEquals(RecordPins(null, PinnedLine(0, start), null), restoredAt(AT), "written this instant")
    assertEquals(RecordPins.NONE, restoredAt(AT, written = null), "no at: its age is unknown")
    assertEquals(RecordPins.NONE, restoredAt(AT, written = "yesterday"), "an at the record never writes")
    assertEquals(RecordPins.NONE, restoredAt(AT, written = AT), "an at that is not text")
  }

  /** The sink's own rule: a throw from [SessionRecord]'s keeper is counted, never thrown, and the record goes on. */
  @Test
  fun `a keeper that throws is counted as the sink's failures are, and the line is still written`() {
    val throwing = SessionRecord(RecordPins.NONE, { throw IllegalStateException("refused") }) { lines += it }
    pair(into = throwing)
    start(into = throwing)
    beats(2, into = throwing)
    assertEquals(1, throwing.sinkFailures, "one change to keep: the start")
    assertEquals(4, lines.size)
    assertEquals(lines, throwing.lastLines())
  }

  private companion object {
    const val AT = 1_790_778_725_123L
    const val TAG = "c980ff38"
    const val SID = "5f2c8a1e-3b4d-4e6f-8a9b-0c1d2e3f4a5b"
    const val SID_2 = "0a1b2c3d-4e5f-4a6b-9c7d-8e9f0a1b2c3d"
  }
}
