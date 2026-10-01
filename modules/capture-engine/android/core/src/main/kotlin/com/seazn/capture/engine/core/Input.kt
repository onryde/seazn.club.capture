package com.seazn.capture.engine.core

/**
 * The descriptor fetched again on a reconnect (spec §1). The platform's adapter types an HTTP answer
 * with [answered], which holds the rule; a fetch with no HTTP answer is [Unreachable] with its message.
 */
sealed interface DescriptorCheck {
  data object Live : DescriptorCheck

  /** 410, or a state that is over. [endReason] is the server's, for the record. */
  data class Over(val endReason: String?) : DescriptorCheck

  data class Unreachable(val message: String) : DescriptorCheck

  companion object {
    /**
     * An HTTP answer to the descriptor fetch: [status], and the body's `state` and `endReason` (null
     * when absent or unreadable). Over by the heartbeat's own rule ([SessionOver], final review M-4);
     * any other 2xx is live; any other status is no answer, whatever its body says.
     */
    fun answered(status: Int, state: String?, endReason: String?): DescriptorCheck =
      when {
        SessionOver.said(status, state) -> Over(endReason)
        status in 200..299 -> Live
        else -> Unreachable("HTTP $status")
      }
  }
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

  /**
   * The engine's clock, every [Engine.TICK_MS]. Every time-based rule runs on it. The two that end or
   * rebuild a session are also judged before other inputs ([SessionMachine.reduce], B6 ruling C2):
   * hold expiry before any but a stop, the stall watchdog before any but a stop or a platform failure.
   */
  data object Tick : Input

  /** Every fact about an attempt names it. A fact about an attempt that is over is stale, and ignored. */
  data class Connected(val attemptId: Int) : Input

  data class ConnectFailed(val attemptId: Int, val failure: ConnectFailure, val message: String?) : Input

  data class Dropped(val attemptId: Int, val reason: DropReason, val message: String?) : Input

  /** Encoded frames that reached the endpoint, cumulative for the attempt (F-P5-4). At least twice a second. */
  data class Frames(val attemptId: Int, val videoFrames: Long, val audioFrames: Long) : Input

  /** The transport's counters, cumulative for the attempt. About once a second. */
  data class Link(val attemptId: Int, val counters: LinkCounters) : Input

  /**
   * `NET_CAPABILITY_VALIDATED`, pushed on every change, in any phase. The machine keeps the last one
   * between sessions and seeds each session with it at arm (final review I-1). Until the first, it is
   * not validated.
   */
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

  /** The answer to [Command.FetchDescriptor] [requestId]. Only the latest ask's answer is acted on. */
  data class DescriptorChecked(val requestId: Int, val result: DescriptorCheck) : Input

  /**
   * A failure plan C's adapter knows is permanent: an encoder that can never start, a native library
   * that will not load. A failure the adapter can retry is not one. [attemptId] is the attempt it came
   * from (final review N-4). From the attempt in hand — the one in flight or, with none in flight, the
   * next — it ends the session fatal-error (spec §5), and an idle engine too, with [message] in the
   * record, masked as free text. From an older attempt it is stale, the teardown of an attempt or a
   * session that is already over, and only recorded; so is any failure after the end. Only an older id
   * is stale. A hold that has run out is judged first, so in the gap before the tick it reads
   * hold-window-expired ([SessionMachine.reduce]).
   */
  data class PlatformFailed(val attemptId: Int, val message: String) : Input
}
