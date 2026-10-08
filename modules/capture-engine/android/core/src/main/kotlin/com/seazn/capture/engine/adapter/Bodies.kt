package com.seazn.capture.engine.adapter

import com.seazn.capture.engine.core.BeatReply
import com.seazn.capture.engine.core.BroadcastDescriptor
import com.seazn.capture.engine.core.CodeAnswer
import com.seazn.capture.engine.core.Environment
import com.seazn.capture.engine.core.HeartbeatResponse
import com.seazn.capture.engine.core.Hosts
import com.seazn.capture.engine.core.IngestTarget
import com.seazn.capture.engine.core.Refusal
import com.seazn.capture.engine.core.RtmpsTarget
import com.seazn.capture.engine.core.ScoreUpdates
import com.seazn.capture.engine.core.ServerWord
import com.seazn.capture.engine.core.SrtTarget
import com.seazn.capture.engine.core.StartAnswer
import com.seazn.capture.engine.core.Transport
import com.seazn.capture.engine.core.WaitingFields
import com.seazn.capture.engine.core.characters

/**
 * The server's bodies, read where they are acted on (amendment, _Who reads what_): GET code's session
 * shape, a beat's answer and `POST start`'s answer, as the web published them (capture-descriptor.v1,
 * capture-beat.v1 and capture-start.v1, web 7e75fd4a7). `cred` is read here and nowhere else, and only
 * onto the ingest host ([Hosts.onIngest]). Never throws.
 *
 * What the engine echoes or branches on is held to the schema: every sid matches the schema's uuid
 * pattern (the core echoes it on every beat, and the server refuses any other with a 422), and every
 * word is one of the schema's closed set, or null. Every bound the schema states is held too, lengths
 * in characters (code points, as JSON Schema counts them); what it cannot state, the engine judges
 * (`SessionConfig.problems`). A problem names a field, never a value: the record may carry it.
 *
 * A 2xx whose body is no JSON object is not the server's (I1): a captive portal's sign-in page at the
 * ground, or a body cut short. It is no answer at all — transient on the code, the beat and the start —
 * never a bad config and never the server's word. A JSON object that breaks a rule is the server's.
 *
 * The same holds for a status that ends something (X1): a 401 forgets the code, a 404 refuses S and a
 * 410 ends the held broadcast, so each is read only from the server's refusal (`$defs.refusal`, which
 * the server always sends), and a 401 or 404 only from the one naming it. An edge's page, an empty body,
 * no `code` or another word under any of them is no answer, and ends nothing.
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
   * `POST start` statuses that fail the start whatever their `code` (amendment, the answer table; D7,
   * D18): 404 `not_a_stream_code`, 422 `invalid` and 429 `rate_limited`. A 5xx fails it too. A start is
   * the operator's to try again: no Retry-After. A 401 is not here: the server's `code_ended` ends the
   * code (D5), and any other 401 fails the start (X1).
   */
  private val START_FAILS = setOf(404, 422, 429)

  /** Why a 2xx is no answer: its body is no JSON object. A literal, never the body: the record carries it. */
  private const val NOT_JSON = "not-json"

  /**
   * X1: the statuses that end something, each with the one word that says so (amendment, the answer
   * table): a 401 forgets the code, a 404 refuses S. A 410 ends the held broadcast and delivers a stopped
   * record (N1); neither route sends one (ask 8), so it names no word (null): any refusal's will do, and
   * an `endReason` alone is none. A start's 404 and 410 end nothing, so a start holds only its 401 to this.
   */
  private val ENDING: Map<Int, String?> = mapOf(401 to "code_ended", 404 to "not_a_stream_code", 410 to null)

  /** Why a 401, 404 or 410 is no answer: its body is not the server's refusal. A literal, never the body. */
  private const val NOT_REFUSAL = "not-refusal"

  /** capture-descriptor.v1's bounds. Lengths are in characters (code points). */
  private val LABEL = 1..200
  private val ZONE = 1..64
  private val DESTINATION = 1..80

  /** capture-descriptor.v1 `stage.label`: 1 to 40 characters, in code points. */
  private val STAGE_LABEL = 1..40
  private val POLL = 5..300
  private val HOLD = 1..999

  /**
   * `stage.role.kind`'s values (R-F20): the contract's description lists them and calls the string OPEN, and says
   * consumers show nothing for any other. `wire/stage-kinds.json` is the authority; BodiesTest holds this set to it
   * and `stageKinds.test.ts` holds the file to the contract. Internal for that test.
   */
  internal val STAGE_KINDS =
    setOf(
      "round_of", "quarter_final", "semi_final", "final", "winners_final", "losers_round", "losers_final", "grand_final",
      "grand_final_reset", "third_place", "qualifier1", "eliminator", "qualifier2", "rung", "plain_round",
    )

  /** The schemas' integer ceiling, JS's largest safe integer (2^53 - 1). */
  private const val MAX_SAFE = 9_007_199_254_740_991L

  /**
   * The one SRT shape the platform connects: `srt://host:port` and nothing after (it reads the URL with
   * `java.net.URI` and composes the query itself). The host is [Hosts.onIngest]'s to judge; the scheme's
   * letters are ASCII, both cases listed, as [Hosts] lists them.
   */
  private val SRT_URL = Regex("[Ss][Rr][Tt]://[^/?#@:]+:([0-9]{1,5})")

  /** The sid's `pattern` in all three schemas, ASCII classes spelled out, matched whole. */
  private val UUID =
    Regex(
      "[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}" +
        "|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff"
    )

  /** HTTP's delay-seconds: ASCII digits. Kotlin's `toIntOrNull` alone also reads a sign and fullwidth digits. */
  private val DIGITS = Regex("[0-9]+")

  /**
   * capture-beat.v1 `$defs.answer`: the states the waiting fields are required on. On `replaced` and `taken`
   * they are optional, so a body that sends none of [WAITING_KEYS] owes none.
   */
  private val WAITING_OWED = setOf("waiting", "go-live", "live", "over")

  /** The waiting fields' keys, in the order [read] judges them: the first refused is the one named. */
  private val WAITING_KEYS = listOf("label", "autoAllowed", "pollSeconds", "venueTimezone", "scheduledStart", "destinationName", "overlayUrl")

  /** Final review I-2b: the waiting fields, or the first one refused: a field name, never its value. */
  private data class WaitingRead(val fields: WaitingFields?, val unreadable: String?)

  /** A field the schema lets be absent or null: [Absent], its [Value], or [Bad] (the wrong type, or out of bounds). */
  private sealed interface Field<out T> {
    data object Absent : Field<Nothing>

    data object Bad : Field<Nothing>

    data class Value<T>(val value: T) : Field<T>
  }

  /**
   * The waiting fields of a 2xx, beat or code. A field absent or null where the schema allows it is
   * null; a field of the wrong type, or outside the schema's bounds, makes the whole null; an overlay
   * off the build's Seazn host is dropped alone. D4: a beat's answer has no `venueTimezone`, so it is
   * not required, and absent is "" (the engine keeps the zone it holds). `scheduledStart` is omitted by
   * the descriptor and null on a beat: both are null.
   */
  fun waiting(fields: Map<String, Any?>, env: Environment): WaitingFields? = read(fields, env).fields

  /** [waiting], naming the first field refused (final review I-2b). Each field is judged in [WAITING_KEYS]' order. */
  private fun read(fields: Map<String, Any?>, env: Environment): WaitingRead {
    fun unreadable(field: String) = WaitingRead(null, field)
    val label = text(fields["label"], LABEL) ?: return unreadable("label")
    val auto = fields["autoAllowed"] as? Boolean ?: return unreadable("autoAllowed")
    val poll = WireValues.int(fields["pollSeconds"])?.takeIf { it in POLL } ?: return unreadable("pollSeconds")
    val zone = optional(fields["venueTimezone"]) { text(it, ZONE) }
    val start = optional(fields["scheduledStart"]) { epoch -> whole(epoch)?.takeIf { it in 1..MAX_SAFE } }
    val destination = optional(fields["destinationName"]) { text(it, DESTINATION) }
    val overlay = optional(fields["overlayUrl"]) { it as? String }
    val optionals = listOf("venueTimezone" to zone, "scheduledStart" to start, "destinationName" to destination, "overlayUrl" to overlay)
    optionals.firstOrNull { it.second is Field.Bad }?.let { return unreadable(it.first) }
    val seazn = overlay.orNull()?.takeIf { Hosts.onSeazn(it, env) }
    val stage = stageLabel(fields["stage"])
    return WaitingRead(WaitingFields(label, zone.orNull() ?: "", start.orNull(), auto, destination.orNull(), seazn, poll, stage, stage?.let { label }), null)
  }

  /**
   * capture-descriptor.v1 `stage` (W28): its `label`, shown verbatim, 1 to 40 characters in code points, but only
   * when `role.kind` is one the contract names ([STAGE_KINDS]); an unknown kind, no `role` or a kind that is not a
   * string shows no line, even with a good label (R-F20). Display only, so anything else, a null, a non-object, a
   * label of 0 or over 40, is no stage and never makes the waiting fields unreadable; that is why `stage` is not in
   * [WAITING_KEYS]. `code`, `role.n`, `role.entrants` and `pool` are not read: the server renders the whole line.
   */
  private fun stageLabel(value: Any?): String? {
    val stage = value as? Map<*, *> ?: return null
    val kind = (stage["role"] as? Map<*, *>)?.get("kind") as? String ?: return null
    if (kind !in STAGE_KINDS) return null
    return (stage["label"] as? String)?.takeIf { it.characters in STAGE_LABEL }
  }

  /** A beat's waiting fields, and the field refused when the body owed them ([WAITING_OWED], or any sent). */
  private fun beatWaiting(fields: Map<String, Any?>, state: String?, env: Environment): WaitingRead {
    val read = read(fields, env)
    val owed = state in WAITING_OWED || WAITING_KEYS.any(fields::containsKey)
    return if (owed) read else read.copy(unreadable = null)
  }

  /**
   * Final review I-2: whether [body] names an `overlayUrl` off the build's Seazn host, which [waiting] and [code]
   * drop. The drop reaches JS as no overlay, the server's answer for an org not entitled to one, so this is how
   * the record tells the two apart (`overlay-refused`). Not JSON, or no overlay named: false.
   */
  fun foreignOverlay(body: String, env: Environment): Boolean {
    val named = obj(body)?.get("overlayUrl") as? String ?: return false
    return !Hosts.onSeazn(named, env)
  }

  fun code(status: Int, body: String, retryAfterS: Int?, env: Environment): CodeAnswer {
    if (status !in 200..299) {
      val fields = obj(body)
      if (unconfirmed(status, fields)) return CodeAnswer.Unreachable(notRefusal(status))
      val endReason = if (status == 410) word(fields?.get("endReason"), END_REASONS) else null
      return CodeAnswer.Status(status, retryAfterS.takeIf { status == 429 }, endReason)
    }
    val fields = obj(body) ?: return CodeAnswer.Unreachable(NOT_JSON)
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
    if (!Hosts.onIngest(rtmps.url, "rtmps") || (srt != null && !Hosts.onIngest(srt.url, "srt"))) return CodeAnswer.ForeignIngest(sid)
    if (srt != null && !srtShaped(srt.url)) return CodeAnswer.Unreadable("cred.srt")
    val holds = holds(fields["holdWindowSeconds"])
    if (listOfNotNull(primary, fallback).any { it.transport !in holds }) return CodeAnswer.Unreadable("holdWindowSeconds")
    return broadcast(sid, state, Pair(primary, fallback), holds, fields, env)
  }

  /** The rest of an open session shape, once its targets are judged. */
  private fun broadcast(
    sid: String,
    state: String,
    targets: Pair<IngestTarget, IngestTarget?>,
    holds: Map<Transport, Int>,
    fields: Map<String, Any?>,
    env: Environment,
  ): CodeAnswer {
    val descriptor =
      BroadcastDescriptor(
        primary = targets.first,
        fallback = targets.second,
        holdWindowSeconds = holds,
        playbackUrl = filled(fields["playbackUrl"]) ?: return CodeAnswer.Unreadable("playbackUrl"),
        overlayUrl = (fields["overlayUrl"] as? String)?.takeIf { Hosts.onSeazn(it, env) },
        // Shown, never acted on: outside the schema's 1 to 200 characters it is "", and the broadcast still opens.
        label = text(fields["label"], LABEL) ?: "",
        maxDurationMinutes = WireValues.int(fields["maxDurationMinutes"])?.takeIf { it >= 1 } ?: return CodeAnswer.Unreadable("maxDurationMinutes"),
        // A closed set: any other word is "", which the snapshot crosses as null, for this field alone.
        scoreUpdates = ScoreUpdates.of(fields["scoreUpdates"] as? String)?.wire ?: "",
        warmingDeadlineEpochS = whole(fields["warmingDeadline"]) ?: 0,
      )
    val waiting = read(fields, env)
    return CodeAnswer.Open(sid, state, descriptor, waiting.fields, waiting.unreadable)
  }

  /**
   * Any status. A 2xx's body is the answer, unless it is no JSON object: then it is no answer (I1),
   * counted failed, so the claim and the stopped record ride the next beat. So is a 401 or 404 that is
   * not the server's refusal naming it, or a 410 that is not the server's refusal (X1, N1). A 410's
   * refusal carries its `endReason`, and only a 429 keeps Retry-After.
   */
  fun beat(status: Int, body: String, retryAfterS: Int?, env: Environment): HeartbeatResponse {
    val fields = obj(body)
    if (fields == null && status in 200..299) return HeartbeatResponse.Failed(NOT_JSON)
    if (unconfirmed(status, fields)) return HeartbeatResponse.Failed(notRefusal(status))
    val state = word(fields?.get("state"), BEAT_STATES)
    val waiting = fields?.let { beatWaiting(it, state, env) }
    val reply =
      BeatReply(
        state = state,
        sid = uuid(fields?.get("sid")),
        startedBy = word(fields?.get("startedBy"), STARTED_BY),
        endReason = word(fields?.get("endReason"), END_REASONS),
        waiting = waiting?.fields,
        // Only a 2xx's waiting fields land (the machine's rule), so only a 2xx's refused one is named.
        waitingUnreadable = waiting?.unreadable?.takeIf { status in 200..299 },
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
      status in 200..299 -> if (fields == null) StartAnswer.Failed(NOT_JSON) else sid?.let { StartAnswer.Started(it) } ?: failed
      status == 401 -> if (unconfirmed(status, fields)) StartAnswer.Failed(notRefusal(status)) else StartAnswer.CodeEnded
      status == 409 && code == "already_live" -> sid?.let { StartAnswer.AlreadyLive(it, word(fields?.get("startedBy"), STARTED_BY)) } ?: failed
      status == 409 && code == "replaced" -> StartAnswer.Replaced
      status in START_FAILS -> failed
      status in 400..499 && code != null -> StartAnswer.Refused(Refusal.of(code), fields?.get("message") as? String)
      else -> failed
    }
  }

  /** capture-scoring-link.v1 `$defs.ok.url`: the server's https origin, `/score/`, and `dl_` with 43 base64url characters. */
  private val SCORING_URL = Regex("https://[^/]+/score/dl_[A-Za-z0-9_-]{43}")

  /**
   * A tap's answer (spec §10, web ask W27). By status and `code`, like [start]: a 401 or 404 only from the
   * server's refusal naming it (X1), so a captive portal's page is unavailable, never "code ended". A 2xx is
   * a link only when its `url` is exactly the contract's shape on the build's own Seazn host: anything else
   * is no link and is never shown as a QR. The URL is a credential, so nothing here prints it.
   */
  fun scoringLink(status: Int, body: String, retryAfterS: Int?, env: Environment): ScoringLinkAnswer {
    val fields = obj(body)
    val code = fields?.get("code") as? String
    val none = ScoringLinkAnswer.Refused("unavailable", null)
    return when {
      status in 200..299 -> {
        val url = (fields?.get("url") as? String)?.takeIf { SCORING_URL.matches(it) && Hosts.onSeazn(it, env) }
        url?.let { ScoringLinkAnswer.Link(it) } ?: none
      }
      status == 401 || status == 404 -> if (unconfirmed(status, fields)) none else ScoringLinkAnswer.Refused("code_ended", null)
      status == 409 && code == "replaced" -> ScoringLinkAnswer.Refused("replaced", null)
      status == 409 && code == "match_finished" -> ScoringLinkAnswer.Refused("match_finished", null)
      status == 402 && code == "not_entitled" -> ScoringLinkAnswer.Refused("not_entitled", null)
      status == 429 && code == "rate_limited" -> ScoringLinkAnswer.Refused("rate_limited", retryAfterS)
      else -> none
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

  /** X1: [status] ends something, and [fields] is not the server's refusal: no `code`, or not the word [ENDING] names. */
  private fun unconfirmed(status: Int, fields: Map<String, Any?>?): Boolean {
    if (status !in ENDING) return false
    val code = fields?.get("code") as? String ?: return true
    return ENDING[status]?.let { it != code } ?: false
  }

  private fun notRefusal(status: Int): String = "$status-$NOT_REFUSAL"

  private fun uuid(value: Any?): String? = (value as? String)?.takeIf { UUID.matches(it) }

  private fun word(value: Any?, words: Set<String>): String? = (value as? String)?.takeIf { it in words }

  /** A JSON number a Long holds exactly; a fraction, a number past Long's edges or anything else is null. */
  private fun whole(value: Any?): Long? = (value as? Double)?.let { d -> d.toLong().takeIf { it.toDouble() == d } }

  /** [Field.Absent] when [value] is absent or null; [read]'s value; or [Field.Bad] when [read] refuses it. */
  private inline fun <T : Any> optional(value: Any?, read: (Any) -> T?): Field<T> =
    if (value == null) Field.Absent else read(value)?.let { Field.Value(it) } ?: Field.Bad

  private fun <T> Field<T>.orNull(): T? = (this as? Field.Value<T>)?.value

  /** A string of [length] characters (code points, as JSON Schema counts them), or null. */
  private fun text(value: Any?, length: IntRange): String? = (value as? String)?.takeIf { it.characters in length }

  /** A string the schema requires to be non-empty (`minLength: 1`); empty is none. */
  private fun filled(value: Any?): String? = (value as? String)?.takeIf { it.isNotEmpty() }

  private fun srtShaped(url: String): Boolean = SRT_URL.matchEntire(url)?.groupValues?.get(1)?.toInt() in 1..65_535

  private fun srt(value: Any?): SrtTarget? {
    val map = value as? Map<*, *> ?: return null
    return SrtTarget(
      filled(map["url"]) ?: return null,
      filled(map["streamId"]) ?: return null,
      filled(map["passphrase"]) ?: return null,
      WireValues.int(map["latencyMs"])?.takeIf { it >= 1 } ?: return null,
    )
  }

  private fun rtmps(value: Any?): RtmpsTarget? {
    val map = value as? Map<*, *> ?: return null
    return RtmpsTarget(filled(map["url"]) ?: return null, filled(map["streamKey"]) ?: return null)
  }

  /** The windows within the schema's 1 to 999 s. Any other is no window, so a transport offered without one is refused. */
  private fun holds(value: Any?): Map<Transport, Int> {
    val map = value as? Map<*, *> ?: return emptyMap()
    return Transport.entries.mapNotNull { t -> WireValues.int(map[t.wire])?.takeIf { it in HOLD }?.let { t to it } }.toMap()
  }
}
