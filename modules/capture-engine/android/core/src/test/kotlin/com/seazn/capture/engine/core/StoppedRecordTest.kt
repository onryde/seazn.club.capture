package com.seazn.capture.engine.core

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class StoppedRecordTest {
  private val name = PairingName("fx-42", 1, "c980ff38")
  private val at = 1_790_000_000_000L

  @Test
  fun `A17 the record keeps the stopped sid until the broadcast's maximum duration has passed`() {
    // 300 minutes is 18 000 000 ms after the stop.
    val record = StoppedRecord.of(name, "sess_42", at, maxDurationMinutes = 300)
    assertEquals(StoppedRecord("fx-42", 1, "sess_42", at, at + 18_000_000), record)
  }

  @Test
  fun `RR2 a stop before the descriptor answered keeps it for twelve hours`() {
    // 12 h = 12 × 3 600 000 ms = 43 200 000 ms.
    assertEquals(43_200_000L, StoppedRecord.DEFAULT_KEEP_MS)
    assertEquals(at + 43_200_000, StoppedRecord.of(name, "sess_42", at, maxDurationMinutes = null).keepUntilEpochMs)
  }

  @Test
  fun `A17 a record is current until keepUntil, and startup prunes those past it`() {
    val record = StoppedRecord.of(name, "sess_42", at, maxDurationMinutes = 1)
    assertTrue(record.current(at + 59_999))
    assertFalse(record.current(at + 60_000))
    assertEquals(emptyList(), StoppedRecord.pruned(listOf(record), at + 60_000))
    assertEquals(listOf(record), StoppedRecord.pruned(listOf(record), at))
  }

  @Test
  fun `A17 a record is per code and slot, whatever issue of the code`() {
    val record = StoppedRecord.of(name, "sess_42", at, null)
    assertTrue(record.isFor(name.copy(tokenTag = "00000000")))
    assertFalse(record.isFor(name.copy(slot = 2)))
    assertFalse(record.isFor(name.copy(code = "fx-43")))
  }

  @Test
  fun `A17 delivered by a 2xx or a 410, and by replaced or taken, never by anything else`() {
    assertTrue(StoppedRecord.delivered(200, ServerWord.NoBroadcast))
    assertTrue(StoppedRecord.delivered(410, ServerWord.Over("sess_42", null)))
    assertTrue(StoppedRecord.delivered(200, ServerWord.Replaced))
    assertTrue(StoppedRecord.delivered(200, ServerWord.Taken))
    for (status in listOf(401, 404, 429, 500)) assertFalse(StoppedRecord.delivered(status, ServerWord.NoEvidence), "$status")
    assertFalse(StoppedRecord.delivered(null, ServerWord.NoEvidence))
    // No answer keeps it whatever word is passed: only an answer the server sent can deliver it.
    assertFalse(StoppedRecord.delivered(null, ServerWord.Replaced))
  }
}
