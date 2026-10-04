package com.seazn.capture.engine.adapter

import com.seazn.capture.engine.core.Configs
import com.seazn.capture.engine.core.Json
import com.seazn.capture.engine.core.JsonObject

/**
 * The pair intent's wire, as Expo hands it over (every number a Double), and the server's made-up
 * answers, built from [Configs]' values with [Json.obj], so no credential is typed twice. Shared by
 * `PairMappingTest` and `BridgeCoreTest`. Every value sits inside the web's schemas (capture-qr.v2,
 * capture-beat.v1, capture-descriptor.v1 at 09e87aabd): the code is 12 characters of the code
 * alphabet, the sid a uuid, the phone id 16 to 64 characters, and the beat path `/beats` (D3).
 */
object PairWire {
  const val CODE = "fx42hmnp7k2q"
  const val ORIGIN = "https://stg.seazn.club/api/v1/capture/codes/$CODE"

  /** A made-up broadcast sid in the schemas' uuid pattern (version 4, variant 8). */
  const val SID = "6f1c2b7a-3d4e-4f50-8a9b-0c1d2e3f4a5b"

  /** Every value differs from its default: language, automatic off, claim new. */
  fun valid(): Map<String, Any?> =
    mapOf(
      "kind" to "pair",
      "code" to CODE,
      "slot" to 1.0,
      "token" to Configs.TOKEN,
      "codeUrl" to ORIGIN,
      "heartbeatUrl" to "$ORIGIN/beats",
      "startUrl" to "$ORIGIN/start",
      "language" to "fr",
      "automatic" to false,
      "claim" to "new",
      "environment" to "staging",
    )

  private val waiting =
    listOf(
      "label" to "Example Town v Sample CC",
      "venueTimezone" to "Europe/London",
      "scheduledStart" to null,
      "autoAllowed" to true,
      "destinationName" to "YouTube · Example Town CC",
      "overlayUrl" to null,
      "pollSeconds" to 10,
    )

  /** A beat's answer: [state] with the waiting fields, and [sid] when one is named. */
  fun beat(state: String = "waiting", sid: String? = null, endReason: String? = null): String =
    Json.obj(listOf("state" to state, "sid" to sid, "endReason" to endReason) + waiting)

  /** GET code's session shape for [SID], SRT preferred, on the staging ingest host. */
  val SESSION: String =
    Json.obj(
      listOf(
        "state" to "warming",
        "code" to CODE,
        "sid" to SID,
        "cred" to
          JsonObject(
            listOf(
              "srt" to JsonObject(listOf("url" to "srt://live.stg.seazn.club:778", "streamId" to Configs.STREAM_ID, "passphrase" to Configs.PASSPHRASE, "latencyMs" to 2_000)),
              "rtmps" to JsonObject(listOf("url" to "rtmps://live.stg.seazn.club:443/live/", "streamKey" to Configs.STREAM_KEY)),
            )
          ),
        "preferred" to "srt",
        "playbackUrl" to Configs.PLAYBACK_URL,
        "holdWindowSeconds" to JsonObject(listOf("srt" to 183, "rtmps" to 180)),
        "maxDurationMinutes" to 300,
        "warmingDeadline" to 1_790_000_600L,
        "scoreUpdates" to "realtime",
      ) + waiting
    )

  /** The default server: beats wait, the code is open, a start succeeds, a playlist has a variant. */
  fun answer(request: HttpRequest): HttpOutcome =
    when {
      request.url.endsWith("/beats") -> HttpOutcome.Answered(200, beat())
      request.url.endsWith("/start") -> HttpOutcome.Answered(200, Json.obj(listOf("sid" to SID)))
      request.url.startsWith("$ORIGIN?") -> HttpOutcome.Answered(200, SESSION)
      else -> HttpOutcome.Answered(200, "#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1\nv.m3u8")
    }

  /** The server once [SID] is live: beats say `live` with its sid, so a long broadcast runs on; the rest as [answer]. */
  fun answerLive(request: HttpRequest): HttpOutcome =
    if (request.url.endsWith("/beats")) HttpOutcome.Answered(200, beat("live", SID)) else answer(request)
}
