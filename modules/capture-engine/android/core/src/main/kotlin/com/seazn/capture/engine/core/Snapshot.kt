package com.seazn.capture.engine.core

/**
 * The session state as the snapshot carries it (spec §2: "the snapshot carries `state` directly").
 * One member per TypeScript `SessionState` kind; the bridge (plan C) maps [wire] and the fields.
 */
sealed interface SnapshotState : Wire {
  data object Idle : SnapshotState {
    override val wire = "idle"
  }

  data object Armed : SnapshotState {
    override val wire = "armed"
  }

  data class Connecting(val transport: Transport) : SnapshotState {
    override val wire = "connecting"
  }

  /** LIVE. Only while encoded video frames advance (F-P5-6). */
  data class Publishing(val transport: Transport, val sinceEpochMs: Long) : SnapshotState {
    override val wire = "publishing"
  }

  /** Frames advance, but something the operator must see is wrong. [reasons] is never empty. */
  data class Degraded(val transport: Transport, val reasons: List<DegradeReason>, val sinceEpochMs: Long) :
    SnapshotState {
    override val wire = "degraded"
  }

  /**
   * Not publishing since the session was live, while the platform holds the input: "Uplink lost —
   * holding, 38 s of 183". [cause] lets the status line say which: a lost uplink, a rebuild, or a
   * restart because viewers were not receiving.
   */
  data class Reconnecting(
    val cause: ReconnectCause,
    val holdRemainingSeconds: Int,
    val holdWindowSeconds: Int,
    val sinceEpochMs: Long,
  ) : SnapshotState {
    override val wire = "reconnecting"
  }

  data class Ended(val reason: EndReason) : SnapshotState {
    override val wire = "ended"
  }
}

/** SRT's own counters for the attempt (F-P5-4's retry requirement), cumulative since it connected. */
data class SrtTelemetry(val sent: Long, val retransmitted: Long, val dropped: Long, val rttMs: Int?)

data class HeartbeatStatus(
  val lastSentAtEpochMs: Long?,
  val lastResult: HeartbeatResult?,
  val consecutiveFailures: Int,
  val failures: Int,
)

/**
 * The ~1 Hz upward contract (AGENTS §2). Field names follow spec §2's wording; plan A defines the
 * TypeScript shape and plan C's bridge maps one to the other.
 */
data class Snapshot(
  val state: SnapshotState,
  val reportedAtMs: Long,
  val delivery: Delivery,
  val deliveredLagMs: Long?,
  val encodedVideoFps: Double?,
  val audioPacketsPerSecond: Double?,
  val srt: SrtTelemetry?,
  /** Measured egress, what actually left the phone. */
  val bitrateKbps: Int?,
  /** The regulator's video target. */
  val targetBitrateKbps: Int?,
  val dataUsedBytes: Long,
  val charging: Boolean?,
  val heartbeat: HeartbeatStatus,
  val shed: ShedStep?,
  val device: DeviceSample?,
)
