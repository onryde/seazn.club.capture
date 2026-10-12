package com.seazn.capture.engine.core

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

/**
 * M5 of the Batch 5 review (the controller's ruling, 2026-10-12): three readings, in the order Android's App battery
 * usage page decides them, and unknown on its own. The words are the record's and the bridge's (`nativePower.ts`).
 */
class PowerModeTest {
  @Test
  fun `the exemption reads Unrestricted, whatever the background reading says`() {
    assertEquals("unrestricted", PowerMode.of(ignoringOptimizations = true, backgroundRestricted = false))
    assertEquals("unrestricted", PowerMode.of(ignoringOptimizations = true, backgroundRestricted = true))
    assertEquals("unrestricted", PowerMode.of(ignoringOptimizations = true, backgroundRestricted = null))
  }

  @Test
  fun `no exemption reads Restricted when the background is restricted, else Optimized, Android's default`() {
    assertEquals("restricted", PowerMode.of(ignoringOptimizations = false, backgroundRestricted = true))
    assertEquals("optimized", PowerMode.of(ignoringOptimizations = false, backgroundRestricted = false))
  }

  @Test
  fun `an unread reading is unknown, never a guess`() {
    assertNull(PowerMode.of(ignoringOptimizations = null, backgroundRestricted = false))
    assertNull(PowerMode.of(ignoringOptimizations = null, backgroundRestricted = true))
    assertNull(PowerMode.of(ignoringOptimizations = null, backgroundRestricted = null))
    assertNull(PowerMode.of(ignoringOptimizations = false, backgroundRestricted = null))
  }

  @Test
  fun `the words are plain words, so the record passes them under its mode key`() {
    for (word in listOf(PowerMode.UNRESTRICTED, PowerMode.OPTIMIZED, PowerMode.RESTRICTED)) {
      assertEquals(true, SessionRecord.PLAIN_WORD.matches(word), word)
    }
    assertEquals(true, "mode" in SessionRecord.PLAIN_KEYS)
  }
}
