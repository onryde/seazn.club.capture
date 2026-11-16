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

  /** The rows' problems: none for a pair JS sends; exactly the row's own for a `nativeOnly` one. */
  private fun problems(index: Int): List<String> =
    rows.getJSONObject(index).optJSONArray("problems")?.let { a -> (0 until a.length()).map(a::getString) } ?: emptyList()

  @Test
  fun `every pair JS sends maps to a request native accepts, its URLs as sent`() {
    // The file's row count, so an emptied or truncated file cannot pass by sweeping nothing (PV12).
    assertEquals(5, rows.length())
    var checked = 0
    var staged = 0
    var courted = 0
    for (index in 0 until rows.length()) {
      if (rows.getJSONObject(index).optBoolean("nativeOnly")) continue
      val sent = wire(index)
      val request = PairMapping.request(sent)
      val name = rows.getJSONObject(index).getString("name")
      assertEquals(emptyList(), request.problems(), name)
      assertEquals(listOf(sent["code"], sent["slot"], sent["codeUrl"], sent["heartbeatUrl"], sent["startUrl"]), listOf(request.code, request.slot.toDouble(), request.codeUrl, request.heartbeatUrl, request.startUrl), name)
      assertEquals(listOf(sent["environment"], sent["claim"], sent["venueTimezone"]), listOf(request.environment.wire, request.claim.wire, request.venueTimezone), name)
      // The round line and its match cross as sent, or as none: the first row sends both, the second neither.
      assertEquals(listOf(sent["stageLabel"], sent["stageMatch"]), listOf(request.stageLabel, request.stageMatch), name)
      // The court crosses as sent, or as none (court stream §6.1): the court row sends one, the others none.
      assertEquals(sent["court"], request.court, name)
      if (sent.containsKey("stageLabel")) staged += 1
      if (sent.containsKey("court")) courted += 1
      checked += 1
    }
    assertEquals(3, checked, "the rows checked")
    assertEquals(1, staged, "the rows that send a stage: a sweep that read none as none would pass the rest")
    assertEquals(1, courted, "the rows that send a court: nor one that read every court as none")
  }

  /** A malformed court is never no court (court stream §3): a fixture-style Stop on a court phone would unlink it. */
  @Test
  fun `a pair with a malformed court is refused by name, never read as no court`() {
    var refused = 0
    for (index in 0 until rows.length()) {
      if (!rows.getJSONObject(index).optBoolean("nativeOnly")) continue
      val name = rows.getJSONObject(index).getString("name")
      assertEquals(listOf("court is not 1 to 80 characters"), problems(index), name)
      assertEquals(problems(index), PairMapping.request(wire(index)).problems(), name)
      refused += 1
    }
    assertEquals(2, refused, "the nativeOnly rows")
  }

  @Test
  fun `a code URL that differs from the one JS sends only by a slash is refused by name`() {
    var refused = 0
    for (index in 0 until rows.length()) {
      if (rows.getJSONObject(index).optBoolean("nativeOnly")) continue
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
    assertEquals(6, refused, "three rows, two near misses each")
  }
}
