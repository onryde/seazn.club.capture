package com.seazn.capture.engine.adapter

/**
 * What only the platform knows, read on the scheduler thread at every publish. Never blocking: each
 * field is a volatile the adapters keep current. Defaults are "no reading". Readiness is not here:
 * the platform pushes it to the core as `Input.ReadinessChanged`, and native's `ready` is its one view.
 */
data class PlatformFacts(
  /** Peak level 0–1 since the last snapshot (CD28); 0 with no microphone. */
  val audioLevel: Double = 0.0,
  /** Wall time of the last playlist answer of any kind (carry 5). */
  val deliveryCheckedAtMs: Long? = null,
  /** Capture time of the last encoded video frame, epoch ms (spec §2). */
  val captureTimestampMs: Long? = null,
  /** True while the foreground service holds the pairing (CD16, A5): from Paired until its release. */
  val survivesBackground: Boolean = false,
)

/**
 * `SessionRecord`'s own counters, for Diagnostics: lines its sink refused, and echoes it dropped; and
 * the scheduler guard's (review 13, I3): failures that reached the task boundary, and reporters that
 * failed reporting one.
 */
data class RecordCounters(val sinkFailures: Int, val reentrantDropped: Int, val taskFailures: Int = 0, val reporterFailures: Int = 0)
