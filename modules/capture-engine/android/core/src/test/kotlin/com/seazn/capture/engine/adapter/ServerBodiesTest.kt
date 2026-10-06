package com.seazn.capture.engine.adapter

import com.seazn.capture.engine.core.Shared
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue
import org.json.JSONObject

/**
 * Review C4a m-4: the server [PairWire] plays answers with `wire/server-bodies.json`'s bodies, which
 * `serverBodies.test.ts` checks against the web's contracts with ajv. Read through the answers the
 * tests are served, not the builders, so what is checked is what the engine reads.
 */
class ServerBodiesTest {
  private val rows = Shared.read("wire/server-bodies.json").getJSONArray("bodies").let { a -> (0 until a.length()).map(a::getJSONObject) }

  private fun served(url: String, answer: (HttpRequest) -> HttpOutcome = PairWire::answer) =
    (answer(HttpRequest("GET", url, emptyList(), null)) as HttpOutcome.Answered).body

  @Test
  fun `m-4 each body the fake server answers with is the contract-checked vector of its name`() {
    val ours =
      mapOf(
        "pair-wire/beat-waiting" to served("${PairWire.ORIGIN}/beats"),
        "pair-wire/beat-live" to served("${PairWire.ORIGIN}/beats", PairWire::answerLive),
        "pair-wire/code-warming" to served("${PairWire.ORIGIN}?slot=1&phone=p"),
        "pair-wire/start-ok" to served("${PairWire.ORIGIN}/start"),
      )
    val vectors = rows.filter { it.getString("name").startsWith("pair-wire/") }
    assertEquals(ours.keys, vectors.map { it.getString("name") }.toSet())
    var checked = 0
    for (row in vectors) {
      val name = row.getString("name")
      assertTrue(JSONObject(ours.getValue(name)).similar(row.getJSONObject("body")), "$name: ${ours[name]}")
      checked += 1
    }
    assertEquals(4, checked, "the vectors' own count")
  }
}
