package com.seazn.capture.engine.adapter

import java.io.File
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull

class SlateColoursTest {
  private fun tokens(): String = File(System.getProperty("capture.tokens") ?: error("capture.tokens is not set: run through Gradle")).readText()

  private fun colours(): String = File(System.getProperty("capture.glue") ?: error("capture.glue is not set: run through Gradle"), "main/res/values/colors.xml").readText()

  @Test
  fun `M11 the slate's colours are the app's theme tokens, copied exactly`() {
    val pairs = listOf("ground" to "seazn_ground", "ink" to "seazn_ink")
    for ((token, resource) in pairs) {
      val theme = Regex("""\b$token:\s*'(#[0-9a-fA-F]{6})'""").find(tokens())?.groupValues?.get(1)
      val android = Regex("""name="$resource">(#[0-9a-fA-F]{6})<""").find(colours())?.groupValues?.get(1)
      assertNotNull(theme, "tokens.ts has no $token")
      assertEquals(theme.lowercase(), android?.lowercase(), token)
    }
    assertEquals(2, pairs.size, "both colours checked")
  }
}
