package com.seazn.capture.engine.adapter

import com.seazn.capture.engine.core.RecordEntry
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

/** CD33: the two lines the device checks read for deep sleep (carry 14) and a preview resize (Open 11). */
class LatenessTest {
  @Test
  fun `carry 14 ticks more than 1000 ms apart while the wake lock is held are recorded with the gap`() {
    val ticks = TickLateness()
    assertNull(ticks.observe(0, wakeHeld = true), "the first tick has nothing to be late against")
    assertNull(ticks.observe(500, true))
    assertNull(ticks.observe(1_500, true), "exactly 1000 ms is not late")
    // 1 500 → 4 000: a 2 500 ms gap, the shape of a phone that slept.
    assertEquals(RecordEntry("tick-late", listOf("gapMs" to 2_500L)), ticks.observe(4_000, true))
  }

  @Test
  fun `without a pairing a slow tick is harmless, and the next pairing starts a fresh baseline`() {
    val ticks = TickLateness()
    ticks.observe(0, wakeHeld = false)
    assertNull(ticks.observe(60_000, wakeHeld = false), "deep sleep with no pairing is allowed (CD10)")
    assertNull(ticks.observe(120_000, wakeHeld = true), "the first tick of a pairing is its baseline, however long the sleep before it")
    assertNull(ticks.observe(120_500, true))
  }

  @Test
  fun `the tick on which the wake lock is let go is never late, and the next hold starts fresh`() {
    val ticks = TickLateness()
    assertNull(ticks.observe(0, wakeHeld = true))
    // 0 → 5 000 with the lock let go in between: the lock no longer holds, so no line.
    assertNull(ticks.observe(5_000, wakeHeld = false))
    assertNull(ticks.observe(5_500, wakeHeld = true), "a baseline again")
    // 5 500 → 7 000: 1 500 ms with the lock held is late.
    assertEquals(RecordEntry("tick-late", listOf("gapMs" to 1_500L)), ticks.observe(7_000, true))
  }

  @Test
  fun `Open 11 video that stops moving while publishing is one gap, recorded with its length when it moves again`() {
    val gaps = FrameGaps()
    assertNull(gaps.read(attemptId = 3, video = 0, monoMs = 0, publishing = true))
    assertNull(gaps.read(3, 15, 500, true))
    assertNull(gaps.read(3, 15, 1_000, true), "still stalled: nothing yet")
    assertNull(gaps.read(3, 15, 1_500, true))
    // Last moved at 500, moved again at 2 000: a 1 500 ms gap, written once.
    assertEquals(RecordEntry("frames-gap", listOf("attempt" to 3, "gapMs" to 1_500L, "suppressed" to 0)), gaps.read(3, 20, 2_000, true))
    assertNull(gaps.read(3, 35, 2_500, true))
  }

  @Test
  fun `exactly 500 ms between moves is not a gap, and nothing counts while not publishing or across attempts`() {
    val gaps = FrameGaps()
    gaps.read(3, 10, 0, true)
    assertNull(gaps.read(3, 11, 500, true), "moved again after exactly 500 ms is not more than 500 ms")
    assertNull(gaps.read(3, 11, 9_000, publishing = false), "a stall while not publishing is the machine's business, not a gap")
    assertNull(gaps.read(3, 12, 9_500, true), "publishing again starts a fresh baseline")
    assertNull(gaps.read(4, 0, 20_000, true), "a new attempt starts a fresh baseline")
    assertNull(gaps.read(4, 1, 20_500, true))
  }

  @Test
  fun `a baseline forgets an unmoved read before it - publishing resumed, or a new attempt`() {
    val gaps = FrameGaps()
    gaps.read(3, 10, 0, true)
    assertNull(gaps.read(3, 10, 500, true), "unmoved while publishing, then publishing stops")
    gaps.read(3, 10, 1_000, publishing = false)
    // Unmoved before the stop and while stopped: the machine's business, never half of a gap. Publishing again begins here.
    assertNull(gaps.read(3, 11, 9_000, true))
    assertNull(gaps.read(3, 12, 9_600, true), "moved 600 ms after the baseline, no read unmoved since it")
    assertNull(gaps.read(3, 12, 10_100, true))
    // From the last move at 9 600, unmoved at 10 100, moved again at 10 700: a 1 100 ms gap.
    assertEquals(RecordEntry("frames-gap", listOf("attempt" to 3, "gapMs" to 1_100L, "suppressed" to 0)), gaps.read(3, 13, 10_700, true))
    assertNull(gaps.read(3, 13, 11_200, true), "unmoved, then a new attempt")
    assertNull(gaps.read(4, 0, 11_700, true), "the new attempt's baseline")
    assertNull(gaps.read(4, 9, 12_300, true), "moved 600 ms after it, no read unmoved since it")
  }

  /**
   * Session 7, F-S7-3: 390 `frames-gap` lines in 270 s, 384 of them 501–520 ms. The Frames poller reads
   * [AttemptPollers.FRAMES_MS] after its last read ENDED, so reads land a little more than that apart, and the
   * rule "moved more than [FrameGaps.GAP_MS] after the last move" wrote the poll's own lateness as a gap. A gap
   * is a read that saw the count unmoved: video moving at every read is none, however late the reads land.
   */
  @Test
  fun `F-S7-3 reads late by the poller's own delay, with video moving at each, are no gap, and one unmoved read is`() {
    val lateness = (1 until AttemptPollers.FRAMES_MS step 7).toList()
    var checked = 0
    for (lateMs in lateness) {
      val apart = AttemptPollers.FRAMES_MS + lateMs
      val moving = FrameGaps()
      val lines = (0..20).mapNotNull { k -> moving.read(3, k * 15L, k * apart, true) }
      assertEquals(emptyList(), lines, "reads $apart ms apart, video moving at each")
      // The positive pair at the same lateness: one read unmoved is a gap of two reads.
      val held = FrameGaps()
      held.read(3, 0, 0, true)
      held.read(3, 15, apart, true)
      assertNull(held.read(3, 15, 2 * apart, true))
      assertEquals(RecordEntry("frames-gap", listOf("attempt" to 3, "gapMs" to 2 * apart, "suppressed" to 0)), held.read(3, 30, 3 * apart, true))
      checked += 1
    }
    assertTrue(checked > 0)
    assertEquals(lateness.size, checked, "the sweep's own count")
  }

  /**
   * F-S7-3: the line is held to [CappedLines.MAX_LINES] a [CappedLines.WINDOW_MS], as `readiness` is (review
   * C4a I-1). The first line written after lines were held back carries how many.
   */
  @Test
  fun `F-S7-3 at most the cap's lines a window, and the next one written carries the count held back`() {
    val gaps = FrameGaps()
    val period = AttemptPollers.FRAMES_MS
    var t = 0L
    var video = 0L
    gaps.read(3, video, t, true)
    fun gap(): RecordEntry? {
      t += period
      assertNull(gaps.read(3, video, t, true), "unmoved")
      t += period
      video += 15
      return gaps.read(3, video, t, true)
    }
    val held = 4
    val first = List(CappedLines.MAX_LINES + held) { gap() }
    assertTrue(first.size * 2 * period < CappedLines.WINDOW_MS, "all inside one window")
    assertEquals(List(CappedLines.MAX_LINES) { listOf("attempt" to 3, "gapMs" to 2 * period, "suppressed" to 0) }, first.filterNotNull().map { it.fields })
    assertEquals(held, first.count { it == null }, "held back")
    t += CappedLines.WINDOW_MS
    val next = assertNotNull(gap(), "a new window writes again")
    assertEquals(listOf("attempt" to 3, "gapMs" to CappedLines.WINDOW_MS + 2 * period, "suppressed" to held), next.fields)
  }
}
