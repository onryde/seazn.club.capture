package com.seazn.capture.engine.adapter

import com.seazn.capture.engine.core.BeatReply
import com.seazn.capture.engine.core.BroadcastDescriptor
import com.seazn.capture.engine.core.CodeAnswer
import com.seazn.capture.engine.core.Environment
import com.seazn.capture.engine.core.HeartbeatResponse
import com.seazn.capture.engine.core.Hosts
import com.seazn.capture.engine.core.Refusal
import com.seazn.capture.engine.core.RtmpsTarget
import com.seazn.capture.engine.core.ScoreUpdates
import com.seazn.capture.engine.core.ServerWord
import com.seazn.capture.engine.core.SrtTarget
import com.seazn.capture.engine.core.StartAnswer
import com.seazn.capture.engine.core.Transport
import com.seazn.capture.engine.core.WaitingFields

/**
 * The server's bodies, read where they are acted on (amendment, _Who reads what_): GET code's session
 * shape, a beat's answer and `POST start`'s answer, as the web published them (capture-descriptor.v1,
 * capture-beat.v1 and capture-start.v1, web 09e87aabd). `cred` is read here and nowhere else, and only
 * onto the ingest host ([Hosts.onIngest]). Never throws.
 *
 * What the engine echoes or branches on is held to the schema: every sid matches the schema's uuid
 * pattern (the core echoes it on every beat, and the server refuses any other with a 422), and every
 * word is one of the schema's closed set, or null. Everything else is read as sent, and the engine
 * judges it ([com.seazn.capture.engine.core.BeatCadence], `SessionConfig.problems`). A problem names a
 * field, never a value: the record may carry it.
 */
object Bodies {
  private val OPEN = setOf("warming", "live")

  /** capture-beat.v1 `$defs.answer`'s states. */
  private val BEAT_STATES = setOf("waiting", "go-live", "live", "over", "replaced", "taken")

  /** `startedBy` on a beat's `go-live` and a start's `already_live`. */
  private val STARTED_BY = setOf("organiser", "automatic", "operator")

  /** The server's `endReason`, one vocabulary for the beat and the descriptor. */
  private val END_REASONS = setOf("stopped", "auto_stopped", "no_inbound_timeout", "target_rejected", "max_duration", "phone_lost", "failed")

  /**
   * `POST start` statuses that fail the start whatever their `code` (amendment, the answer table; D5,
   * D7, D18): 401 `code_ended` (the next beat's 401 unpairs), 404 `not_a_stream_code`, 422 `invalid`
   * and 429 `rate_limited`. A 5xx fails it too. A start is the operator's to try again: no Retry-After.
   */
  private val START_FAILS = setOf(401, 404, 422, 429)

  /** The sid's `pattern` in all three schemas, ASCII classes spelled out, matched whole. */
  private val UUID =
    Regex(
      "[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}" +
        "|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff"
    )

  /** HTTP's delay-seconds: ASCII digits. Kotlin's `toIntOrNull` alone also reads a sign and fullwidth digits. */
  private val DIGITS = Regex("[0-9]+")

  /** A field the schema lets be null, sent with the wrong type. */
  private val BAD = Any()

  /**
   * The waiting fields of a 2xx, beat or code. A field absent or null where the schema allows it is
   * null; a field of the wrong type makes the whole null; an overlay off the build's Seazn host is
   * dropped alone. D4: a beat's answer has no `venueTimezone`, so it is not required, and absent is "".
   * `scheduledStart` is omitted by the descriptor and null on a beat: both are null.
   */
  fun waiting(fields: Map<String, Any?>, env: Environment): WaitingFields? {
    val label = fields["label"] as? String ?: return null
    val auto = fields["autoAllowed"] as? Boolean ?: return null
    val poll = WireValues.int(fields["pollSeconds"]) ?: return null
    val zone = nullable(fields["venueTimezone"]) { it as? String }
    val start = nullable(fields["scheduledStart"], ::whole)
    val destination = nullable(fields["destinationName"]) { it as? String }
    val overlay = nullable(fields["overlayUrl"]) { it as? String }
    if (listOf(zone, start, destination, overlay).any { it === BAD }) return null
    val seazn = (overlay as String?)?.takeIf { Hosts.onSeazn(it, env) }
    return WaitingFields(label, zone as String? ?: "", start as Long?, auto, destination as String?, seazn, poll)
  }

  fun code(status: Int, body: String, retryAfterS: Int?, env: Environment): CodeAnswer {
    if (status !in 200..299) {
      val endReason = if (status == 410) word(obj(body)?.get("endReason"), END_REASONS) else null
      return CodeAnswer.Status(status, retryAfterS.takeIf { status == 429 }, endReason)
    }
    val fields = obj(body) ?: return CodeAnswer.Unreadable("body")
    val state = fields["state"] as? String ?: return CodeAnswer.Unreadable("state")
    if (state == "waiting") return waiting(fields, env)?.let { CodeAnswer.Waiting(it) } ?: CodeAnswer.Unreadable("waiting")
    val sid = uuid(fields["sid"]) ?: return CodeAnswer.Unreadable("sid")
    return when {
      state in ServerWord.OVER_STATES -> CodeAnswer.Over(sid, word(fields["endReason"], END_REASONS))
      state !in OPEN -> CodeAnswer.Unreadable("state")
      fields["cred"] == null -> CodeAnswer.NotCurrent(sid)
      else -> open(sid, state, fields, env)
    }
  }

  private fun open(sid: String, state: String, fields: Map<String, Any?>, env: Environment): CodeAnswer {
    val cred = fields["cred"] as? Map<*, *> ?: return CodeAnswer.Unreadable("cred")
    val srt = cred["srt"]?.let { srt(it) ?: return CodeAnswer.Unreadable("cred.srt") }
    val rtmps = rtmps(cred["rtmps"]) ?: return CodeAnswer.Unreadable("cred.rtmps")
    // A18: SRT may be absent only with RTMPS preferred.
    val (primary, fallback) =
      when {
        fields["preferred"] == "rtmps" -> rtmps to srt
        fields["preferred"] == "srt" && srt != null -> srt to rtmps
        else -> return CodeAnswer.Unreadable("preferred")
      }
    if (!Hosts.onIngest(rtmps.url, "rtmps", env) || (srt != null && !Hosts.onIngest(srt.url, "srt", env))) return CodeAnswer.ForeignIngest(sid)
    val holds = holds(fields["holdWindowSeconds"])
    if (listOfNotNull(primary, fallback).any { it.transport !in holds }) return CodeAnswer.Unreadable("holdWindowSeconds")
    val descriptor =
      BroadcastDescriptor(
        primary = primary,
        fallback = fallback,
        holdWindowSeconds = holds,
        playbackUrl = fields["playbackUrl"] as? String ?: return CodeAnswer.Unreadable("playbackUrl"),
        overlayUrl = (fields["overlayUrl"] as? String)?.takeIf { Hosts.onSeazn(it, env) },
        label = fields["label"] as? String ?: "",
        maxDurationMinutes = WireValues.int(fields["maxDurationMinutes"]) ?: return CodeAnswer.Unreadable("maxDurationMinutes"),
        // A closed set: any other word is "", which the snapshot crosses as null, for this field alone.
        scoreUpdates = ScoreUpdates.of(fields["scoreUpdates"] as? String)?.wire ?: "",
        warmingDeadlineEpochS = whole(fields["warmingDeadline"]) ?: 0,
      )
    return CodeAnswer.Open(sid, state, descriptor, waiting(fields, env))
  }

  /** Any status: a 2xx's body is the answer, a 410's carries its `endReason`, and only a 429 keeps Retry-After. */
  fun beat(status: Int, body: String, retryAfterS: Int?, env: Environment): HeartbeatResponse.Answered {
    val fields = obj(body)
    val reply =
      BeatReply(
        state = word(fields?.get("state"), BEAT_STATES),
        sid = uuid(fields?.get("sid")),
        startedBy = word(fields?.get("startedBy"), STARTED_BY),
        endReason = word(fields?.get("endReason"), END_REASONS),
        waiting = fields?.let { waiting(it, env) },
      )
    return HeartbeatResponse.Answered(status, reply, retryAfterS.takeIf { status == 429 })
  }

  /**
   * By status and `code`. A refusal's line is its `code`'s, never its status's (amendment §2): any
   * other 4xx with a `code` is [Refusal.of]'s, so an unknown one is [Refusal.UNKNOWN], "Can't go live —
   * ask the organiser", its `message` for the record.
   */
  fun start(status: Int, body: String): StartAnswer {
    val fields = obj(body)
    val code = fields?.get("code") as? String
    val sid = uuid(fields?.get("sid"))
    val failed = StartAnswer.Failed("$status")
    return when {
      status in 200..299 -> sid?.let { StartAnswer.Started(it) } ?: failed
      status == 409 && code == "already_live" -> sid?.let { StartAnswer.AlreadyLive(it, word(fields?.get("startedBy"), STARTED_BY)) } ?: failed
      status == 409 && code == "replaced" -> StartAnswer.Replaced
      status in START_FAILS -> failed
      status in 400..499 && code != null -> StartAnswer.Refused(Refusal.of(code), fields?.get("message") as? String)
      else -> failed
    }
  }

  /** Whole seconds, 0 or more; an HTTP-date or anything else is no value (the engine uses its own cadence). */
  fun retryAfter(header: String?): Int? = header?.trim()?.takeIf { DIGITS.matches(it) }?.toIntOrNull()

  @Suppress("UNCHECKED_CAST")
  private fun obj(body: String): Map<String, Any?>? =
    try {
      JsonReader.parse(body) as? Map<String, Any?>
    } catch (_: JsonReader.Malformed) {
      null
    }

  private fun uuid(value: Any?): String? = (value as? String)?.takeIf { UUID.matches(it) }

  private fun word(value: Any?, words: Set<String>): String? = (value as? String)?.takeIf { it in words }

  /** A JSON number a Long holds exactly; a fraction, a number past Long's edges or anything else is null. */
  private fun whole(value: Any?): Long? = (value as? Double)?.let { d -> d.toLong().takeIf { it.toDouble() == d } }

  /** Null when [value] is absent or null; [read]'s value; or [BAD] when [read] refuses it. */
  private inline fun nullable(value: Any?, read: (Any) -> Any?): Any? = if (value == null) null else read(value) ?: BAD

  private fun srt(value: Any?): SrtTarget? {
    val map = value as? Map<*, *> ?: return null
    return SrtTarget(
      map["url"] as? String ?: return null,
      map["streamId"] as? String ?: return null,
      map["passphrase"] as? String ?: return null,
      WireValues.int(map["latencyMs"]) ?: return null,
    )
  }

  private fun rtmps(value: Any?): RtmpsTarget? {
    val map = value as? Map<*, *> ?: return null
    return RtmpsTarget(map["url"] as? String ?: return null, map["streamKey"] as? String ?: return null)
  }

  private fun holds(value: Any?): Map<Transport, Int> {
    val map = value as? Map<*, *> ?: return emptyMap()
    return Transport.entries.mapNotNull { t -> WireValues.int(map[t.wire])?.let { t to it } }.toMap()
  }
}
