package com.seazn.capture.engine.adapter

import com.seazn.capture.engine.core.*
import kotlin.test.AfterTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue
import org.json.JSONObject

class ScoringLinkTest {
  private val clock = FakeClock()
  private val scheduler = FakeScheduler(clock)
  private val platform = RecordingPlatform()
  private val core = BridgeCore(clock, scheduler, platform, MemoryStore(), "1.0.0", "Test Phone") { Configs.PHONE_ID }.also { platform.core = it }

  /** Made up: `dl_` and 43 base64url characters, the contract's shape. Never a real link. */
  private val secret = "dl_AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-AbCdE"
  private val url = "https://stg.seazn.club/score/$secret"

  /** What each tap's callback was handed, in order. */
  private val got = mutableListOf<Map<String, Any?>>()

  @AfterTest fun forget() = BridgeCore.resetShared()

  private fun paired() {
    core.start()
    core.report(Input.Network(true))
    core.readiness(cameraFrames = true, audioPeak = 0.4, pose = Pose.Held(Side.LEFT))
    scheduler.advanceBy(Engine.TICK_MS)
    core.readiness(audioPeak = 0.4)
    core.send(PairWire.valid())
    scheduler.advanceBy(0)
  }

  private fun tap() = core.scoringLink { got += it }

  private fun answering(status: Int, body: String, retryAfter: String? = null) {
    platform.answer = { request ->
      if (request.url.endsWith("/scoring-link")) HttpOutcome.Answered(status, body, retryAfter) else PairWire.answer(request)
    }
  }

  private val ok get() = """{"url":"$url"}"""
  private fun lines() = platform.lines.map(::JSONObject)
  private fun scoringLines() = lines().filter { it.getString("kind") == "scoring-link" }
  private fun state() = (core.current()["state"] as Map<*, *>)["kind"]
  private fun telemetry() = core.current()["telemetry"] as Map<*, *>
  private val unavailable: Map<String, Any?> = mapOf("outcome" to "unavailable")

  /**
   * RP4's witness. Nothing reached the task boundary (`taskFailures`, and no `engine-error` line), nothing is held
   * against the process (`stickyFailure`), and the pairing carries on. A `LinkageError` that did reach `failed` would
   * make all three fail at once, which is how `BridgeCoreTest`'s "carry 18" sees one.
   */
  private fun assertUntouched(why: String) {
    assertEquals("paired", state(), why)
    assertEquals(listOf(0.0, false), listOf(telemetry()["taskFailures"], telemetry()["stickyFailure"]), why)
    assertTrue("engine-error" !in lines().map { it.getString("kind") }, why)
  }

  @Test
  fun `a tap asks the server with the pairing's bearer and the start's own body, and the answer is handed over once`() {
    paired()
    answering(200, ok)
    tap()
    scheduler.advanceBy(0)
    val asked = platform.http.single { it.url.endsWith("/scoring-link") }
    assertEquals("POST", asked.method)
    assertEquals("${PairWire.ORIGIN}/scoring-link", asked.url)
    assertEquals("Bearer ${Configs.TOKEN}", asked.headers.toMap()["Authorization"])
    assertEquals("no-store", asked.headers.toMap()["Cache-Control"])
    assertEquals(Beats.startBody(Configs.PHONE_ID), asked.body)
    assertEquals(listOf<Map<String, Any?>>(mapOf("outcome" to "ok", "url" to url)), got)
    // The answer is handed over once however long the clock runs: the backstop that guards the request is cancelled.
    scheduler.advanceBy(BridgeCore.ANSWER_BACKSTOP_MS + 1)
    assertEquals(1, got.size)
  }

  @Test
  fun `the url reaches no record line, no snapshot, no beat and no toString`() {
    paired()
    answering(200, ok)
    tap()
    scheduler.advanceBy(Engine.TICK_MS * 3)
    val everything =
      platform.lines + platform.snapshots.map { it.toString() } + platform.http.filter { it.url.endsWith("/beats") }.map { it.body ?: "" } +
        platform.http.map { it.toString() } + core.tail().map { it.toString() } + core.current().toString()
    assertTrue(everything.isNotEmpty())
    for (text in everything) assertFalse(text.contains(secret), "the secret is in: ${text.take(80)}")
    // The record knows a link was asked for, by word and status only, and the allow-list decides that line (kind and keys).
    val line = lines().last { it.getString("kind") == "scoring-link" }
    assertEquals(setOf("at", "kind", "result", "status"), line.keySet())
    assertEquals("ok", line.getString("result"))
    assertEquals(200, line.getInt("status"))
    val list = Shared.read("scrub/allow-list.json")
    assertTrue("scoring-link" in list.getJSONObject("kinds").keySet())
    val plain = list.getJSONArray("plain").let { array -> (0 until array.length()).map(array::getString) }
    assertTrue("result" in plain && "status" in plain)
  }

  /**
   * F16. The scoring url is on the record's public-URL key list, so a line written under `url` passes the scrub unless
   * the secret is protected; and a line that names the bare secret in a `message` is masked by value only if it is
   * protected. Both are written the way a caller (or a library's error) could write them, after the answer.
   */
  @Test
  fun `a link's secret is masked under url and inside a message once it is known, and not before`() {
    paired()
    // Before the answer the process cannot know the secret: the same probe shows its text. This is the witness
    // that the masking below is the protect call's work, not a property of the probe.
    core.log("info", "probe", mapOf("message" to "x $secret y"))
    scheduler.advanceBy(0)
    assertTrue(platform.lines.last().contains(secret), "the probe carries the secret before it is known")
    answering(200, ok)
    tap()
    scheduler.advanceBy(0)
    core.log("info", "probe", mapOf("url" to url, "message" to "x $secret y"))
    scheduler.advanceBy(0)
    val after = JSONObject(platform.lines.last())
    assertEquals("probe", after.getString("kind"))
    assertEquals(SessionRecord.MASK, after.getString("url"))
    assertEquals("x *** y", after.getString("message"))
  }

  @Test
  fun `each refusal is one word, a 429 keeps its Retry-After, and none carries a url`() {
    paired()
    val table =
      listOf(
        Triple(401, """{"code":"code_ended","message":"m"}""", "code_ended"),
        Triple(409, """{"code":"replaced","message":"m"}""", "replaced"),
        Triple(409, """{"code":"match_finished","message":"m"}""", "match_finished"),
        Triple(402, """{"code":"not_entitled","message":"m"}""", "not_entitled"),
        Triple(503, """{"code":"unavailable","message":"m"}""", "unavailable"),
      )
    for ((status, body, word) in table) {
      answering(status, body)
      tap()
      scheduler.advanceBy(0)
      assertEquals(word, got.last()["outcome"], body)
      assertFalse(got.last().containsKey("url"), body)
    }
    answering(429, """{"code":"rate_limited","message":"m"}""", "30")
    tap()
    scheduler.advanceBy(0)
    assertEquals(mapOf("outcome" to "rate_limited", "retryAfterS" to 30.0), got.last())
    assertEquals(6, got.size)
  }

  @Test
  fun `a refusal then a success then a repeat - each tap is its own ask and a repeat gets the same link`() {
    paired()
    answering(409, """{"code":"replaced","message":"m"}""")
    tap()
    scheduler.advanceBy(0)
    answering(200, ok)
    tap()
    tap()
    scheduler.advanceBy(0)
    assertEquals(listOf("replaced", "ok", "ok"), got.map { it["outcome"] })
    assertEquals(got[1], got[2])
    assertEquals(3, platform.http.count { it.url.endsWith("/scoring-link") })
  }

  @Test
  fun `no answer at all is unavailable at the existing backstop, and a second tap while the first is out is its own ask`() {
    paired()
    platform.unanswered = { it.url.endsWith("/scoring-link") }
    tap()
    tap()
    scheduler.advanceBy(0)
    assertEquals(0, got.size)
    scheduler.advanceBy(BridgeCore.ANSWER_BACKSTOP_MS + 1)
    assertEquals(listOf("unavailable", "unavailable"), got.map { it["outcome"] })
    // 16 000 ms is the pre-existing backstop (P7), twice the 8 000 ms request timeout: this call adds none of its own.
    assertEquals(2 * HttpRequests.TIMEOUT_MS, BridgeCore.ANSWER_BACKSTOP_MS)
    assertEquals(16_000L, BridgeCore.ANSWER_BACKSTOP_MS)
  }

  /** The pairing the tap asked for is gone when its answer comes: the old match's link is not handed to anyone. */
  private fun assertStale(change: () -> Unit, why: String) {
    paired()
    platform.unanswered = { it.url.endsWith("/scoring-link") }
    tap()
    scheduler.advanceBy(0)
    val owed = platform.owed.single { it.first.url.endsWith("/scoring-link") }
    assertEquals(0, got.size, why)
    change()
    scheduler.advanceBy(0)
    owed.second(HttpOutcome.Answered(200, ok))
    scheduler.advanceBy(0)
    assertEquals(listOf(unavailable), got, why)
    // One line, a word and a status as ever, and no url; the allow-list's own keys.
    val line = scoringLines().single()
    assertEquals(setOf("at", "kind", "result", "status"), line.keySet(), why)
    assertEquals("stale", line.getString("result"), why)
    assertEquals(200, line.getInt("status"), why)
    for (text in platform.lines + platform.snapshots.map { it.toString() } + core.current().toString())
      assertFalse(text.contains(secret), "$why: the secret is in ${text.take(80)}")
    // The secret reached memory, so it is protected all the same: a probe that names it is masked from here on.
    core.log("info", "probe", mapOf("url" to url, "message" to "x $secret y"))
    scheduler.advanceBy(0)
    val probe = JSONObject(platform.lines.last())
    assertEquals("probe", probe.getString("kind"), why)
    assertEquals(SessionRecord.MASK, probe.getString("url"), why)
    assertEquals("x *** y", probe.getString("message"), why)
  }

  @Test
  fun `m2 an answer that arrives after an unpair is not the caller's - unavailable, one line, no url`() {
    assertStale({ core.send(mapOf("kind" to "unpair")) }, "unpaired")
    assertEquals(null, core.current()["pairing"], "the unpair took")
  }

  @Test
  fun `m2 an answer that arrives after a re-pair to another match is not the caller's - and the new match gets its own`() {
    assertStale({ core.send(PairWire.valid() + ("slot" to 2.0)) }, "re-paired")
    assertEquals("paired", state())
    // The positive pair: the new pairing's own tap is answered with its link.
    platform.unanswered = { false }
    answering(200, ok)
    tap()
    scheduler.advanceBy(0)
    assertEquals(mapOf("outcome" to "ok", "url" to url), got.last())
    assertEquals(2, got.size)
  }

  @Test
  fun `m3 a real answer that comes after the backstop is dropped - one answer and one line, and the secret is nowhere`() {
    paired()
    platform.unanswered = { it.url.endsWith("/scoring-link") }
    tap()
    scheduler.advanceBy(0)
    scheduler.advanceBy(BridgeCore.ANSWER_BACKSTOP_MS + 1)
    assertEquals(listOf(unavailable), got)
    assertEquals(1, scoringLines().size)
    val owed = platform.owed.single { it.first.url.endsWith("/scoring-link") }
    owed.second(HttpOutcome.Answered(200, ok))
    scheduler.advanceBy(BridgeCore.ANSWER_BACKSTOP_MS)
    assertEquals(listOf(unavailable), got, "the late real answer reached nobody")
    assertEquals(1, scoringLines().size, "and wrote no second line")
    assertEquals("unavailable", scoringLines().single().getString("result"))
    for (text in platform.lines + platform.snapshots.map { it.toString() })
      assertFalse(text.contains(secret), "the secret is in ${text.take(80)}")
  }

  /** m1. The answers' own `toString` is on the path of every log of a value and every failure message. */
  @Test
  fun `m1 a link prints a length and never its url, alone or inside a collection or a message`() {
    val link = ScoringLinkAnswer.Link(url)
    val printed =
      listOf(link.toString(), "$link", listOf(link).toString(), mapOf("answer" to link).toString(), "failed on $link", String.format("%s", link))
    assertEquals(6, printed.size)
    for (text in printed) {
      assertFalse(text.contains(secret), "the secret is in: $text")
      assertFalse(text.contains("seazn.club"), "the host is in: $text")
      assertTrue(text.contains("${url.length}"), "no length in: $text")
    }
    // The refusal holds no url, and prints the word only: a Retry-After is not part of what it says.
    val refused = ScoringLinkAnswer.Refused("rate_limited", 31)
    assertEquals("Refused(rate_limited)", refused.toString())
    assertFalse(refused.toString().contains("31"))
  }

  @Test
  fun `with no pairing there is nothing to ask, and the answer says so without a request`() {
    core.start()
    tap()
    scheduler.advanceBy(0)
    assertEquals(0, platform.http.count { it.url.endsWith("/scoring-link") })
    assertEquals(listOf(unavailable), got)
    // RP4: a missing pairing is a plain answer, not a caught exception: nothing is noted, so no line is written.
    assertEquals(0, scoringLines().size)
  }

  @Test
  fun `a link is still asked for after live and after the broadcast ended, as the spec has it`() {
    paired()
    core.send(mapOf("kind" to "start"))
    scheduler.advanceBy(1_500)
    answering(200, ok)
    tap()
    scheduler.advanceBy(0)
    core.send(mapOf("kind" to "stop"))
    scheduler.advanceBy(3_000)
    tap()
    scheduler.advanceBy(0)
    assertEquals(listOf("ok", "ok"), got.map { it["outcome"] })
  }

  @Test
  fun `a transport that throws is answered unavailable at once, whatever it throws, and the pairing is not failed (RP4)`() {
    paired()
    val thrown =
      listOf(
        IllegalStateException("no activity"), // an Exception: ask's own catch already answers it
        PermanentPlatformFailure("tls"), // an Exception that Failures.permanent calls permanent; still caught by ask
        UnsatisfiedLinkError("libssl.so not found"), // a LinkageError: permanent, and an Error that ask does not catch
        NoClassDefFoundError("okhttp3/Call"), // the same class of failure, another one
        Error("jni"), // an Error that is not permanent: it would be counted as a task failure and recorded as engine-error
      )
    for ((i, failure) in thrown.withIndex()) {
      platform.throwOnHttp = { if (it.url.endsWith("/scoring-link")) failure else null }
      tap()
      scheduler.advanceBy(0)
      assertEquals(unavailable, got.last(), failure.toString())
      assertEquals(i + 1, got.size, "answered once: $failure")
      assertUntouched(failure.toString())
    }
    assertEquals(5, got.size)
    // The pairing still works: the same tap, with the transport mended, gets its link.
    platform.throwOnHttp = { null }
    answering(200, ok)
    tap()
    scheduler.advanceBy(0)
    assertEquals(mapOf("outcome" to "ok", "url" to url), got.last())
    assertUntouched("after the transport is mended")
  }

  @Test
  fun `after a throw out of the transport the backstop that ask left armed adds no second answer and no second line (RP4)`() {
    paired()
    platform.throwOnHttp = { if (it.url.endsWith("/scoring-link")) UnsatisfiedLinkError("libssl.so not found") else null }
    tap()
    scheduler.advanceBy(0)
    val noted = scoringLines()
    assertEquals(1, noted.size)
    assertEquals(setOf("at", "kind", "result", "error"), noted.single().keySet())
    assertEquals(listOf("failed", "UnsatisfiedLinkError"), listOf(noted.single().getString("result"), noted.single().getString("error")))
    // An Error leaves ask before it can cancel its backstop, so the backstop fires into a tap that was answered long ago.
    scheduler.advanceBy(BridgeCore.ANSWER_BACKSTOP_MS + 1)
    assertEquals(listOf(unavailable), got)
    assertEquals(1, scoringLines().size, "the late backstop wrote a second line for the one tap")
    assertUntouched("after the backstop")
  }

  @Test
  fun `a callback that throws is noted by its class, the tap is not answered twice, and the pairing is not failed (RP4)`() {
    paired()
    answering(200, ok)
    var calls = 0
    core.scoringLink {
      calls += 1
      throw UnsatisfiedLinkError("jni dead")
    }
    scheduler.advanceBy(0)
    assertEquals(1, calls, "handed once; the failure is not answered into the same callback again")
    val noted = scoringLines().filter { it.has("error") }
    assertEquals(1, noted.size)
    assertEquals(listOf("failed", "UnsatisfiedLinkError"), listOf(noted.single().getString("result"), noted.single().getString("error")))
    assertUntouched("a callback that is dead")
  }

  @Test
  fun `a callback that is dead as well is tried once with unavailable, both failures are noted, and nothing reaches the failure path (RP4)`() {
    paired()
    platform.throwOnHttp = { if (it.url.endsWith("/scoring-link")) NoClassDefFoundError("okhttp3/Call") else null }
    var calls = 0
    core.scoringLink {
      calls += 1
      throw UnsatisfiedLinkError("jni dead")
    }
    scheduler.advanceBy(0)
    assertEquals(1, calls, "the unavailable answer was tried once")
    assertEquals(listOf("NoClassDefFoundError", "UnsatisfiedLinkError"), scoringLines().map { it.getString("error") })
    assertUntouched("the transport and the callback both dead")
  }

  @Test
  fun `the tap hands over once and ignores every later hand`() {
    val handed = mutableListOf<Map<String, Any?>>()
    val tap = ScoringTap({ handed += it }) {}
    assertFalse(tap.spent)
    tap.hand(mapOf("outcome" to "ok"))
    tap.hand(mapOf("outcome" to "replaced"))
    assertEquals(listOf<Map<String, Any?>>(mapOf("outcome" to "ok")), handed)
    assertTrue(tap.spent)
  }

  @Test
  fun `work that fails apart is answered unavailable once and noted, and work that fails after the hand-over is only noted`() {
    val handed = mutableListOf<Map<String, Any?>>()
    val noted = mutableListOf<Throwable>()
    val before = ScoringTap({ handed += it }) { noted += it }
    val first = IllegalStateException("one")
    before.apart { throw first }
    assertEquals(listOf(unavailable), handed)
    assertEquals(listOf<Throwable>(first), noted)
    val after = ScoringTap({ handed += it }) { noted += it }
    val second = Error("two")
    after.apart {
      after.hand(mapOf("outcome" to "ok"))
      throw second
    }
    assertEquals(listOf<Map<String, Any?>>(unavailable, mapOf("outcome" to "ok")), handed)
    assertEquals(listOf<Throwable>(first, second), noted)
    // Work that does not fail is not noted.
    ScoringTap({ handed += it }) { noted += it }.apart {}
    assertEquals(2, noted.size)
  }
}
