package com.seazn.capture.engine.adapter

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * Review C4a I-1 (ruling C4a-I1): sound is held the way Task 17 holds held. The hold is the ruling's
 * 300 ms and the floor A11's 0.05, both typed here, never read from the code under test.
 */
class SoundHoldTest {
  private val hold = SoundHold()

  @Test
  fun `a level turns sound only at a reading that finds its run 300 ms old - both ways`() {
    assertNull(hold.sample(0.4, 1_000), "the first reading of a run never turns it")
    assertNull(hold.sample(0.4, 1_299))
    assertEquals(true, hold.sample(0.4, 1_300))
    assertNull(hold.sample(0.4, 1_800), "a reading that changes nothing is null")
    assertNull(hold.sample(0.01, 2_000), "the falling edge is held too")
    assertNull(hold.sample(0.01, 2_299))
    assertEquals(false, hold.sample(0.01, 2_300))
  }

  @Test
  fun `the floor is unchanged - 0_05 is sound and a NaN is silent`() {
    hold.sample(0.05, 0)
    assertEquals(true, hold.sample(0.05, 300))
    hold.sample(Double.NaN, 1_000)
    assertEquals(false, hold.sample(Double.NaN, 1_300))
    hold.sample(0.049_999, 2_000)
    assertNull(hold.sample(0.049_999, 2_300), "below the floor stays silent")
    assertFalse(hold.sound)
  }

  @Test
  fun `a single reading never turns it, and the second turns it however late`() {
    assertNull(hold.sample(0.4, 0))
    assertFalse(hold.sound)
    assertEquals(true, hold.sample(0.4, 60_000))
  }

  @Test
  fun `one reading on the other side starts the run again`() {
    hold.sample(0.4, 0)
    hold.sample(0.0, 200)
    hold.sample(0.4, 400)
    assertNull(hold.sample(0.4, 600), "the run began again at 400")
    assertEquals(true, hold.sample(0.4, 700))
  }

  @Test
  fun `a peak hovering at the floor, a reading either side every 500 ms for ten minutes, never turns it`() {
    var turns = 0
    var readings = 0
    for (n in 0 until 1_200) {
      if (hold.sample(if (n % 2 == 0) 0.049 else 0.051, n * 500L) != null) turns += 1
      readings += 1
    }
    assertEquals(1_200, readings, "the sweep's own count")
    assertEquals(0, turns)
    // The flap's last reading, 0.051, began a run above the floor: a reading on that side long after finds it held.
    assertEquals(true, hold.sample(0.4, 700_000))
    // And from sound: the same flap never drops it.
    for (n in 0 until 1_200) assertNull(hold.sample(if (n % 2 == 0) 0.049 else 0.051, 701_000 + n * 500L))
    assertTrue(hold.sound)
  }
}
