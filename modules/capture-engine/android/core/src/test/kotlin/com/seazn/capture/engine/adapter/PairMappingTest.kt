package com.seazn.capture.engine.adapter

import com.seazn.capture.engine.core.Claim
import com.seazn.capture.engine.core.Configs
import com.seazn.capture.engine.core.Environment
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

class PairMappingTest {
  /**
   * As Expo hands it over: every number a Double (expo-modules-core 57.0.20, `FrontendConverter.cpp`'s
   * `AnyFrontendConvert`). The values are made up: the code, slot and phone within `capture-beat.v1`,
   * the token Configs' own, which no rule shapes yet.
   */
  private fun wire(): MutableMap<String, Any?> =
    mutableMapOf(
      "kind" to "pair",
      "code" to "fx42hmnp7k2q",
      "slot" to 1.0,
      "token" to Configs.TOKEN,
      "codeUrl" to "https://stg.seazn.club/api/capture/codes/fx42hmnp7k2q",
      "heartbeatUrl" to "https://stg.seazn.club/api/capture/codes/fx42hmnp7k2q/beat",
      "startUrl" to "https://stg.seazn.club/api/capture/codes/fx42hmnp7k2q/start",
      "language" to "fr",
      "automatic" to false,
      "claim" to "resume",
      "environment" to "staging",
    )

  @Test
  fun `a whole pair maps to a request with no problems`() {
    val request = PairMapping.request(wire())
    assertEquals(emptyList<String>(), request.problems())
    assertEquals("fx42hmnp7k2q", request.code)
    assertEquals(1, request.slot)
    assertEquals(Configs.TOKEN, request.token)
    // Each URL from its own key: three of one host, so only the field says which went where.
    assertEquals("https://stg.seazn.club/api/capture/codes/fx42hmnp7k2q", request.codeUrl)
    assertEquals("https://stg.seazn.club/api/capture/codes/fx42hmnp7k2q/beat", request.heartbeatUrl)
    assertEquals("https://stg.seazn.club/api/capture/codes/fx42hmnp7k2q/start", request.startUrl)
    assertEquals("fr", request.language, "(P3) the notification's language")
    assertEquals(false, request.automatic)
    assertEquals(Claim.RESUME, request.claim)
    assertEquals(Environment.STAGING, request.environment)
  }

  @Test
  fun `an empty pair is never thrown, it is refused by name`() {
    val problems = PairMapping.request(mapOf("kind" to "pair")).problems()
    for (named in listOf("code is blank", "token is blank", "slot is below 0", "codeUrl is not on stg.seazn.club")) {
      assertTrue(named in problems, "missing '$named' in $problems")
    }
  }

  @Test
  fun `a mistyped pair is read as missing, never cast, so it is refused by name`() {
    val mistyped =
      mapOf(
        "kind" to "pair",
        "code" to 42.0,
        "slot" to "1",
        "token" to true,
        "codeUrl" to null,
        "heartbeatUrl" to listOf("https://stg.seazn.club/api/capture/codes/fx42hmnp7k2q/beat"),
        "startUrl" to mapOf("url" to "https://stg.seazn.club/api/capture/codes/fx42hmnp7k2q/start"),
        "language" to 3.0,
        "automatic" to "false",
        "claim" to 1.0,
        "environment" to true,
      )
    val request = PairMapping.request(mistyped)
    val problems = request.problems()
    val named =
      listOf(
        "code is blank",
        "token is blank",
        "slot is below 0",
        "codeUrl is not on stg.seazn.club",
        "heartbeatUrl is not on stg.seazn.club",
        "startUrl is not on stg.seazn.club",
      )
    for (problem in named) assertTrue(problem in problems, "missing '$problem' in $problems")
    assertEquals("", request.language)
    assertEquals(true, request.automatic, "a string is no flag: the default, automatic on")
    assertEquals(Claim.RESUME, request.claim, "a number is no claim: the default, resume")
    assertEquals(Environment.STAGING, request.environment)
  }

  @Test
  fun `absent settings take their defaults - automatic on, claim resume, staging`() {
    val bare = wire().apply { remove("automatic"); remove("claim"); remove("environment"); remove("language") }
    val request = PairMapping.request(bare)
    assertEquals(true, request.automatic)
    assertEquals(Claim.RESUME, request.claim, "ruling, review 11 I1: a lost claim word never takes the slot from a newer pairing")
    assertEquals(Environment.STAGING, request.environment)
    assertEquals("", request.language, "(P3) none: the phone's language, then English")
    assertEquals(Claim.RESUME, PairMapping.request(wire().apply { put("claim", "steal") }).claim)
    assertEquals(Claim.RESUME, PairMapping.request(wire().apply { put("claim", "NEW") }).claim, "the word is matched exactly")
    assertEquals(Claim.NEW, PairMapping.request(wire().apply { put("claim", "new") }).claim, "a scan's own word still claims new")
    assertEquals(Environment.STAGING, PairMapping.request(wire().apply { put("environment", "prod") }).environment)
  }

  @Test
  fun `a fractional or out-of-range number is no number`() {
    assertTrue("slot is below 0" in PairMapping.request(wire().apply { put("slot", 1.5) }).problems())
    assertEquals(null, WireValues.int(3.0e10))
    assertEquals(null, WireValues.int(Double.NaN))
    assertEquals(7, WireValues.int(7.0))
  }

  @Test
  fun `a number is one only at Int's edges and inside them, whatever its boxed type`() {
    // Int.MAX_VALUE is 2^31 - 1 = 2147483647 and Int.MIN_VALUE is -2^31 = -2147483648.
    assertEquals(Int.MAX_VALUE, WireValues.int(2_147_483_647.0))
    assertEquals(null, WireValues.int(2_147_483_648.0))
    assertEquals(Int.MIN_VALUE, WireValues.int(-2_147_483_648.0))
    assertEquals(null, WireValues.int(-2_147_483_649.0))
    assertEquals(null, WireValues.int(Double.POSITIVE_INFINITY))
    assertEquals(null, WireValues.int(Double.NEGATIVE_INFINITY))
    assertEquals(null, WireValues.int(-0.5))
    assertEquals(0, WireValues.int(-0.0), "JS's -0 is a whole number")
    assertEquals(7, WireValues.int(7))
    assertEquals(7, WireValues.int(7L))
    assertEquals(null, WireValues.int(2_147_483_648L))
    assertEquals(null, WireValues.int(-2_147_483_649L))
    assertEquals(null, WireValues.int("7"))
    assertEquals(null, WireValues.int(null))
  }

  @Test
  fun `text and flag read only their own type`() {
    assertEquals("nl", WireValues.text("nl"))
    assertEquals("", WireValues.text(null))
    assertEquals("", WireValues.text(1.0))
    assertEquals(true, WireValues.flag(true))
    assertEquals(false, WireValues.flag(false))
    assertEquals(null, WireValues.flag("true"))
    assertEquals(null, WireValues.flag(1.0))
    assertEquals(null, WireValues.flag(null))
  }

  @Test
  fun `a production code on a staging build is refused, by host`() {
    val prod = wire().apply { put("heartbeatUrl", "https://seazn.club/api/capture/codes/fx42hmnp7k2q/beat") }
    assertTrue("heartbeatUrl is not on stg.seazn.club" in PairMapping.request(prod).problems())
  }

  @Test
  fun `a production pair on production hosts maps to production, with no problems`() {
    val prod =
      wire().apply {
        put("environment", "production")
        put("codeUrl", "https://seazn.club/api/capture/codes/fx42hmnp7k2q")
        put("heartbeatUrl", "https://seazn.club/api/capture/codes/fx42hmnp7k2q/beat")
        put("startUrl", "https://seazn.club/api/capture/codes/fx42hmnp7k2q/start")
      }
    val request = PairMapping.request(prod)
    assertEquals(Environment.PRODUCTION, request.environment)
    assertEquals(emptyList<String>(), request.problems())
  }

  @Test
  fun `the same wire maps twice to the same request, and is left as it was`() {
    val sent = wire()
    val before = sent.toMap()
    val first = PairMapping.request(sent)
    val second = PairMapping.request(sent)
    assertEquals(first.name, second.name)
    assertEquals(first.problems(), second.problems())
    assertEquals(first.toString(), second.toString())
    assertEquals(before, sent)
  }

  @Test
  fun `the mapped request never prints its token`() {
    assertTrue(Configs.TOKEN !in PairMapping.request(wire()).toString())
  }
}
