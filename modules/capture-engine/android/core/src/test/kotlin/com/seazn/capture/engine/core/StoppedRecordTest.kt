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
  fun `A17 delivered by a 2xx or a 410, never by anything else`() {
    for (status in listOf(200, 204, 299, 410)) assertTrue(StoppedRecord.delivered(status), "$status")
    for (status in listOf(199, 300, 401, 404, 409, 429, 500)) assertFalse(StoppedRecord.delivered(status), "$status")
    assertFalse(StoppedRecord.delivered(null))
  }

  @Test
  fun `G0-g a taken or a replaced answer comes in a 200, so it delivers the record`() {
    // The server answers a claim it refuses with taken or replaced, and still applies the stop the beat
    // carried (amendment, G0-g). Built as the beat's answer arrives: a 200 whose body says so.
    for ((state, word) in listOf("taken" to ServerWord.Taken, "replaced" to ServerWord.Replaced)) {
      val answer = HeartbeatResponse.Answered(200, BeatReply(state, null, null, null, null))
      assertEquals(word, ServerWord.ofBeat(answer, named = "sess_41"), state)
      assertTrue(StoppedRecord.delivered(answer.status), state)
    }
  }

  @Test
  fun `M2 a maximum duration of zero or less is read as none, so the record keeps twelve hours`() {
    for (minutes in listOf(0, -5)) {
      assertEquals(at + 43_200_000, StoppedRecord.of(name, "sess_42", at, minutes).keepUntilEpochMs, "$minutes")
    }
    assertEquals(at + 60_000, StoppedRecord.of(name, "sess_42", at, maxDurationMinutes = 1).keepUntilEpochMs)
  }
}
