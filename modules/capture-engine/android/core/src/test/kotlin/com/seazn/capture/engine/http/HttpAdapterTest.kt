package com.seazn.capture.engine.http

import com.seazn.capture.engine.adapter.HttpOutcome
import com.seazn.capture.engine.adapter.HttpRequest
import java.util.concurrent.LinkedBlockingQueue
import okhttp3.Call
import okhttp3.MediaType
import okhttp3.OkHttpClient
import okhttp3.Protocol
import okhttp3.Request
import okhttp3.Response
import okhttp3.ResponseBody
import okio.BufferedSource
import java.util.concurrent.TimeUnit
import kotlin.test.AfterTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertIs
import kotlin.test.assertNull
import kotlin.test.assertTrue
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import okhttp3.mockwebserver.SocketPolicy

/**
 * The glue's HTTP adapter (Task 33) on the JVM, against a local server, with OkHttp 4.12.0, the version
 * the app resolves at runtime. The C6 carries: a redirect is the answer and is never followed, a body over 64 KiB is a
 * failure and never cut, and every request is answered exactly once, a request that cannot be built too.
 */
class HttpAdapterTest {
  private val server = MockWebServer().apply { start() }

  /** Each answer as it came, and how many: a second answer for one request is the defect. */
  private val answers = LinkedBlockingQueue<HttpOutcome>()

  @AfterTest
  fun stop() = server.shutdown()

  private fun send(request: HttpRequest, adapter: HttpAdapter = HttpAdapter()): HttpOutcome {
    adapter.send(request) { answers.put(it) }
    val first = answers.poll(10, TimeUnit.SECONDS) ?: error("no answer in 10 s")
    // A second answer would follow at once, on the same call's thread: wait a little for it.
    assertNull(answers.poll(200, TimeUnit.MILLISECONDS), "a request is answered once")
    return first
  }

  private fun get(path: String = "/code") = HttpRequest("GET", server.url(path).toString(), listOf("Accept" to "application/json"), null)

  private fun post(path: String = "/start") = HttpRequest("POST", server.url(path).toString(), listOf("Content-Type" to "application/json"), """{"phone":"p"}""")

  @Test
  fun `an answer is its status, its whole body and Retry-After`() {
    server.enqueue(MockResponse().setResponseCode(429).setHeader("Retry-After", "12").setBody("""{"code":"busy"}"""))
    assertEquals(HttpOutcome.Answered(429, """{"code":"busy"}""", "12"), send(get()))
  }

  @Test
  fun `redirects are never followed - every 3xx is the answer, a POST's body goes nowhere else`() {
    var checked = 0
    for (status in listOf(301, 302, 303, 307, 308)) {
      for (request in listOf(get(), post())) {
        server.enqueue(MockResponse().setResponseCode(status).setHeader("Location", server.url("/elsewhere")))
        val before = server.requestCount
        assertEquals(status, (send(request) as HttpOutcome.Answered).status, "$status ${request.method}")
        assertEquals(1, server.requestCount - before, "$status ${request.method}: the Location was asked")
        assertEquals("/" + request.url.substringAfterLast('/'), server.takeRequest().path)
        checked += 1
      }
    }
    assertEquals(10, checked, "the sweep's own count")
  }

  @Test
  fun `a body of exactly 64 KiB is answered whole, and one byte more is a failure, never a cut body`() {
    val cap = 64 * 1024
    server.enqueue(MockResponse().setBody("a".repeat(cap)))
    assertEquals(cap, (send(get()) as HttpOutcome.Answered).body.length)
    server.enqueue(MockResponse().setBody("a".repeat(cap + 1)))
    assertEquals(HttpOutcome.Failed(HttpAdapter.TOO_LARGE), send(get()))
    server.enqueue(MockResponse().setBody("a".repeat(4 * cap)))
    assertEquals(HttpOutcome.Failed(HttpAdapter.TOO_LARGE), send(get()), "far over the cap")
  }

  @Test
  fun `a 204 with no body is the empty string`() {
    server.enqueue(MockResponse().setResponseCode(204))
    assertEquals(HttpOutcome.Answered(204, "", null), send(post()))
  }

  /** A throw while the request is built is its answer (C6 carry): not only the URL's IllegalArgumentException. */
  @Test
  fun `a request that cannot be built is answered once, by the failure's class`() {
    val cannot =
      listOf(
        HttpRequest("GET", "not a url", emptyList(), null),
        HttpRequest("GET", server.url("/code").toString(), listOf("Authorization" to "Bearer a\nb"), null),
        HttpRequest("GET", server.url("/code").toString(), emptyList(), "a body on a GET"),
        HttpRequest("POST", server.url("/start").toString(), emptyList(), null),
      )
    for (request in cannot) assertEquals(HttpOutcome.Failed("IllegalArgumentException"), send(request), request.toString())
    assertEquals(0, server.requestCount, "nothing was sent")
  }

  /** C6 m-1, K12: any throw while the call is made is its answer, not only the URL's IllegalArgumentException. */
  @Test
  fun `a call that throws other than IllegalArgumentException while it is made is answered once, by its class`() {
    val throwing =
      object : OkHttpClient() {
        override fun newCall(request: Request): Call = throw IllegalStateException("the dispatcher has shut down")
      }
    assertEquals(HttpOutcome.Failed("IllegalStateException"), send(get(), HttpAdapter(throwing)))
  }

  /** C6 m-1, K13: a read that throws other than an IOException is a failure, never a throw lost on OkHttp's thread. */
  @Test
  fun `a body whose read throws other than IOException is a failure by its class`() {
    val unreadable =
      object : ResponseBody() {
        override fun contentType(): MediaType? = null

        override fun contentLength() = -1L

        override fun source(): BufferedSource = throw IllegalStateException("the body was handed on")
      }
    val response = Response.Builder().request(Request.Builder().url(server.url("/code")).build()).protocol(Protocol.HTTP_1_1).code(200).message("OK").body(unreadable).build()
    assertEquals(HttpOutcome.Failed("IllegalStateException"), HttpAdapter.read(response))
  }

  /**
   * C6 m-1, K14: a body that drips, a byte well inside each read timeout, is ended by the call timeout
   * alone: the whole call, the body's read included, has [HttpAdapter.client]'s one bound.
   */
  @Test
  fun `a body that drips forever is ended by the call timeout, never read whole`() {
    server.enqueue(MockResponse().setBody("a".repeat(10_000)).throttleBody(1, 50, TimeUnit.MILLISECONDS))
    val began = System.nanoTime()
    val outcome = send(get(), HttpAdapter(HttpAdapter.client(timeoutMs = 400)))
    val tookMs = (System.nanoTime() - began) / 1_000_000
    assertIs<HttpOutcome.Failed>(outcome)
    assertTrue(tookMs < 5_000, "ended at $tookMs ms; read whole it takes 500 s")
  }

  /**
   * C6 m-1, K15: a server that accepts and never sends a header is ended by the read timeout, on a client
   * whose call timeout is off, so the call timeout cannot stand in for it (each masked the other in the
   * test below).
   */
  @Test
  fun `a server that never sends a header is ended by the read timeout alone`() {
    server.enqueue(MockResponse().setSocketPolicy(SocketPolicy.NO_RESPONSE))
    val readOnly = HttpAdapter.client(timeoutMs = 300).newBuilder().callTimeout(0, TimeUnit.MILLISECONDS).build()
    val began = System.nanoTime()
    val outcome = send(get(), HttpAdapter(readOnly))
    val tookMs = (System.nanoTime() - began) / 1_000_000
    assertEquals(HttpOutcome.Failed("SocketTimeoutException"), outcome)
    assertTrue(tookMs < 5_000, "ended at $tookMs ms, by the 300 ms read timeout")
  }

  @Test
  fun `a server that never answers is a timeout, once`() {
    server.enqueue(MockResponse().setSocketPolicy(SocketPolicy.NO_RESPONSE))
    val outcome = send(get(), HttpAdapter(HttpAdapter.client(timeoutMs = 300)))
    assertIs<HttpOutcome.Failed>(outcome)
    // The call timeout or the read timeout, whichever fires first: either is named by its class alone.
    assertTrue(outcome.message in setOf("InterruptedIOException", "SocketTimeoutException"), outcome.message)
  }

  @Test
  fun `a connection cut mid-body is a failure, never a cut body`() {
    server.enqueue(MockResponse().setBody("a".repeat(1_000)).setSocketPolicy(SocketPolicy.DISCONNECT_DURING_RESPONSE_BODY))
    assertIs<HttpOutcome.Failed>(send(get()))
  }

  /** The guard behind "once", reached directly: OkHttp never calls back twice, so no server can. */
  @Test
  fun `a second answer for one request is dropped, and the first one stands`() {
    val given = mutableListOf<HttpOutcome>()
    val once = HttpAdapter.Once { given += it }
    once.give(HttpOutcome.Answered(200, "first", null))
    once.give(HttpOutcome.Failed("IOException"))
    once.give(HttpOutcome.Answered(500, "third", null))
    assertEquals(listOf<HttpOutcome>(HttpOutcome.Answered(200, "first", null)), given)
  }

  /** The bodies' second call (AGENTS §10): one adapter, two requests in a row, each answered once. */
  @Test
  fun `one adapter answers each of two requests once`() {
    val adapter = HttpAdapter()
    server.enqueue(MockResponse().setBody("one"))
    server.enqueue(MockResponse().setBody("two"))
    assertEquals("one", (send(get(), adapter) as HttpOutcome.Answered).body)
    assertEquals("two", (send(post(), adapter) as HttpOutcome.Answered).body)
  }
}
