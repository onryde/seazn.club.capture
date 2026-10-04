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
 * `SessionRecord`'s own counters, for Diagnostics: lines its sink refused, and echoes it dropped; the
 * scheduler guard's (review 13, I3): failures that reached the task boundary, and reporters that
 * failed reporting one; and the engine's and the bridge's (review C4a I-2, m-8).
 */
data class RecordCounters(
  val sinkFailures: Int,
  val reentrantDropped: Int,
  val taskFailures: Int = 0,
  val reporterFailures: Int = 0,
  /** Snapshots the projection or the bridge threw on, and those sent over the last good facts because the platform's facts threw. */
  val snapshotFailures: Int = 0,
  /** Commands the platform threw on, each also a `command-failed` line. */
  val commandFailures: Int = 0,
  /** A platform failure is held (carry 18): each attempt is refused until the next pair, or for good when permanent. */
  val stickyFailure: Boolean = false,
)
