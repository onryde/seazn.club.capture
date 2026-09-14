package com.seazn.p5spike

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Test

class ExitHistoryTest {
  /** REASON_UNKNOWN (0) through REASON_PACKAGE_UPDATED (16), per compileSdk 36's android.jar. */
  @Test
  fun `every reason the SDK defines has its own name`() {
    val names = (0..16).map(ExitHistory::reasonName)

    assertEquals(names.size, names.toSet().size)
    names.forEach { assertFalse("unmapped: $it", it.startsWith("reason-")) }
  }

  @Test
  fun `a reason newer than the SDK keeps its number`() {
    assertEquals("reason-99", ExitHistory.reasonName(99))
  }

  @Test
  fun `importance names the states that tell a killed service from a cached app`() {
    assertEquals("foreground-service", ExitHistory.importanceName(125))
    assertEquals("cached", ExitHistory.importanceName(400))
    assertEquals("importance-1", ExitHistory.importanceName(1))
  }
}
