package com.seazn.capture.engine.core

/**
 * What the core asks of the platform. Plan C's adapters carry each one out and report back as an
 * [Input]; none of them decides anything.
 */
sealed interface Command {
  /** Open an ingest session. [maxBwBytesPerSecond] is `SRTO_MAXBW` for SRT, null for RTMPS (F-P5-11). */
  data class Connect(
    val attemptId: Int,
    val target: IngestTarget,
    val startBitrateBps: Int,
    val maxBwBytesPerSecond: Long?,
  ) : Command

  data class Disconnect(val attemptId: Int) : Command

  /** Stop the stream and start it again, video pipeline included (F-P5-6, F-P5-9). */
  data class Rebuild(val previousAttemptId: Int, val next: Connect) : Command

  /** Close this ingest session and open a fresh one, because viewers are not receiving it (F-P5-13). */
  data class StartNewSession(val previousAttemptId: Int, val next: Connect) : Command

  data class SetBitrate(val attemptId: Int, val bps: Int) : Command

  data class SetMaxBw(val attemptId: Int, val bytesPerSecond: Long) : Command

  /** Switch to the other camera, as the operator asked ([Input.SwitchCamera]). No answer is expected: frames are the proof. */
  data object SwitchCamera : Command

  /** Reopen our camera with an ID round trip (F-P5-10: ~1.2 s, one black frame). */
  data object ReopenCamera : Command

  /** The phone-made slate on air instead of the camera, with silent audio (decision 7). */
  data class Slate(val on: Boolean) : Command

  /**
   * `GET url`, answered as [Input.PlaylistFetched]. Always a fresh fetch: no HTTP cache, no proxy,
   * `Cache-Control: no-cache`. Cloudflare's manifests are dynamic and must never be cached or stored.
   */
  data class FetchPlaylist(val requestId: Int, val url: String) : Command

  /**
   * `POST url` with `Authorization: Bearer <bearer>`. The bearer is the code's `tok`. Prints no body
   * and no URL: both carry the code.
   */
  data class PostHeartbeat(val beatId: Int, val url: String, val bearer: String, val body: String) : Command {
    override fun toString(): String =
      "PostHeartbeat(beatId=$beatId, url=<${url.length} chars>, bearer=<${bearer.length} chars>, body=<${body.length} chars>)"
  }

  /** Ask for the camera and microphone (and, on Android 13+, notifications), answered as [Input.PermissionsAnswered]. */
  data object AskPermissions : Command

  /** Start the foreground service and take the partial wake lock, for the whole pairing (A5). */
  data object Hold : Command

  /** Stop the foreground service and release the wake lock. */
  data object Release : Command

  /** The broadcast's encoded rotation, before its first [Connect] (A11). */
  data class Orient(val side: Side) : Command

  /**
   * `GET url?slot=slot&phone=phoneId` with the Bearer, no-store, answered as [Input.CodeAnswered]
   * (G0-d), on arming and again on every reconnect (spec §1). [environment] names the ingest host the
   * answer's `cred` must sit on.
   */
  data class FetchCode(val requestId: Int, val url: String, val bearer: String, val phoneId: String, val slot: Int, val environment: Environment) : Command {
    override fun toString(): String = "FetchCode(requestId=$requestId, url=<${url.length} chars>, bearer=<${bearer.length} chars>)"
  }

  /** `POST url` with the Bearer and [body], answered as [Input.StartAnswered]. */
  data class PostStart(val requestId: Int, val url: String, val bearer: String, val body: String) : Command {
    override fun toString(): String = "PostStart(requestId=$requestId, url=<${url.length} chars>, bearer=<${bearer.length} chars>)"
  }

  /** Stop publishing this broadcast; the pairing, the camera and the service stay. */
  data object StopBroadcast : Command

  /** A17: write [record] to app-private storage, synchronously, before the [End] that follows it. */
  data class WriteStopped(val record: StoppedRecord) : Command

  /**
   * R6 of the D3 findings design: the Forget marker for [name], durable before JS hears it, so a process death
   * still reads `unpaired: forgotten` at the next start (B9).
   */
  data class WriteForgotten(val name: PairingName) : Command {
    override fun toString(): String = "WriteForgotten(slot=${name.slot})"
  }

  /** A17: the record for this code and slot is delivered, or its code ended. */
  data class DeleteStopped(val code: String, val slot: Int) : Command {
    override fun toString(): String = "DeleteStopped(slot=$slot)"
  }

  /** The pairing is over: stop publishing and capture. The service goes with [Release]. */
  data class End(val reason: EndReason) : Command

  /** A line for the session record. The engine routes it to [SessionRecord]; the platform never sees it. */
  data class Record(val entry: RecordEntry) : Command
}
