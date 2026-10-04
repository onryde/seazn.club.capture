package com.seazn.capture.engine.adapter

import com.seazn.capture.engine.core.Shared
import kotlin.test.Test
import kotlin.test.assertEquals

/**
 * Carry T25 (the C4b gap hunt): the pair JS sends, end to end on the native side. Each row of
 * `wire/pair-intent-vectors.json` is what `intentWire` writes from `pairIntentFor` over the real
 * fetch code port (`pairIntentWire.test.ts` holds it to the row exactly). Here it crosses as Expo
 * hands it over, through JSON with every number a Double, and `PairMapping` must read it into a
 * request with no problems: the code's URL is held to its own on the build's host exactly.
 */
class PairIntentVectorsTest {
  private val rows = Shared.read("wire/pair-intent-vectors.json").getJSONArray("intents")

  @Suppress("UNCHECKED_CAST")
  private fun wire(index: Int): Map<String, Any?> = JsonReader.parse(rows.getJSONObject(index).getJSONObject("wire").toString()) as Map<String, Any?>

  @Test
  fun `every pair JS sends maps to a request native accepts, its URLs as sent`() {
    // The file's row count, so an emptied or truncated file cannot pass by sweeping nothing (PV12).
    assertEquals(2, rows.length())
    var checked = 0
    for (index in 0 until rows.length()) {
      val sent = wire(index)
      val request = PairMapping.request(sent)
      val name = rows.getJSONObject(index).getString("name")
      assertEquals(emptyList(), request.problems(), name)
      assertEquals(listOf(sent["code"], sent["slot"], sent["codeUrl"], sent["heartbeatUrl"], sent["startUrl"]), listOf(request.code, request.slot.toDouble(), request.codeUrl, request.heartbeatUrl, request.startUrl), name)
      assertEquals(listOf(sent["environment"], sent["claim"], sent["venueTimezone"]), listOf(request.environment.wire, request.claim.wire, request.venueTimezone), name)
      checked += 1
    }
    assertEquals(2, checked, "the rows checked")
  }

  @Test
  fun `a code URL that differs from the one JS sends only by a slash is refused by name`() {
    var refused = 0
    for (index in 0 until rows.length()) {
      val sent = wire(index)
      val url = sent["codeUrl"] as String
      val host = if (sent["environment"] == "production") "seazn.club" else "stg.seazn.club"
      // An origin read with its trailing slash kept: either after the code, or doubled before the path.
      for (bad in listOf("$url/", url.replace("/api/", "//api/"))) {
        val problems = PairMapping.request(sent + ("codeUrl" to bad)).problems()
        assertEquals(listOf("codeUrl is not the code's URL on $host"), problems, bad)
        refused += 1
      }
    }
    assertEquals(4, refused, "two rows, two near misses each")
  }
}
