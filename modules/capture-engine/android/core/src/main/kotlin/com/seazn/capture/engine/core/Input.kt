package com.seazn.capture.engine.core

/** The descriptor fetched again on a reconnect (spec §1), already typed by the platform. */
sealed interface DescriptorCheck {
  data object Live : DescriptorCheck

  /** 410, or a state that is over. [endReason] is the server's, for the record. */
  data class Over(val endReason: String?) : DescriptorCheck

  data class Unreachable(val message: String) : DescriptorCheck
}

/**
 * Everything that happens to the engine: operator intents, the engine's own tick, and platform
 * facts from plan C's adapters. Each adapter turns one Android fact into one of these and holds no
 * rule of its own (spec §3, `platform/`).
 */
sealed interface Input {
  /** Intents, not RPC (AGENTS §2): each returns nothing and is reconciled against the phase. */
  data class Arm(val config: SessionConfig) : Input

  data object Start : Input

  data object Stop : Input

  data object Reset : Input

  /**
   * The operator's switch to the other camera (spec §3's bridge intent `switchCamera`). The machine
   * asks for it with [Command.SwitchCamera]; while the slate is on air there is no camera of ours to switch.
   */
  data object SwitchCamera : Input

  /** The engine's clock, every [Engine.TICK_MS]. Every time-based rule runs on it. */
  data object Tick : Input

  /** Every fact about an attempt names it. A fact about an attempt that is over is stale, and ignored. */
  data class Connected(val attemptId: Int) : Input

  data class ConnectFailed(val attemptId: Int, val failure: ConnectFailure, val message: String?) : Input

  data class Dropped(val attemptId: Int, val reason: DropReason, val message: String?) : Input

  /** Encoded frames that reached the endpoint, cumulative for the attempt (F-P5-4). At least twice a second. */
  data class Frames(val attemptId: Int, val videoFrames: Long, val audioFrames: Long) : Input

  /** The transport's counters, cumulative for the attempt. About once a second. */
  data class Link(val attemptId: Int, val counters: LinkCounters) : Input

  /** `NET_CAPABILITY_VALIDATED`, pushed at arm and on every change. Until the first, it is not validated. */
  data class Network(val validated: Boolean) : Input

  /** Another app opened a camera while ours is held (F-P5-9). */
  data object CameraContended : Input

  /** No other app holds a camera any more (F-P5-10). */
  data object CameraReleased : Input

  data class CameraReopened(val ok: Boolean) : Input

  /** `AudioRecordingConfiguration.isClientSilenced()` for our session id (F-P5-8). */
  data class MicSilenced(val silenced: Boolean) : Input

  data class Device(val sample: DeviceSample) : Input

  data class PlaylistFetched(val requestId: Int, val result: FetchResult) : Input

  data class HeartbeatAnswered(val beatId: Int, val response: HeartbeatResponse) : Input

  data class DescriptorChecked(val result: DescriptorCheck) : Input
}
