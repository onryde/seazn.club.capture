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

  @Test
  fun `what an open window pins is kept on each change, and nothing once it ends`() {
    val pair = pair()
    beats(3)
    val start = start()
    beats(25)
    write("ended", "reason" to "operator-stopped", "wasLive" to true)
    beats(25)
    val second = pair(slot = 1)
    assertEquals(listOf(listOf(pair), listOf(pair, start), emptyList(), listOf(second)), kept)
  }

  /** After a process death: the kept lines are restored, seq 0, before every line of the new process. */
  @Test
  fun `a record restored with an open window carries its pins before any line, and keeps nothing until they change`() {
    val pair = pair()
    val start = start()
    val restored = RecordPins.NONE.after("pair", null, 0, pair).after("broadcast-start", SID, 0, start)
    kept.clear()
    val reborn = recordOver(restored)
    assertEquals(RecordTail(1, emptyList(), listOf(pair, start)), reborn.numberedTail())
    beats(25, into = reborn)
    assertEquals(listOf(pair, start), pins(reborn))
    assertEquals(emptyList(), kept, "restored, not changed: nothing to write")
    val again = pair(slot = 1, into = reborn)
    assertEquals(emptyList(), pins(reborn), "the re-pair is in the tail")
    assertEquals(listOf(listOf(again)), kept)
  }

  private companion object {
    const val AT = 1_790_778_725_123L
    const val TAG = "c980ff38"
    const val SID = "5f2c8a1e-3b4d-4e6f-8a9b-0c1d2e3f4a5b"
    const val SID_2 = "0a1b2c3d-4e5f-4a6b-9c7d-8e9f0a1b2c3d"
  }
}
