package com.seazn.capture.engine.host

import com.seazn.capture.engine.adapter.HttpOutcome
import com.seazn.capture.engine.adapter.HttpRequest
import java.util.concurrent.atomic.AtomicInteger
import org.json.JSONObject

/**
 * The host's Seazn: made-up answers on the staging hosts, each path replaceable by a script line.
 * Every value sits inside the web's schemas, so the real `Bodies` and `Hosts` rules accept them: the
 * code is 12 characters of the code alphabet, the sid a uuid, and the beat path `/beats` (D3). The
 * bodies are `wire/server-bodies.json`'s `host/` rows, which ajv checks against the schemas at
 * 5bb72e8a2 (review C4a m-4): a beat names no zone and no null sid, and a code's answer names its
 * beat and start URLs. The stdin protocol names the paths `beat`, `code` and `start`.
 *
 * Task 27's quiet: [inFlight] counts the answers taken and not yet handed to the core, and
 * [onAnswered] runs once the next answer a script gave is handed over.
 */
class ScriptedServer {
  private val scripted = mutableMapOf<String, Pair<Int, JSONObject>>()

  /** Per path, how many scripts it has had: an answer is a script's when taken at its generation or later. */
  private val generations = mutableMapOf<String, Int>()
  private val waiters = mutableListOf<Waiter>()
  private val taken = AtomicInteger()

  /** Answers taken by the platform and not yet handed to the core. */
  val inFlight: Int
    get() = taken.get()

  /** From now on, [path] is answered with [status] and [body]. A path the protocol does not name is refused (PV25). */
  @Synchronized
  fun script(path: String, status: Int, body: JSONObject) {
    require(path in PATHS) { "unknown path $path" }
    scripted[path] = status to body
    generations[path] = generation(path) + 1
  }

  /** Runs [then] once, after the next answer on [path] taken since its last script has been handed over. */
  @Synchronized
  fun onAnswered(path: String, then: () -> Unit) {
    require(path in PATHS) { "unknown path $path" }
    waiters += Waiter(path, generation(path), then)
  }

  /** The path a request is for, or null for anything that is not Seazn's (a playlist). */
  fun path(request: HttpRequest): String? =
    when {
      request.url.endsWith("/beats") -> "beat"
      request.url.endsWith("/start") -> "start"
      CODE_URL.matches(request.url) -> "code"
      else -> null
    }

  /** The answer [request] gets now. */
  @Synchronized
  fun answer(request: HttpRequest): HttpOutcome {
    val path = path(request) ?: return HttpOutcome.Failed("scripted host: no network")
    val (status, body) = scripted[path] ?: (200 to unscripted(path, request.url))
    return HttpOutcome.Answered(status, body.toString())
  }

  /** The platform's ask: [answer], counted in flight until [handed]. */
  @Synchronized
  fun take(request: HttpRequest): Taken {
    taken.incrementAndGet()
    val path = path(request)
    return Taken(answer(request), path, path?.let(::generation) ?: 0)
  }

  /** The platform has handed [answer] to the core: it is no longer in flight, and the waiters on it run. */
  fun handed(answer: Taken) {
    val due =
      synchronized(this) {
        taken.decrementAndGet()
        waiters.filter { it.path == answer.path && answer.generation >= it.generation }.also { waiters.removeAll(it) }
      }
    for (waiter in due) waiter.then()
  }

  /** An answer on its way to the core: what was answered, and to which path's which script. */
  class Taken internal constructor(val outcome: HttpOutcome, internal val path: String?, internal val generation: Int)

  private class Waiter(val path: String, val generation: Int, val then: () -> Unit)

  private fun generation(path: String): Int = generations[path] ?: 0

  /** The default answers: a beat waits, a code is open for the code its URL names, a start names its sid. */
  private fun unscripted(path: String, url: String): JSONObject =
    when (path) {
      "beat" -> WAITING
      "code" -> session(CODE_URL.matchEntire(url)!!.groupValues[1])
      else -> JSONObject().put("sid", SID)
    }

  companion object {
    const val CODE = "h0stcde7k2qa"
    private const val CODES = "https://stg.seazn.club/api/v1/capture/codes/"

    /**
     * The ingest host the server issues creds on, both transports (owner ruling A, 2026-10-05). The server's own
     * value, typed here and not read from `Hosts.INGEST`: this stands for the web, so a wrong pin cannot move it.
     */
    private const val INGEST = "live.cloudflare.com"
    const val ORIGIN = "$CODES$CODE"

    /** The protocol's paths (PV25). */
    private val PATHS = setOf("beat", "code", "start")

    /** Any code's URL on the staging host, with the query the engine adds (`?slot=&phone=`): the kit's codes as well as the host's. */
    private val CODE_URL = Regex("${Regex.escape(CODES)}([^/?#]+)\\?.*")

    /** 22 characters of base64url, inside capture-qr.v2's `tok`: native refuses any other (T11 gap 3). */
    const val TOKEN = "tok-host-0000000000000"

    /** A made-up broadcast sid in the schemas' uuid pattern (version 4, variant 9). */
    const val SID = "2d7c4b1e-5f3a-4e6b-9c8d-1a2b3c4d5e6f"

    /** The made-up session secrets the code's answer carries: no line the host writes may carry either. */
    const val PASSPHRASE = "host-passphrase-0"
    const val STREAM_KEY = "host-stream-key"

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

    /** On every 2xx answer, beat or code. */
    private fun waiting(state: String) =
      JSONObject()
        .put("state", state)
        .put("label", "Host v Script")
        .put("autoAllowed", true)
        .put("destinationName", "YouTube · Host")
        .put("overlayUrl", JSONObject.NULL)
        // BeatCadence's floor, so a say is heard within 5 s (Task 27).
        .put("pollSeconds", 5)

    /** A beat's `scheduledStart` is null when the fixture has none. */
    val WAITING: JSONObject = waiting("waiting").put("scheduledStart", JSONObject.NULL)

    /**
     * A code's answer omits `scheduledStart` when there is none, and names the zone and its URLs: those
     * of the [code] its URL names, so each of the kit's codes fetches its own (Task 27).
     */
    private fun session(code: String): JSONObject =
      waiting("warming")
        .put("venueTimezone", "Europe/London")
        .put("heartbeatUrl", "$CODES$code/beats")
        .put("startUrl", "$CODES$code/start")
        .put("code", code)
        .put("sid", SID)
        .put("preferred", "srt")
        .put(
          "cred",
          JSONObject()
            .put("srt", JSONObject().put("url", "srt://$INGEST:778").put("streamId", "host-stream-id").put("passphrase", PASSPHRASE).put("latencyMs", 2000))
            .put("rtmps", JSONObject().put("url", "rtmps://$INGEST:443/live/").put("streamKey", STREAM_KEY)),
        )
        .put("playbackUrl", "https://customer-x.cloudflarestream.com/host-stream-id/manifest/video.m3u8")
        .put("holdWindowSeconds", JSONObject().put("srt", 183).put("rtmps", 180))
        .put("maxDurationMinutes", 300)
        .put("warmingDeadline", 1_790_000_600L)
        .put("scoreUpdates", "realtime")
  }
}
