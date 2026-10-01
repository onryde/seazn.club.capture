package com.seazn.capture.engine.core

/**
 * The session state as the snapshot carries it (spec §2: "the snapshot carries `state` directly").
 * One member per TypeScript `SessionState` kind; the bridge (plan C) maps [wire] and the fields.
 */
sealed interface SnapshotState : Wire {
  data object Idle : SnapshotState {
    override val wire = "idle"
  }

  /** `pair` heard; the permissions are being asked. */
  data object Pairing : SnapshotState {
    override val wire = "pairing"
  }

  /** Paired with a code and slot, beating, no broadcast held. */
  data object Paired : SnapshotState {
    override val wire = "paired"
  }

  /** [retrying]: the code's last answer was no answer, so the line reads "Starting — can't reach Seazn, retrying". */
  data class Arming(val cause: Cause, val retrying: Boolean) : SnapshotState {
    override val wire = "arming"
  }

  /** [notReady]: the first check that fails (A11), or null when the gate is about to open. */
  data class Armed(val cause: Cause, val notReady: NotReady?) : SnapshotState {
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

  /**
   * [durationMs]: how long the session was live, from its first encoded frame to its end, outages
   * included, as the HUD's elapsed clock counts it; null if it never went live (final review M-3).
   */
  data class Ended(val reason: EndReason, val durationMs: Long?) : SnapshotState {
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
  /** Whose camera it is; null with no pairing, and in Ended. Our own reopen or switch reads apart from a take. */
  val camera: CameraState?,
  /** The pairing, in every phase that has one, Ended included, so JS can forget the code it names. Never the token. */
  val pairing: PairingView? = null,
  /** The broadcast held, from Armed on: its non-secret fields only. */
  val broadcast: BroadcastView? = null,
  /** A11's checks as four booleans, false when unknown or with no pairing. */
  val ready: ReadyView = ReadyView.NONE,
  /** The last start's refusal, until the next start. */
  val refusal: Refusal? = null,
  /** Why the last broadcast ended, in Paired, until the next start. */
  val lastEnd: LastEnd? = null,
  /** Why the engine left the pairing on its own, in Idle, until the next pair. */
  val unpaired: Unpaired? = null,
  /** A 401 heard while a broadcast is held: the pairing ends with it. */
  val codeEndedPending: Boolean = false,
  /** The pairing's language, for the notification. */
  val language: String? = null,
)

/** The pairing as the snapshot carries it: its name (code, slot and token tag), never the token. */
data class PairingView(val name: PairingName, val automatic: Boolean, val waiting: WaitingFields)

/** The broadcast's non-secret fields: no ingest URL, stream id, key or passphrase. */
data class BroadcastView(
  val sid: String,
  val cause: Cause,
  val playbackUrl: String,
  val overlayUrl: String?,
  val label: String,
  val holdWindowSeconds: Map<Transport, Int>,
  val maxDurationMinutes: Int,
  val scoreUpdates: String,
  /** A18: false when the server offered RTMPS alone; Diagnostics shows "SRT not offered". */
  val srtOffered: Boolean,
)

data class ReadyView(val camera: Boolean, val sound: Boolean, val network: Boolean, val held: Boolean) {
  companion object {
    val NONE = ReadyView(camera = false, sound = false, network = false, held = false)
  }
}
