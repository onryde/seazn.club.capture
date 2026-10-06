package com.seazn.capture.engine.debug

import com.seazn.capture.engine.adapter.JsonReader
import com.seazn.capture.engine.debug.ScriptAnswers.Result
import com.seazn.capture.engine.debug.ScriptAnswers.Script
import java.io.File
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertIs

/**
 * The scripted code server's rules (Task 34), on the JVM. The URLs are the phone API's (D3): the code
 * at `/api/v1/capture/codes/{code}`, its beats at `…/beats` and its start at `…/start`, as the waiting
 * descriptor names them. The sids are uuids, as the contracts require (C6 carry I3). Every value is
 * made up.
 */
class ScriptAnswersTest {
  private val codes = "https://stg.seazn.club/api/v1/capture/codes/fx42hmnp7k2q"
  private val sid = "0d9e8f7a-6b5c-4d3e-9f1a-2b3c4d5e6f70"

  private val script =
    Script(
      """{"code":[{"status":200,"body":{"state":"waiting","pollSeconds":60}}],
       "beat":[{"status":200,"body":{"state":"waiting"}},{"status":200,"body":{"state":"go-live","sid":"$sid","startedBy":"organiser"}}],
       "start":[{"status":429,"body":{"code":"rate_limited","message":"m"},"retryAfter":"12"},{"fail":true}]}""",
      version = 1,
    )

  @Test
  fun `no script passes every request through`() {
    assertEquals(Result.Pass, ScriptAnswers().answer("POST", "$codes/beats", null))
  }

  @Test
  fun `only the code paths are scripted - a playlist and any other path pass through even with a script`() {
    val answers = ScriptAnswers()
    val passes =
      listOf(
        "GET" to "https://customer-x.cloudflarestream.com/x/manifest/video.m3u8",
        "POST" to "$codes/beat",
        "POST" to "$codes/beats/extra",
        "GET" to "$codes/beats",
        "POST" to codes,
        "GET" to "https://stg.seazn.club/api/capture/codes/fx42hmnp7k2q",
      )
    for ((method, url) in passes) assertEquals(Result.Pass, answers.answer(method, url, script), "$method $url")
    assertEquals("code", (answers.answer("GET", "$codes?slot=1&phone=p", script) as Result.Answer).route)
    assertEquals("beat", (answers.answer("POST", "$codes/beats", script) as Result.Answer).route)
    assertEquals("start", (answers.answer("POST", "$codes/start", script) as Result.Answer).route)
  }

  @Test
  fun `a route's answers go in order, and the last repeats`() {
    val answers = ScriptAnswers()
    val bodies = List(3) { (answers.answer("POST", "$codes/beats", script) as Result.Answer).body }
    val live = """{"state":"go-live","sid":"$sid","startedBy":"organiser"}"""
    assertEquals(listOf("""{"state":"waiting"}""", live, live), bodies)
  }

  @Test
  fun `routes keep their own places`() {
    val answers = ScriptAnswers()
    answers.answer("POST", "$codes/beats", script)
    assertEquals(429, (answers.answer("POST", "$codes/start", script) as Result.Answer).status, "start's first, after a beat")
    assertEquals(Result.Fail, answers.answer("POST", "$codes/start", script))
  }

  @Test
  fun `a new version starts every route from its first answer`() {
    val answers = ScriptAnswers()
    answers.answer("POST", "$codes/beats", script)
    val again = answers.answer("POST", "$codes/beats", Script(script.text, version = 2)) as Result.Answer
    assertEquals("""{"state":"waiting"}""", again.body)
  }

  @Test
  fun `a status, its Retry-After, and a scripted no-answer`() {
    val answers = ScriptAnswers()
    val busy = answers.answer("POST", "$codes/start", script) as Result.Answer
    assertEquals(429 to "12", busy.status to busy.retryAfter)
    assertEquals(Result.Fail, answers.answer("POST", "$codes/start", script))
  }

  @Test
  fun `an unreadable script and an unscripted route say so`() {
    assertEquals(Result.Unreadable, ScriptAnswers().answer("POST", "$codes/beats", Script("{nope", 1)))
    assertEquals(Result.Unreadable, ScriptAnswers().answer("POST", "$codes/beats", Script("[]", 1)), "not an object")
    assertEquals(Result.Unscripted, ScriptAnswers().answer("POST", "$codes/beats", Script("""{"code":[]}""", 1)))
    assertEquals(Result.Unscripted, ScriptAnswers().answer("POST", "$codes/beats", Script("""{"beat":[]}""", 1)), "an empty route")
    assertEquals(Result.Unreadable, ScriptAnswers().answer("POST", "$codes/beats", Script("""{"beat":[{"body":{}}]}""", 1)), "no status")
    assertEquals(Result.Unreadable, ScriptAnswers().answer("POST", "$codes/beats", Script("""{"beat":["x"]}""", 1)), "not an answer")
  }

  @Test
  fun `a body is written back as the server writes it - whole numbers as integers, strings escaped, nested kept`() {
    val text = """{"a":60,"b":2.5,"c":"q\"\\\n\u0001\t","d":[true,null,{"e":"é"}]}"""
    val written = ScriptAnswers().write(JsonReader.parse(text))
    assertEquals("""{"a":60,"b":2.5,"c":"q\"\\\n\u0001\t","d":[true,null,{"e":"é"}]}""", written)
    assertEquals(JsonReader.parse(text), JsonReader.parse(written))
  }

  @Test
  fun `an answer with no body is empty, not the word null`() {
    val answer = ScriptAnswers().answer("POST", "$codes/beats", Script("""{"beat":[{"status":204}]}""", 1)) as Result.Answer
    assertEquals("", answer.body)
  }

  @Test
  fun `an answer never prints its body - it can hold a stream key`() {
    val keyed = Script("""{"code":[{"status":200,"body":{"cred":{"rtmps":{"streamKey":"key-made-up-0001"}}}}]}""", 1)
    val answer = ScriptAnswers().answer("GET", codes, keyed)
    assertIs<Result.Answer>(answer)
    assertFalse("key-made-up-0001" in answer.toString())
  }

  /**
   * The probe script (C5 runs under it), answered at the URLs its own waiting code names: the server's
   * shapes, which serverBodies.test.ts checks against the contracts. Read from the file, never typed here.
   */
  @Test
  fun `the probe script answers its own code's URLs - waiting, waiting, refused`() {
    val text = File(System.getProperty("capture.shared") ?: error("capture.shared is not set"), "wire/scripted-probe.json").readText()
    val probe = Script(text, version = 1)
    val file = JsonReader.parse(text) as Map<*, *>
    val code = ((file["code"] as List<*>)[0] as Map<*, *>)["body"] as Map<*, *>
    val answers = ScriptAnswers()
    val asked =
      listOf(
        Triple("GET", "https://stg.seazn.club/api/v1/capture/codes/${code["code"]}?slot=1&phone=p", "code"),
        Triple("POST", code["heartbeatUrl"] as String, "beat"),
        Triple("POST", code["startUrl"] as String, "start"),
      )
    var checked = 0
    for ((method, url, route) in asked) {
      val answer = answers.answer(method, url, probe) as Result.Answer
      val scripted = ((file[route] as List<*>)[0] as Map<*, *>)
      assertEquals(route, answer.route)
      assertEquals((scripted["status"] as Double).toInt(), answer.status, route)
      assertEquals(scripted["body"], JsonReader.parse(answer.body), route)
      checked += 1
    }
    assertEquals(3, checked)
  }
}
