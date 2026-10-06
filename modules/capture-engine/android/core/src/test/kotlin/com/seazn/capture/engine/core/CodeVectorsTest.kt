package com.seazn.capture.engine.core

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/**
 * Carry G1 and T11 gap 3: a pair request's code and token are held to capture-qr.v2's patterns, on
 * the rows the JS scan is held to (`wire/code-vectors.json`, streamCodeVectors.test.ts). Native checks
 * again what JS checked: a code or token JS should never have sent is refused by name.
 */
class CodeVectorsTest {
  private val file = Shared.read("wire/code-vectors.json")
  private val codeProblems = setOf("code is blank", "code is not 12 characters of the code alphabet")
  private val tokenProblems = setOf("token is blank", "token is not 22 characters of base64url")

  @Test
  fun `every shared code row is refused by name, or pairs`() {
    val rows = file.getJSONArray("codes")
    // The file's row count, so an emptied or truncated file cannot pass by sweeping nothing (PV12).
    assertEquals(17, rows.length())
    var refused = 0
    for (i in 0 until rows.length()) {
      val row = rows.getJSONObject(i)
      val problems = Configs.pairRequest(code = row.getString("value")).problems()
      val expected = if (row.getBoolean("ok")) 0 else 1
      assertEquals(expected, problems.size, "${row.getString("why")}: $problems")
      assertTrue(problems.all { it in codeProblems }, "${row.getString("why")}: $problems")
      refused += problems.size
    }
    assertEquals(13, refused, "the rows refused")
  }

  @Test
  fun `every shared token row is refused by name, or pairs`() {
    val rows = file.getJSONArray("tokens")
    assertEquals(14, rows.length())
    var refused = 0
    for (i in 0 until rows.length()) {
      val row = rows.getJSONObject(i)
      val problems = Configs.pairRequest(token = row.getString("value")).problems()
      val expected = if (row.getBoolean("ok")) 0 else 1
      assertEquals(expected, problems.size, "${row.getString("why")}: $problems")
      assertTrue(problems.all { it in tokenProblems }, "${row.getString("why")}: $problems")
      refused += problems.size
    }
    assertEquals(10, refused, "the rows refused")
  }

  @Test
  fun `T16 m1 the code's URL is exactly the code's own on the build's host`() {
    val code = "fx42hmnp7k2q"
    val own = "https://stg.seazn.club/api/v1/capture/codes/$code"
    val refused = "codeUrl is not the code's URL on stg.seazn.club"
    assertEquals(emptyList(), Configs.pairRequest(codeUrl = own).problems())
    // Each is a URL native would append `?slot=` to (Http.kt) and send the Bearer to.
    val rows =
      listOf(
        "a fragment" to "$own#x",
        "a query" to "$own?slot=9",
        "another code" to "https://stg.seazn.club/api/v1/capture/codes/fx42hmnp7k2r",
        "the pre-D3 path" to "https://stg.seazn.club/api/capture/codes/$code",
        "a trailing slash" to "$own/",
        "plain http" to "http://stg.seazn.club/api/v1/capture/codes/$code",
        "a port" to "https://stg.seazn.club:8443/api/v1/capture/codes/$code",
        "the production host on staging" to "https://seazn.club/api/v1/capture/codes/$code",
        "a foreign host" to "https://evil.io/api/v1/capture/codes/$code",
        "upper case" to "https://STG.seazn.club/api/v1/capture/codes/$code",
      )
    for ((why, url) in rows) assertEquals(listOf(refused), Configs.pairRequest(codeUrl = url).problems(), why)
  }

  @Test
  fun `the code's URL follows the environment`() {
    val prod =
      PairRequest(
        code = "fx42hmnp7k2q",
        slot = 1,
        token = Configs.TOKEN,
        codeUrl = "https://seazn.club/api/v1/capture/codes/fx42hmnp7k2q",
        heartbeatUrl = "https://seazn.club/api/v1/capture/codes/fx42hmnp7k2q/beats",
        startUrl = "https://seazn.club/api/v1/capture/codes/fx42hmnp7k2q/start",
        language = "en",
        automatic = true,
        claim = Claim.NEW,
        environment = Environment.PRODUCTION,
      )
    assertEquals(emptyList(), prod.problems())
  }
}
