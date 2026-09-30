package com.seazn.capture.engine.core

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

class HoldClockTest {
  private val windows = mapOf(Transport.SRT to 183, Transport.RTMPS to 180)

  @Test
  fun `C2 the status line's example - 38 s of 183`() {
    // Spec §4: "Uplink lost — holding, 38 s of 183".
    val hold = HoldClock.started(windows, Transport.SRT, nowMs = 10_000)!!
    assertEquals(183, hold.windowSeconds)
    assertEquals(38, hold.remainingSeconds(10_000 + 145_000))
    assertEquals(38, hold.remainingSeconds(10_000 + 145_999))
    assertEquals(37, hold.remainingSeconds(10_000 + 146_000))
  }

  @Test
  fun `C2 the window is the transport's`() {
    assertEquals(180, HoldClock.started(windows, Transport.RTMPS, 0)!!.windowSeconds)
  }

  @Test
  fun `the hold expires at the window, not a second before`() {
    val hold = HoldClock.started(windows, Transport.SRT, 0)!!
    assertFalse(hold.expired(182_999))
    assertEquals(1, hold.remainingSeconds(182_999))
    assertTrue(hold.expired(183_000))
    assertEquals(0, hold.remainingSeconds(200_000))
  }

  @Test
  fun `a missing or non-positive window gives no hold`() {
    assertNull(HoldClock.started(mapOf(Transport.SRT to 0), Transport.SRT, 0))
    assertNull(HoldClock.started(emptyMap(), Transport.RTMPS, 0))
  }
}
