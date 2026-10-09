package com.seazn.capture.engine.core

/**
 * A beat's 2xx body (or a 410's), as the adapter read it (Task 15): `{state, sid?, startedBy?,
 * endReason?, …waiting fields}`. A field that is absent or unreadable is null. [waiting] is null
 * when the body did not carry every waiting field the parser requires.
 *
 * Final review I-2b: [waitingUnreadable] names the first waiting field the parser refused, when a 2xx
 * body owes them (its state requires them, or it sent any): a field name, never its value. Null when
 * they were read, or owed none, and on any answer outside 2xx, whose fields never land.
 */
data class BeatReply(
  val state: String?,
  val sid: String?,
  val startedBy: String?,
  val endReason: String?,
  val waiting: WaitingFields?,
  val waitingUnreadable: String? = null,
)

/**
 * The session shape's broadcast, as native alone ever holds it (amendment, _Who reads what_). The
 * credentials are already checked against the environment's ingest host. [fallback] is null when
 * the server offered RTMPS alone (A18). `toString` prints no secret: the targets' own do not.
 */
class BroadcastDescriptor(
  val primary: IngestTarget,
  val fallback: IngestTarget?,
  val holdWindowSeconds: Map<Transport, Int>,
  val playbackUrl: String,
  val label: String,
  val maxDurationMinutes: Int,
  val scoreUpdates: String,
  val warmingDeadlineEpochS: Long,
) {
  /** A18: false when the server sent no SRT, so the engine publishes RTMPS with no fallback. */
  val srtOffered: Boolean
    get() = primary.transport == Transport.SRT || fallback?.transport == Transport.SRT

  /** The secrets the record must never carry. Blank ones are no secret. */
  fun secrets(): List<String> =
    listOfNotNull(primary, fallback)
      .flatMap {
        when (it) {
          is SrtTarget -> listOf(it.passphrase, it.streamId)
          is RtmpsTarget -> listOf(it.streamKey)
        }
      }
      .filter { it.isNotBlank() }

  /** The SRT stream ids: secrets everywhere but inside a public URL, whose path may hold one. */
  fun streamIds(): List<String> = listOfNotNull(primary, fallback).filterIsInstance<SrtTarget>().map { it.streamId }

  /** Plan B's publish plan for broadcast [sid], with the pairing's token and beat URL. */
  fun config(sid: String, pairing: PairingState): SessionConfig =
    SessionConfig(sid, pairing.token, primary, fallback, holdWindowSeconds, playbackUrl, pairing.request.heartbeatUrl, pairing.phone.appVersion)

  override fun toString(): String = "BroadcastDescriptor(primary=$primary, fallback=$fallback, label=$label)"
}

/** The code's `GET` (the descriptor), as the adapter's parser read it (Task 15). */
sealed interface CodeAnswer {
  /** 2xx session shape, `warming` or `live`, with `cred` on the ingest host. */
  data class Open(
    val sid: String,
    val state: String,
    val descriptor: BroadcastDescriptor,
    val waiting: WaitingFields?,
    /** Final review I-2b: the first waiting field the parser refused, as [BeatReply.waitingUnreadable]; the broadcast still opens. */
    val waitingUnreadable: String? = null,
  ) : CodeAnswer

  /** 2xx session shape in `ending`, `completed` or `failed`. */
  data class Over(val sid: String, val endReason: String?) : CodeAnswer

  /** 2xx waiting shape: no broadcast is open. */
  data class Waiting(val waiting: WaitingFields) : CodeAnswer

  /** 2xx session shape with no `cred`: this phone is not the slot's current phone yet (2026-10-01). */
  data class NotCurrent(val sid: String) : CodeAnswer

  /** 2xx session shape whose `cred` points off the ingest host: refused, never published to. */
  data class ForeignIngest(val sid: String) : CodeAnswer

  /** 2xx that no rule can read. [problem] names a field or a reason, never a value. */
  data class Unreadable(val problem: String) : CodeAnswer

  /** Any other status. [retryAfterS] for a 429; [endReason] from a 410's body. */
  data class Status(val status: Int, val retryAfterS: Int?, val endReason: String?) : CodeAnswer

  /**
   * No HTTP answer at all, or a 2xx whose body is no JSON object (a captive portal's page, I1): either
   * way not the server's word, and fetched again. [message] is a reason, never a body.
   */
  data class Unreachable(val message: String) : CodeAnswer
}

/** `POST start`'s answer (amendment, _Contract shapes_). */
sealed interface StartAnswer {
  data class Started(val sid: String) : StartAnswer

  /** `409 already_live`: take that broadcast over. */
  data class AlreadyLive(val sid: String, val startedBy: String?) : StartAnswer

  /** `409 replaced`: this phone no longer holds the slot. */
  data object Replaced : StartAnswer

  /** 401 `code_ended`: the code is expired or revoked, and the phone forgets it, as on a beat's 401 (amendment:41, D5). */
  data object CodeEnded : StartAnswer

  /**
   * A refusal body `{code, message, …}`: `409 no_destination`, `402 no_credit`, `403 not_entitled`,
   * or a code the phone does not know ([Refusal.UNKNOWN]). [message] is the server's, for the record.
   */
  data class Refused(val refusal: Refusal, val message: String? = null) : StartAnswer

  /** No answer, 404, 422, 429, 5xx, or a body no rule can read. [detail] is a status or a reason, never a value. */
  data class Failed(val detail: String) : StartAnswer
}
