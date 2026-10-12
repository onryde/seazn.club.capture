package com.seazn.capture.engine.core

/**
 * Everything that happens to the engine: operator intents, the engine's own tick, and platform
 * facts from plan C's adapters. Each adapter turns one Android fact into one of these and holds no
 * rule of its own (spec §3, `platform/`).
 */
sealed interface Input {
  /**
   * A5: pair with a code. [stopped] is this code and slot's A17 record from app-private storage, read
   * by the bridge, or null. [phone] is the install's facts. Intents, not RPC (AGENTS §2): each returns
   * nothing and is reconciled against the phase.
   */
  data class Pair(val request: PairRequest, val phone: PhoneFacts, val stopped: StoppedRecord?) : Input

  /** The answer to [Command.AskPermissions]: camera and microphone both granted, or not. */
  data class PermissionsAnswered(val granted: Boolean) : Input

  /** Forget, A7's confirm, an orphan clear. Paired only: never ends a held broadcast. */
  data object Unpair : Input

  /**
   * R6, R7 of the D3 findings design: the notification's Forget. Native's own input, from the glue's receiver,
   * never a JS intent; acts only while Paired ([Pairings.forget]).
   */
  data object Forget : Input

  data class SetAutomatic(val on: Boolean) : Input

  data class SetLanguage(val language: String) : Input

  /** The platform's readiness facts (A11), pushed on every change, in any phase. */
  data class ReadinessChanged(val readiness: Readiness) : Input

  /** The operator's Go live hold: `POST start` from Paired, when ready (amendment, _The engine port_). */
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

  /** [message] is the platform's own and may hold the stream URL and its key: it prints as its length only (m7). */
  data class ConnectFailed(val attemptId: Int, val failure: ConnectFailure, val message: String?) : Input {
    override fun toString() = "ConnectFailed(attemptId=$attemptId, failure=$failure, message=${masked(message)})"
  }

  /** As [ConnectFailed]: [message] prints as its length only (m7). */
  data class Dropped(val attemptId: Int, val reason: DropReason, val message: String?) : Input {
    override fun toString() = "Dropped(attemptId=$attemptId, reason=$reason, message=${masked(message)})"
  }

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

  /** The answer to [Command.FetchCode] [requestId]. Only the latest ask's answer is acted on. */
  data class CodeAnswered(val requestId: Int, val answer: CodeAnswer) : Input

  /** The answer to [Command.PostStart] [requestId]. */
  data class StartAnswered(val requestId: Int, val answer: StartAnswer) : Input

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
  data class PlatformFailed(val attemptId: Int, val message: String) : Input {
    override fun toString() = "PlatformFailed(attemptId=$attemptId, message=${masked(message)})"
  }
}

/**
 * m7: a platform message prints as its length, never its text. A data class's own `toString` would
 * print a stream key held in a URL into any log, exception or assertion that prints the input; the
 * record line, which carries the text, masks it on the way out (Task 10).
 */
private fun masked(message: String?): String = if (message == null) "null" else "<${message.length} chars>"
