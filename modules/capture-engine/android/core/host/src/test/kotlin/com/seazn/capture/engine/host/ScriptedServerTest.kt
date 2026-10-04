package com.seazn.capture.engine.host

import com.seazn.capture.engine.adapter.HttpOutcome
import com.seazn.capture.engine.adapter.HttpRequest
import java.io.File
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertTrue
import org.json.JSONObject

class ScriptedServerTest {
  private val server = ScriptedServer()

  private fun ask(url: String) = server.answer(HttpRequest("GET", url, emptyList(), null)) as HttpOutcome.Answered

  @Test
  fun `by default beats wait, the code is open, and a start names its sid`() {
    assertEquals("waiting", JSONObject(ask("${ScriptedServer.ORIGIN}/beats").body).getString("state"))
    assertEquals(ScriptedServer.SID, JSONObject(ask("${ScriptedServer.ORIGIN}?slot=0&phone=p").body).getString("sid"))
    assertEquals(ScriptedServer.SID, JSONObject(ask("${ScriptedServer.ORIGIN}/start").body).getString("sid"))
  }

  @Test
  fun `a script replaces one path's answer, status and body`() {
    server.script("start", 402, JSONObject("""{"code":"no_credit","message":"m"}"""))
    val refused = ask("${ScriptedServer.ORIGIN}/start")
    assertEquals(402, refused.status)
    assertEquals("no_credit", JSONObject(refused.body).getString("code"))
    assertEquals(200, ask("${ScriptedServer.ORIGIN}/beats").status, "other paths keep theirs")
  }

  @Test
  fun `a playlist is no evidence`() {
    assertEquals(HttpOutcome.Failed("scripted host: no network"), server.answer(HttpRequest("GET", "https://customer-x.cloudflarestream.com/v.m3u8", emptyList(), null)))
  }

  /** Review C4a m-4: the host's bodies are `wire/server-bodies.json`'s `host/` rows, which ajv checks against the contracts. */
  @Test
  fun `m-4 each body the host answers with is the contract-checked vector of its name`() {
    val root = System.getProperty("capture.shared") ?: error("capture.shared is not set: run through Gradle")
    val bodies = JSONObject(File(root, "wire/server-bodies.json").readText(Charsets.UTF_8)).getJSONArray("bodies")
    val rows = (0 until bodies.length()).map(bodies::getJSONObject).filter { it.getString("name").startsWith("host/") }
    val ours =
      mapOf(
        "host/beat-waiting" to ask("${ScriptedServer.ORIGIN}/beats").body,
        "host/code-warming" to ask("${ScriptedServer.ORIGIN}?slot=0&phone=p").body,
        "host/start-ok" to ask("${ScriptedServer.ORIGIN}/start").body,
      )
    assertEquals(ours.keys, rows.map { it.getString("name") }.toSet())
    var checked = 0
    for (row in rows) {
      val name = row.getString("name")
      assertTrue(JSONObject(ours.getValue(name)).similar(row.getJSONObject("body")), "$name: ${ours[name]}")
      checked += 1
    }
    assertEquals(3, checked, "the vectors' own count")
  }

  // PV25: a kit typo is refused, never a script that answers nothing.
  @Test
  fun `a script for an unknown path is refused, and every path keeps its answer`() {
    val error = assertFailsWith<IllegalArgumentException> { server.script("beats", 500, JSONObject()) }
    assertEquals("unknown path beats", error.message)
    assertEquals(200, ask("${ScriptedServer.ORIGIN}/beats").status)
    assertEquals(200, ask("${ScriptedServer.ORIGIN}/start").status)
    assertEquals(200, ask("${ScriptedServer.ORIGIN}?slot=0&phone=p").status)
  }

  @Test
  fun `any code's URL with a query reads as code, and its answer names that code`() {
    val url = "https://stg.seazn.club/api/v1/capture/codes/ka0000000001"
    val answered = ask("$url?slot=1&phone=p")
    assertEquals(200, answered.status)
    val body = JSONObject(answered.body)
    assertEquals(listOf("ka0000000001", "$url/beats", "$url/start"), listOf(body.getString("code"), body.getString("heartbeatUrl"), body.getString("startUrl")))
    assertEquals("code", server.path(HttpRequest("GET", "$url?slot=1&phone=p", emptyList(), null)))
    // Not Seazn's code path: another host, or no query, is no path at all.
    assertEquals(null, server.path(HttpRequest("GET", "https://evil.example/api/v1/capture/codes/ka0000000001?slot=1", emptyList(), null)))
    assertEquals(null, server.path(HttpRequest("GET", url, emptyList(), null)))
  }

  @Test
  fun `onAnswered runs once, after the next answer of the script it follows is handed over, and inFlight counts each`() {
    val beat = HttpRequest("POST", "${ScriptedServer.ORIGIN}/beats", emptyList(), "{}")
    val early = server.take(beat)
    assertEquals(1, server.inFlight)
    var ran = 0
    server.script("beat", 200, JSONObject().put("state", "taken"))
    server.onAnswered("beat") { ran += 1 }
    server.handed(early)
    assertEquals(0 to 0, ran to server.inFlight, "an answer taken before the script is not its answer")
    val next = server.take(beat)
    assertEquals("taken", JSONObject((next.outcome as HttpOutcome.Answered).body).getString("state"))
    server.handed(next)
    server.handed(server.take(beat))
    assertEquals(1 to 0, ran to server.inFlight, "run once, at the scripted answer")
  }

  // Task 27's quiet reads inFlight: an answer still counts while the core is being handed it, so the
  // host is never quiet between the answer and the work the core posts for it.
  @Test
  fun `an answer is in flight until the platform has handed it to the core`() {
    val platform = ScriptedPlatform(server) {}
    val seen = java.util.concurrent.ArrayBlockingQueue<Int>(1)
    platform.http(HttpRequest("POST", "${ScriptedServer.ORIGIN}/beats", emptyList(), "{}")) { seen.put(server.inFlight) }
    assertEquals(1, seen.poll(2, java.util.concurrent.TimeUnit.SECONDS), "in flight inside the hand-over")
    val until = System.nanoTime() + 2_000_000_000L
    while (server.inFlight != 0 && System.nanoTime() < until) Thread.sleep(5)
    assertEquals(0, server.inFlight, "handed over")
    platform.shutdown()
  }
}
