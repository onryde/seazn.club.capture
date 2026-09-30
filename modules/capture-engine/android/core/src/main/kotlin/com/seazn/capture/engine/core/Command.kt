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

  /** `POST url` with `Authorization: Bearer <bearer>`. The bearer is the session's `tok`. */
  data class PostHeartbeat(val beatId: Int, val url: String, val bearer: String, val body: String) : Command {
    override fun toString(): String = "PostHeartbeat(beatId=$beatId, url=$url, bearer=<${bearer.length} chars>, body=$body)"
  }

  /**
   * Fetch the descriptor again with the session's `tok` (spec §1: on every reconnect), answered as
   * [Input.DescriptorChecked] with the same [requestId].
   */
  data class FetchDescriptor(val requestId: Int) : Command

  /** Tear the capture session down: stream, camera, foreground service. */
  data class End(val reason: EndReason) : Command

  /** A line for the session record. The engine routes it to [SessionRecord]; the platform never sees it. */
  data class Record(val entry: RecordEntry) : Command
}
