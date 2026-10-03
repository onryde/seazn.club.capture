package com.seazn.capture.engine.adapter

import com.seazn.capture.engine.core.RecordEntry

/**
 * F-P5-3, CD22: a session lost with the process. The glue finds its marker from the previous run and
 * reads the newest `ApplicationExitInfo`; this turns what it found into the record's line.
 */
object PreviousExit {
  private const val UNKNOWN = "unknown"

  /**
   * `ApplicationExitInfo.REASON_*`, 0 to 16, in order. The ints are Android's: Task 38 checks them
   * against `android.jar` (`javap -constants`) before it uses them.
   */
  private val WORDS =
    listOf(
      UNKNOWN, "exit-self", "signaled", "low-memory", "crash", "crash-native", "anr", "initialization-failure", "permission-change",
      "excessive-resource-usage", "user-requested", "user-stopped", "dependency-died", "other", "freezer", "package-state-change",
      "package-updated",
    )

  /** The reason's word; any code outside 0 to 16 is `unknown`. */
  fun reason(code: Int): String = WORDS.getOrNull(code) ?: UNKNOWN

  /** No marker is no loss: null. `exit` is a plain word and `exitAtMs` a number, so the scrub passes both (CD6). */
  fun entry(markerPresent: Boolean, code: Int?, exitAtMs: Long?): RecordEntry? =
    if (!markerPresent) null else RecordEntry("previous-session-lost", listOf("exit" to (code?.let(::reason) ?: UNKNOWN), "exitAtMs" to exitAtMs))
}
