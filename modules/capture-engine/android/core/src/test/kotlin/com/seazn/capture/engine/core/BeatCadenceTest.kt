package com.seazn.capture.engine.core

import kotlin.test.Test
import kotlin.test.assertEquals

class BeatCadenceTest {
  @Test
  fun `I3 pollSeconds is clamped to 5-300 s, and the default holds until the server says`() {
    assertEquals(5, BeatCadence.clamp(1))
    assertEquals(300, BeatCadence.clamp(3_600))
    assertEquals(60, BeatCadence.clamp(60))
    assertEquals(BeatCadence.DEFAULT_POLL_S, BeatCadence.clamp(null))
  }

  @Test
  fun `I3 while a broadcast is held a beat goes at least every 10 s`() {
    assertEquals(60_000L, BeatCadence.intervalMs(60, held = false))
    assertEquals(10_000L, BeatCadence.intervalMs(60, held = true))
    assertEquals(5_000L, BeatCadence.intervalMs(5, held = true))
  }

  @Test
  fun `a 429's Retry-After delays within the same clamp`() {
    assertEquals(300_000L, BeatCadence.retryAfterMs(900))
    assertEquals(5_000L, BeatCadence.retryAfterMs(0))
  }
}
