package com.seazn.capture.engine.adapter

import com.seazn.capture.engine.core.RecordEntry
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

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
    assertEquals(RecordEntry("frames-gap", listOf("attempt" to 3, "gapMs" to 1_500L)), gaps.read(3, 20, 2_000, true))
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
  fun `the first read after publishing resumes is its baseline, even when video moved in between`() {
    val gaps = FrameGaps()
    gaps.read(3, 10, 0, true)
    gaps.read(3, 11, 9_000, publishing = false)
    // Video moved (11 → 12) 800 ms after the last read while not publishing. That read is no baseline
    // for the attempt: 800 ms would read as a gap. Publishing again begins here.
    assertNull(gaps.read(3, 12, 9_800, true))
    // From that baseline: last moved at 9 800, again at 10 400 = 600 ms, a gap.
    assertEquals(RecordEntry("frames-gap", listOf("attempt" to 3, "gapMs" to 600L)), gaps.read(3, 13, 10_400, true))
  }
}
