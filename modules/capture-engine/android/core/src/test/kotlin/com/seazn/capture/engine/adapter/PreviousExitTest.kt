package com.seazn.capture.engine.adapter

import kotlin.test.Test
import kotlin.test.assertEquals

class PreviousExitTest {
  @Test
  fun `F-P5-3 a session lost with the process is recorded with the exit reason`() {
    val entry = PreviousExit.entry(markerPresent = true, code = 10, exitAtMs = 1_790_000_000_000)!!
    assertEquals("previous-session-lost", entry.kind)
    assertEquals(listOf("exit" to "user-requested", "exitAtMs" to 1_790_000_000_000L), entry.fields)
  }

  @Test
  fun `no marker is no loss, and an unread reason says so`() {
    assertEquals(null, PreviousExit.entry(markerPresent = false, code = 4, exitAtMs = 0))
    assertEquals(listOf("exit" to "unknown", "exitAtMs" to null), PreviousExit.entry(true, null, null)!!.fields)
  }

  @Test
  fun `every ApplicationExitInfo reason has its own word`() {
    // AOSP's REASON_* constants, 0 to 16, in order.
    val words =
      listOf(
        "unknown", "exit-self", "signaled", "low-memory", "crash", "crash-native", "anr", "initialization-failure", "permission-change",
        "excessive-resource-usage", "user-requested", "user-stopped", "dependency-died", "other", "freezer", "package-state-change",
        "package-updated",
      )
    assertEquals(words, (0..16).map(PreviousExit::reason))
    assertEquals("unknown", PreviousExit.reason(99))
  }

  @Test
  fun `a code below the platform's range is unknown too, and the entry says so`() {
    assertEquals("unknown", PreviousExit.reason(-1))
    assertEquals(listOf("exit" to "unknown", "exitAtMs" to 5L), PreviousExit.entry(true, 17, 5)!!.fields)
  }
}
