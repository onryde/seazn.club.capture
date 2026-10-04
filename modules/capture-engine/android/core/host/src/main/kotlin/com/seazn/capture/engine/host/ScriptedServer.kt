package com.seazn.capture.engine.host

import com.seazn.capture.engine.adapter.HttpOutcome
import com.seazn.capture.engine.adapter.HttpRequest
import org.json.JSONObject

/**
 * The host's Seazn: made-up answers on the staging hosts, each path replaceable by a script line.
 * Every value sits inside the web's schemas, so the real `Bodies` and `Hosts` rules accept them: the
 * code is 12 characters of the code alphabet, the sid a uuid, and the beat path `/beats` (D3). The
 * stdin protocol names the paths `beat`, `code` and `start`.
 */
class ScriptedServer {
  private val answers =
    mutableMapOf(
      "beat" to (200 to WAITING),
      "code" to (200 to SESSION),
      "start" to (200 to JSONObject().put("sid", SID)),
    )

  /** From now on, [path] is answered with [status] and [body]. A path the protocol does not name is refused (PV25). */
  @Synchronized
  fun script(path: String, status: Int, body: JSONObject) {
    require(path in answers) { "unknown path $path" }
    answers[path] = status to body
  }

  /** The path a request is for, or null for anything that is not Seazn's (a playlist). */
  fun path(request: HttpRequest): String? =
    when {
      request.url.endsWith("/beats") -> "beat"
      request.url.endsWith("/start") -> "start"
      request.url.startsWith("$ORIGIN?") -> "code"
      else -> null
    }

  @Synchronized
  fun answer(request: HttpRequest): HttpOutcome {
    val (status, body) = answers[path(request) ?: return HttpOutcome.Failed("scripted host: no network")]!!
    return HttpOutcome.Answered(status, body.toString())
  }

  companion object {
    const val CODE = "h0stcde7k2qa"
    const val ORIGIN = "https://stg.seazn.club/api/v1/capture/codes/$CODE"
    const val TOKEN = "tok-host-0000000000000000"

    /** A made-up broadcast sid in the schemas' uuid pattern (version 4, variant 9). */
    const val SID = "2d7c4b1e-5f3a-4e6b-9c8d-1a2b3c4d5e6f"

    /** The pair intent the kit sends: made-up, staging, slot 0. */
    val PAIR: String =
      JSONObject()
        .put("kind", "pair")
        .put("code", CODE)
        .put("slot", 0)
        .put("token", TOKEN)
        .put("codeUrl", ORIGIN)
        .put("heartbeatUrl", "$ORIGIN/beats")
        .put("startUrl", "$ORIGIN/start")
        .put("language", "en")
        .put("automatic", true)
        .put("claim", "new")
        .put("environment", "staging")
        .toString()

    private fun waiting(state: String) =
      JSONObject()
        .put("state", state)
        .put("label", "Host v Script")
        .put("venueTimezone", "Europe/London")
        .put("scheduledStart", JSONObject.NULL)
        .put("autoAllowed", true)
        .put("destinationName", "YouTube · Host")
        .put("overlayUrl", JSONObject.NULL)
        .put("pollSeconds", 10)

    val WAITING: JSONObject = waiting("waiting")

    val SESSION: JSONObject =
      waiting("warming")
        .put("code", CODE)
        .put("sid", SID)
        .put("preferred", "srt")
        .put(
          "cred",
          JSONObject()
            .put("srt", JSONObject().put("url", "srt://live.stg.seazn.club:778").put("streamId", "host-stream-id").put("passphrase", "host-passphrase-0").put("latencyMs", 2000))
            .put("rtmps", JSONObject().put("url", "rtmps://live.stg.seazn.club:443/live/").put("streamKey", "host-stream-key")),
        )
        .put("playbackUrl", "https://customer-x.cloudflarestream.com/host-stream-id/manifest/video.m3u8")
        .put("holdWindowSeconds", JSONObject().put("srt", 183).put("rtmps", 180))
        .put("maxDurationMinutes", 300)
        .put("warmingDeadline", 1_790_000_600L)
        .put("scoreUpdates", "realtime")
  }
}
