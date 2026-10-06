package com.seazn.capture.engine.adapter

import com.seazn.capture.engine.adapter.SoundHold.Companion.SILENCE_MS
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * Owner, 2026-10-05 (readiness hysteresis, superseding ruling C4a-I1's two-reading hold): sound is ready
 * at the first reading at or above the floor, not ready only after [SILENCE_MS] of readings below it
 * without a break, and not ready at once when the system silences the mic. The window is pinned once,
 * to the owner's figure; every other expectation is derived from it. The floor is A11's 0.05.
 */
class SoundHoldTest {
  private val hold = SoundHold()

  /** The glue's meter cadence (Task 33, `READINESS_MS`): a reading every 500 ms. */
  private val meterMs = 500L

  @Test
  fun `the silence window is the owner's 15 s (2026-10-05)`() {
    assertEquals(15_000L, SILENCE_MS)
  }

  @Test
  fun `the first loud reading is sound at once`() {
    assertEquals(true, hold.sample(0.4, 1_000), "no hold on the way up")
    assertNull(hold.sample(0.4, 1_500), "a reading that changes nothing is null")
    assertTrue(hold.sound)
  }

  @Test
  fun `a burst then silence - still sound a moment before the window, silent at it`() {
    assertEquals(true, hold.sample(0.4, 0))
    val quietFrom = 700L
    var readings = 0
    var at = quietFrom
    while (at < quietFrom + SILENCE_MS - 100) {
      assertNull(hold.sample(0.0, at), "still sound at ${at - quietFrom} ms of silence")
      readings += 1
      at += 100
    }
    assertEquals((SILENCE_MS - 100) / 100, readings.toLong(), "the sweep's own count")
    assertNull(hold.sample(0.0, quietFrom + SILENCE_MS - 100), "14.9 s of silence: still sound")
    assertTrue(hold.sound)
    assertEquals(false, hold.sample(0.0, quietFrom + SILENCE_MS), "15 s of silence: silent")
    assertNull(hold.sample(0.0, quietFrom + SILENCE_MS + meterMs), "and it stays so, with nothing to report")
  }

  @Test
  fun `one loud reading in the silence starts the window again`() {
    hold.sample(0.4, 0)
    hold.sample(0.0, meterMs)
    assertNull(hold.sample(0.4, SILENCE_MS - meterMs), "a word near the window's end")
    assertNull(hold.sample(0.0, SILENCE_MS), "the window runs from here now")
    assertNull(hold.sample(0.0, 2 * SILENCE_MS - 1), "a moment short of a full window")
    assertEquals(false, hold.sample(0.0, 2 * SILENCE_MS))
  }

  @Test
  fun `C4a-I1's intent kept - a single noise spike after long silence is sound at once`() {
    var silentReadings = 0
    for (n in 0 until 1_200) {
      assertNull(hold.sample(0.0, n * meterMs), "ten minutes of silence never turns it")
      silentReadings += 1
    }
    assertEquals(1_200, silentReadings, "the sweep's own count")
    assertFalse(hold.sound)
    assertEquals(true, hold.sample(0.3, 1_200 * meterMs), "one spike is sound, at once")
  }

  @Test
  fun `the floor is unchanged - 0_05 is sound and a NaN is silent`() {
    assertEquals(true, hold.sample(0.05, 0))
    hold.sample(Double.NaN, meterMs)
    assertEquals(false, hold.sample(Double.NaN, meterMs + SILENCE_MS), "a NaN reads silent, for the window")
    assertNull(hold.sample(0.049_999, 2 * SILENCE_MS), "below the floor stays silent")
    assertFalse(hold.sound)
  }

  @Test
  fun `a peak hovering at the floor for ten minutes turns sound once, on its first loud reading, and never off`() {
    var turns = 0
    var readings = 0
    for (n in 0 until 1_200) {
      hold.sample(if (n % 2 == 0) 0.049 else 0.051, n * meterMs)?.let { turns += 1 }
      readings += 1
    }
    assertEquals(1_200, readings, "the sweep's own count")
    assertEquals(1, turns, "on at the first 0.051, and the silence never lasts a window")
    assertTrue(hold.sound)
  }

  @Test
  fun `the system silencing the mic is silent at once, past the window`() {
    assertEquals(true, hold.sample(0.4, 0))
    assertEquals(false, hold.micSilenced(true), "at once, with no reading after it")
    assertNull(hold.micSilenced(true), "told again: nothing changes")
    // The meter's next reading is the loudest of the last 500 ms, from before the silencing.
    assertNull(hold.sample(0.4, meterMs), "a loud reading while silenced is not sound")
    assertFalse(hold.sound)
  }

  @Test
  fun `sound comes back at the first loud reading once the system restores the mic`() {
    hold.sample(0.4, 0)
    hold.micSilenced(true)
    assertNull(hold.micSilenced(false), "restored is no sound by itself")
    assertFalse(hold.sound)
    assertEquals(true, hold.sample(0.4, meterMs), "the first loud reading after it, at once")
  }

  @Test
  fun `a silencing while already silent changes nothing`() {
    assertNull(hold.micSilenced(true))
    assertFalse(hold.sound)
  }

  @Test
  fun `the capture's close is silent at once, and the next loud reading is sound at once`() {
    hold.sample(0.4, 0)
    hold.sample(0.0, meterMs)
    hold.reset()
    assertFalse(hold.sound, "the C4a carry: off at the close")
    assertEquals(true, hold.sample(0.4, 2 * meterMs))
    // A window begun before the close is not carried past it.
    assertNull(hold.sample(0.0, 3 * meterMs))
    assertNull(hold.sample(0.0, 3 * meterMs + SILENCE_MS - 1))
    assertEquals(false, hold.sample(0.0, 3 * meterMs + SILENCE_MS))
  }
}
