package com.seazn.capture.engine.capture.photo

import java.time.Instant
import java.time.ZoneOffset
import kotlin.test.Test
import kotlin.test.assertEquals

class PhotoNameTest {
  private val at = Instant.parse("2026-10-07T14:25:01Z").toEpochMilli()

  @Test
  fun `M4 the name is the phone's wall clock in a 24 hour pattern, and says nothing about the match`() {
    // R6: Seazn_ + yyyyMMdd_HHmmss + .jpg. Two zones, so a hard-coded UTC or a 12 hour clock fails.
    assertEquals("Seazn_20261007_142501.jpg", PhotoName.of(at, ZoneOffset.UTC))
    assertEquals("Seazn_20261008_002501.jpg", PhotoName.of(at, ZoneOffset.ofHours(10)))
  }
}
