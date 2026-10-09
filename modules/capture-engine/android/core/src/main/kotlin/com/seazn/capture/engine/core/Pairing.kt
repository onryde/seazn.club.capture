package com.seazn.capture.engine.core

/** Why this phone claims the slot (A9): a scan or Continue, or the cold-start re-pair. */
enum class Claim(override val wire: String) : Wire {
  NEW("new"),
  RESUME("resume"),
}

/** Who started the broadcast held (the beat's `cause`). A rejoin is the phone's own word (A10). */
enum class Cause(override val wire: String) : Wire {
  ORGANISER("organiser"),
  AUTOMATIC("automatic"),
  OPERATOR("operator"),
  REJOIN("rejoin");

  companion object {
    /** A `go-live`'s `startedBy`. Absent or unknown reads as the organiser's: the console is the default starter. */
    fun startedBy(word: String?): Cause = entries.firstOrNull { it != REJOIN && it.wire == word } ?: ORGANISER
  }
}

/** Why a start waits (A11), in the status line's order. */
enum class NotReady(override val wire: String) : Wire {
  CAMERA("camera"),
  SOUND("sound"),
  NETWORK("network"),
  HELD("held"),
}

/** Why the last start failed (the beat's `startFailed`, amendment _Start failures_). */
enum class StartFailure(override val wire: String) : Wire {
  NOT_FOUND("not-found"),
  CRED_HOST("cred-host"),
  CONFIG("config"),
  START_ERROR("start-error"),
}

/**
 * The snapshot's `refusal`: the server's refusal to `POST start` (its body's `code`), or any failed
 * start. A refusal `code` the phone does not know is [UNKNOWN], with its own generic line; the body's
 * `message` goes to the record only, never to the screen (it is not translated).
 */
enum class Refusal(override val wire: String) : Wire {
  NO_DESTINATION("no_destination"),
  NO_CREDIT("no_credit"),
  NOT_ENTITLED("not_entitled"),
  UNKNOWN("unknown"),
  START_FAILED("start-failed");

  companion object {
    /** A refusal body's `code`; any code not listed is [UNKNOWN]. */
    fun of(code: String?): Refusal = entries.firstOrNull { it != UNKNOWN && it != START_FAILED && it.wire == code } ?: UNKNOWN
  }
}

/** Why the last broadcast ended without the operator (the snapshot's `lastEnd`). */
enum class LastEnd(override val wire: String) : Wire {
  STOPPED_BY_ORGANISER("stopped-by-organiser"),
  STOPPED_AUTOMATICALLY("stopped-automatically"),
  NO_SIGNAL("no-signal"),
  DESTINATION_REFUSED("destination-refused"),
  MAX_DURATION("max-duration"),
  PHONE_LOST("phone-lost"),
  ENDED_BY_SEAZN("ended-by-seazn"),
  HOLD_WINDOW_EXPIRED("hold-window-expired"),
  STOPPED("stopped");

  companion object {
    private val SERVER =
      mapOf(
        "stopped" to STOPPED_BY_ORGANISER,
        "auto_stopped" to STOPPED_AUTOMATICALLY,
        "no_inbound_timeout" to NO_SIGNAL,
        "target_rejected" to DESTINATION_REFUSED,
        "max_duration" to MAX_DURATION,
        "phone_lost" to PHONE_LOST,
        "failed" to ENDED_BY_SEAZN,
      )

    /** The server's snake_case `endReason`; anything else, or none, is [STOPPED]. */
    fun of(serverEndReason: String?): LastEnd = SERVER[serverEndReason] ?: STOPPED
  }
}

/** Why the engine left a pairing the operator did not end (the snapshot's `unpaired.reason`). */
enum class UnpairReason(override val wire: String) : Wire {
  CODE_ENDED("code-ended"),
  REPLACED("replaced"),
  TAKEN("taken"),
  PERMISSIONS("permissions"),
}

/** What names a pairing to JS (plan A's `sameCode`, moved to the pairing): never the token. */
data class PairingName(val code: String, val slot: Int, val tokenTag: String)

data class Unpaired(val reason: UnpairReason, val name: PairingName)

/** What the phone says about itself, read by the glue: the install's id (A9), the app's version, `Build.MODEL`. */
data class PhoneFacts(val phoneId: String, val appVersion: String, val model: String) {
  /**
   * `capture-beat.v1` requires `phone` (16 to 64 characters) and `appVersion` (1 to 40) on every beat,
   * with no null, so a beat cannot repair them: a bad one refuses the pair, before any beat goes.
   */
  fun problems(): List<String> = buildList {
    if (phoneId.characters !in 16..64) add("phone id is not 16 to 64 characters")
    if (appVersion.characters !in 1..40) add("app version is not 1 to 40 characters")
  }
}

/**
 * The fields the server sends on every 2xx answer, beat or code (amendment, _Contract shapes_).
 * [pollSeconds] is the server's, unclamped: [BeatCadence] clamps it where it is used.
 */
data class WaitingFields(
  val label: String,
  val venueTimezone: String,
  val scheduledStartEpochS: Long?,
  val autoAllowed: Boolean,
  val destinationName: String?,
  val pollSeconds: Int,
  /** The descriptor's `stage.label` (W28), shown verbatim as the round line; null when none, unreadable or of a kind the contract does not name. Display only. */
  val stageLabel: String? = null,
  /** The match [label] the stage was read with: a stage is only true of that match (the code is stable, so a beat can move the label). */
  val stageFor: String? = null,
) {
  /**
   * These fields over the ones [held]: the venue's zone is the engine's to keep. A beat's answer carries
   * none (D4, read as ""), so an empty zone keeps the one held; any other replaces it.
   */
  fun over(held: WaitingFields): WaitingFields = if (venueTimezone.isEmpty()) copy(venueTimezone = held.venueTimezone) else this

  /**
   * A beat's answer over what is held. The beat carries no `stage` (capture-beat.v1), so the held stage
   * stays while this answer's [label] is the match it was read with, and goes when the label moved: the
   * stable code may now point at the next match, and the old round line would be a wrong fact on the tripod.
   */
  fun overBeat(held: WaitingFields): WaitingFields {
    val merged = over(held)
    val still = held.stageLabel != null && held.stageFor == label
    return merged.copy(stageLabel = held.stageLabel.takeIf { still }, stageFor = held.stageFor.takeIf { still })
  }

  companion object {
    /** Before the first 2xx: nothing known, and the default cadence (CD38). */
    val UNKNOWN = WaitingFields("", "", null, false, null, BeatCadence.DEFAULT_POLL_S)
  }
}

/**
 * The `pair` intent's payload (amendment, _The engine port_). [token] is the code's `tok`: the
 * Bearer for every call, and a secret. A plain class, so no generated `toString` can print it.
 */
class PairRequest(
  val code: String,
  val slot: Int,
  val token: String,
  val codeUrl: String,
  val heartbeatUrl: String,
  val startUrl: String,
  val language: String,
  val automatic: Boolean,
  val claim: Claim,
  val environment: Environment,
  /** The venue's zone from the code's GET at the scan, which seeds the pairing's; "" when JS sent none. Not a secret. */
  val venueTimezone: String = "",
  /** The round line the scan's GET gave, and the match label it was read with; both or neither. Not a secret. */
  val stageLabel: String? = null,
  val stageMatch: String? = null,
) {
  val name: PairingName
    get() = PairingName(code, slot, TokenTag.of(token))

  /**
   * Every reason this request cannot pair; empty when it can. JS checked the code, the token and the
   * hosts already; native checks again, on the rows JS is held to (`wire/code-vectors.json`, carry G1).
   * The code's URL is exactly its own on the build's host (T16 m1): the adapter's `HttpRequests.code` appends `?slot=` to it as
   * given and sends the Bearer there, so a `#`, a query or another code's path is refused, not read.
   */
  fun problems(): List<String> = buildList {
    if (code.isBlank()) add("code is blank") else if (!CODE.matches(code)) add("code is not 12 characters of the code alphabet")
    if (token.isBlank()) add("token is blank") else if (!TOKEN.matches(token)) add("token is not 22 characters of base64url")
    if (slot < 0) add("slot is below 0")
    if (codeUrl != "https://${environment.seaznHost}$CODE_PATH$code") add("codeUrl is not the code's URL on ${environment.seaznHost}")
    for ((key, url) in listOf("heartbeatUrl" to heartbeatUrl, "startUrl" to startUrl)) {
      if (!Hosts.onSeazn(url, environment)) add("$key is not on ${environment.seaznHost}")
    }
  }

  /** The token: masked in every line, as plan B's `tok` was. */
  fun secrets(): List<String> = listOf(token).filter { it.isNotBlank() }

  /**
   * The code: masked by value in free text only (M3). No line the machine writes names it, so it is
   * kept out at field level; a short code must never mangle a closed word that happens to contain it.
   */
  fun textSecrets(): List<String> = listOf(code).filter { it.isNotBlank() }

  override fun toString(): String =
    "PairRequest(slot=$slot, token=<${token.length} chars>, claim=${claim.wire}, environment=${environment.wire})"

  private companion object {
    /** `capture-beat.v1`'s `code`: 12 characters of the code alphabet, which has no i, l, o or u. */
    val CODE = Regex("[0-9a-hjkmnp-tv-z]{12}")

    /** `capture-qr.v2`'s `tok`: 16 bytes as base64url, 22 characters. ASCII classes, matched whole. */
    val TOKEN = Regex("[A-Za-z0-9_-]{22}")

    /** The phone API's code path (D3), between the build's Seazn host and the code. */
    const val CODE_PATH = "/api/v1/capture/codes/"
  }
}

/** The pairing's `POST start` asks: only the answer to the ask in flight is acted on. Ids carry across pairings ([Ids.start]). */
data class StartAsks(val nextId: Int = 1, val inFlightId: Int? = null)
