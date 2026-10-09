package com.seazn.capture.engine.adapter

import com.seazn.capture.engine.core.CodeAnswer
import com.seazn.capture.engine.core.Environment
import com.seazn.capture.engine.core.Vendored
import com.seazn.capture.engine.core.characters
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertIs
import kotlin.test.assertNotNull
import kotlin.test.assertNull

/**
 * Plan D spec §3.2: the web's round-line fixtures through Bodies.waiting, the reader of the waiting fields. The labels
 * are the fixtures' own text, written out; stageFixtures.test.ts holds the TS parser to the same four.
 *
 * Plan D1's D-9 read them here, not through Bodies.code, because at web 8afdd8b42 valid-live-stage's RTMPS cred named
 * `live.stg.seazn.club`, a host native refuses (W26). Since web 5a02cc4a5 every fixture names `live.cloudflare.com`,
 * so the live fixture also opens through Bodies.code, the reader a real answer goes through (the last test).
 */
class StageFixturesTest {
  @Suppress("UNCHECKED_CAST")
  private fun fixture(name: String): Map<String, Any?> =
    JsonReader.parse(Vendored.text("fixtures/capture-descriptor.v1/$name.json")) as Map<String, Any?>

  @Test
  fun `the web's round-line fixtures show their label verbatim`() {
    val rows =
      listOf(
        "valid-waiting-stage" to "Open · Group A · Round 1",
        "valid-live-stage" to "Open · QF",
        "valid-waiting-stage-label-40" to "Girls Under-14 Championship · Round 1234",
      )
    for ((name, label) in rows) assertEquals(label, Bodies.waiting(fixture(name), Environment.STAGING)?.stageLabel, name)
  }

  @Test
  fun `40 characters show and 41 are no line, the rest still read`() {
    assertEquals(40, "Girls Under-14 Championship · Round 1234".characters)
    val raw = fixture("invalid-stage-label-41")
    assertEquals(41, ((raw["stage"] as Map<*, *>)["label"] as String).characters)
    val read = assertNotNull(Bodies.waiting(raw, Environment.STAGING))
    assertNull(read.stageLabel)
    assertEquals("Northside Hawks v Riverside Rovers", read.label)
  }

  @Test
  fun `the live round-line fixture opens through Bodies code, its round line with it`() {
    val answer = Bodies.code(200, Vendored.text("fixtures/capture-descriptor.v1/valid-live-stage.json"), null, Environment.STAGING)
    val open = assertIs<CodeAnswer.Open>(answer)
    assertEquals("Open · QF", open.waiting?.stageLabel)
  }
}
