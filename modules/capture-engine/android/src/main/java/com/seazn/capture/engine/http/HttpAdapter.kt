package com.seazn.capture.engine.http

import com.seazn.capture.engine.adapter.HttpOutcome
import com.seazn.capture.engine.adapter.HttpRequest
import com.seazn.capture.engine.adapter.HttpRequests
import java.io.IOException
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean
import okhttp3.Call
import okhttp3.Callback
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.Response

/**
 * One request, answered exactly once, on OkHttp's threads (Task 16's rules and the C6 carries). A
 * failure is its class name only ([HttpOutcome.failed]): OkHttp's messages can quote the URL.
 *
 * - A redirect is never followed: the 3xx is the answer, which the core reads as transient. Followed,
 *   OkHttp would send a POST's body (the code, the phone id, the stopped record) on to whatever host
 *   the `Location` names, on a 307 or 308.
 * - A body is read up to [MAX_BODY_BYTES]. A longer one is a failure, never a body cut short.
 * - Anything that throws, building the request included, is the request's one answer.
 *
 * In the glue's own folder, beside nothing Android, so core's tests run it on the JVM (Task 33).
 */
class HttpAdapter(private val client: OkHttpClient = client(HttpRequests.TIMEOUT_MS)) {
  fun send(request: HttpRequest, answer: (HttpOutcome) -> Unit) {
    val once = Once(answer)
    try {
      client.newCall(build(request)).enqueue(once)
    } catch (failure: Exception) {
      once.give(HttpOutcome.failed(failure))
    }
  }

  /**
   * The request's one answer, whichever of the build, the failure and the response comes first. OkHttp
   * calls one of its two callbacks once per call; this holds even if a version ever did not.
   */
  internal class Once(private val answer: (HttpOutcome) -> Unit) : Callback {
    private val answered = AtomicBoolean(false)

    fun give(outcome: HttpOutcome) {
      if (answered.compareAndSet(false, true)) answer(outcome)
    }

    override fun onFailure(call: Call, e: IOException) = give(HttpOutcome.failed(e))

    override fun onResponse(call: Call, response: Response) = give(read(response))
  }

  private fun build(request: HttpRequest): Request {
    val builder = Request.Builder().url(request.url)
    for ((name, value) in request.headers) builder.header(name, value)
    return builder.method(request.method, request.body?.toRequestBody(JSON)).build()
  }

  companion object {
    /** The body cap (C6 carry, the controller's body-cap ruling): the largest answer the server writes is a few KiB. */
    const val MAX_BODY_BYTES = 64L * 1024

    /** The reason for a body over the cap: a word, as every [HttpOutcome.Failed] reason is. */
    const val TOO_LARGE = "BodyTooLarge"

    private val JSON = "application/json; charset=utf-8".toMediaType()

    /** The client every request uses: no cache, no redirects, and each timeout at [timeoutMs]. */
    fun client(timeoutMs: Long): OkHttpClient =
      OkHttpClient.Builder()
        .cache(null)
        .followRedirects(false)
        .followSslRedirects(false)
        .connectTimeout(timeoutMs, TimeUnit.MILLISECONDS)
        .readTimeout(timeoutMs, TimeUnit.MILLISECONDS)
        .callTimeout(timeoutMs, TimeUnit.MILLISECONDS)
        .build()

    /**
     * The status, the body as text and `Retry-After`; a failure for a body over the cap or a read that
     * throws. Any throw is caught here: one that escaped `onResponse` would be lost by OkHttp, or kill
     * its thread, and the request would never be answered.
     */
    internal fun read(response: Response): HttpOutcome =
      try {
        response.use { whole(it) }
      } catch (failure: Exception) {
        HttpOutcome.failed(failure)
      }

    private fun whole(response: Response): HttpOutcome {
      val retryAfter = response.header("Retry-After")
      val body = response.body ?: return HttpOutcome.Answered(response.code, "", retryAfter)
      val source = body.source()
      // True when the source holds more than the cap: the body is refused whole, never cut.
      if (source.request(MAX_BODY_BYTES + 1)) return HttpOutcome.Failed(TOO_LARGE)
      val charset = body.contentType()?.charset(Charsets.UTF_8) ?: Charsets.UTF_8
      return HttpOutcome.Answered(response.code, source.buffer.readString(charset), retryAfter)
    }
  }
}
