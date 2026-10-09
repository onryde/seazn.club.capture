package com.seazn.capture.engine.adapter

import com.seazn.capture.engine.core.CodeAnswer
import com.seazn.capture.engine.core.Command
import com.seazn.capture.engine.core.Environment
import com.seazn.capture.engine.core.FetchResult
import com.seazn.capture.engine.core.HeartbeatResponse
import com.seazn.capture.engine.core.Input
import com.seazn.capture.engine.core.StartAnswer
import java.net.URLEncoder

/**
 * One request the glue's HTTP client sends as given (CD13). `toString` prints the method, the header
 * names and two lengths: never the bearer (the code's `tok`), the URL (whose path holds the code), or a
 * body (a beat's carries the code and the stopped record).
 */
data class HttpRequest(val method: String, val url: String, val headers: List<Pair<String, String>>, val body: String?) {
  override fun toString(): String =
    "HttpRequest($method, url=<${url.length} chars>, headers=${headers.map { it.first }}, body=${body?.let { "<${it.length} chars>" } ?: "none"})"
}

/** What the glue's HTTP client got for one [HttpRequest]: one outcome, for every request, whatever happened. */
sealed interface HttpOutcome {
  /**
   * Any status, the body as text, and the raw `Retry-After` header, read by [Bodies.retryAfter]. `toString`
   * prints the body's length alone: a code's 2xx carries `cred`.
   */
  data class Answered(val status: Int, val body: String, val retryAfter: String? = null) : HttpOutcome {
    override fun toString(): String = "Answered(status=$status, body=<${body.length} chars>, retryAfter=$retryAfter)"
  }

  /** No HTTP answer: a timeout, a reset, a name that did not resolve. [message] is a reason, never a value. */
  data class Failed(val message: String) : HttpOutcome

  companion object {
    /**
     * Whatever the client threw (a timeout, any IOException, anything else) as an outcome, so every request
     * is answered: a `POST start` with none would leave the hold blocked (C0b carry). Named by its class
     * alone: a client's message may name a host or a URL, and the URL's path holds the code. An anonymous
     * class has no simple name, so its nearest named superclass stands in: the reason is never "".
     */
    fun failed(failure: Throwable): Failed =
      Failed(generateSequence<Class<*>>(failure.javaClass) { it.superclass }.map { it.simpleName }.first { it.isNotEmpty() })
  }
}

/** CD13: the requests, as the rules want them. */
object HttpRequests {
  /** Under the core's own 10 s give-ups ([com.seazn.capture.engine.core.Heartbeat.TIMEOUT_MS], the delivery watch's), so the answer comes first. */
  const val TIMEOUT_MS = 8_000L

  /** F-P5-13: never a cached manifest, and never the code's bearer, which is Seazn's and not Cloudflare's. */
  fun playlist(command: Command.FetchPlaylist): HttpRequest =
    HttpRequest("GET", command.url, listOf("Cache-Control" to "no-cache", "Pragma" to "no-cache"), null)

  fun heartbeat(command: Command.PostHeartbeat): HttpRequest = post(command.url, command.bearer, command.body)

  /**
   * G0-d: `?slot=` always, even 0, the server's default (amendment, _Contract shapes_), and `?phone=`, so
   * only the slot's current phone gets `cred`. The phone's id is query-encoded with the charset-name
   * `URLEncoder.encode`, which every Android API level has, and a space as `%20`, not the form's `+`.
   */
  fun code(command: Command.FetchCode): HttpRequest {
    val phone = URLEncoder.encode(command.phoneId, "UTF-8").replace("+", "%20")
    val url = "${command.url}?slot=${command.slot}&phone=$phone"
    return HttpRequest("GET", url, listOf("Authorization" to "Bearer ${command.bearer}", "Accept" to "application/json", "Cache-Control" to "no-store"), null)
  }

  /** Web ask 9: the body is `{phone}`, built by the core. */
  fun start(command: Command.PostStart): HttpRequest = post(command.url, command.bearer, command.body)

  /** §10: the same auth and body as `start` (web ask: `{phone}`); never retried by the engine, called on a tap only. */
  fun scoringLink(url: String, bearer: String, body: String): HttpRequest = post(url, bearer, body)

  private fun post(url: String, bearer: String, body: String): HttpRequest =
    HttpRequest("POST", url, listOf("Authorization" to "Bearer $bearer", "Content-Type" to "application/json", "Cache-Control" to "no-store"), body)
}

/**
 * CD13: the answers, as the core's inputs, each with the id it was asked with. [Bodies] reads every
 * body and never throws, so every outcome is an answer: a 2xx that is no JSON object (a captive portal's
 * page, a cut body) is the transient one, and so is no answer at all.
 */
object HttpAnswers {
  private const val NO_CONTENT = 204

  /** Carry 20: 204 first, because OkHttp's `isSuccessful` is true for it. Any other status, a 403 too, is no evidence. */
  fun playlist(requestId: Int, outcome: HttpOutcome): Input.PlaylistFetched =
    Input.PlaylistFetched(
      requestId,
      when (outcome) {
        is HttpOutcome.Failed -> FetchResult.Failed(outcome.message)
        is HttpOutcome.Answered ->
          when (outcome.status) {
            NO_CONTENT -> FetchResult.NoContent
            in 200..299 -> FetchResult.Body(outcome.body)
            else -> FetchResult.HttpError(outcome.status)
          }
      },
    )

  /** [env] is the pairing's. No waiting field is read by it since the overlay went (D2 §4.1); kept so every reader takes the pairing's environment alike. */
  fun heartbeat(beatId: Int, outcome: HttpOutcome, env: Environment): Input.HeartbeatAnswered =
    Input.HeartbeatAnswered(
      beatId,
      when (outcome) {
        is HttpOutcome.Failed -> HeartbeatResponse.Failed(outcome.message)
        is HttpOutcome.Answered -> Bodies.beat(outcome.status, outcome.body, Bodies.retryAfter(outcome.retryAfter), env)
      },
    )

  /** Carry 17: the id asked with, and Task 15's one reader for what the answer means, against the pairing's [env]. */
  fun code(requestId: Int, outcome: HttpOutcome, env: Environment): Input.CodeAnswered =
    Input.CodeAnswered(
      requestId,
      when (outcome) {
        is HttpOutcome.Failed -> CodeAnswer.Unreachable(outcome.message)
        is HttpOutcome.Answered -> Bodies.code(outcome.status, outcome.body, Bodies.retryAfter(outcome.retryAfter), env)
      },
    )

  /** A start is the operator's to try again, so it reads no Retry-After. */
  fun start(requestId: Int, outcome: HttpOutcome): Input.StartAnswered =
    Input.StartAnswered(
      requestId,
      when (outcome) {
        is HttpOutcome.Failed -> StartAnswer.Failed("no answer: ${outcome.message}")
        is HttpOutcome.Answered -> Bodies.start(outcome.status, outcome.body)
      },
    )
}
