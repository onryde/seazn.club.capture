package com.seazn.capture.engine.adapter

import java.util.Locale
import kotlin.test.AfterTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import org.json.JSONObject

class WireJsonTest {
  private val saved = Locale.getDefault()

  @AfterTest
  fun restoreLocale() = Locale.setDefault(saved)

  @Test
  fun `a whole double is written without its point, as JS writes it`() {
    assertEquals("1790000000000", WireJson.encode(1_790_000_000_000.0))
    assertEquals("0", WireJson.encode(0.0))
    assertEquals("-3", WireJson.encode(-3.0))
    // 2^53, the last whole number a JS number holds exactly.
    assertEquals("9007199254740992", WireJson.encode(9_007_199_254_740_992.0))
  }

  @Test
  fun `a whole double past 2^53 stays a JSON number, read back exactly`() {
    for (value in listOf(1e20, -1e300)) {
      assertEquals(value, JSONObject("""{"v":${WireJson.encode(value)}}""").getDouble("v"))
    }
  }

  @Test
  fun `a fraction is written the same in every language the app speaks`() {
    for (locale in listOf(Locale.UK, Locale.FRANCE, Locale.forLanguageTag("nl-NL"), Locale.forLanguageTag("es-ES"))) {
      Locale.setDefault(locale)
      assertEquals("29.5", WireJson.encode(29.5), "$locale")
      assertEquals("0.6", WireJson.encode(0.6), "$locale")
      assertEquals("-7.25", WireJson.encode(-7.25), "$locale")
    }
  }

  @Test
  fun `a non-finite double is null, which JSON can hold`() {
    for (value in listOf(Double.NaN, Double.POSITIVE_INFINITY, Double.NEGATIVE_INFINITY)) assertEquals("null", WireJson.encode(value))
  }

  @Test
  fun `objects and lists keep their order, and strings are escaped`() {
    val value =
      linkedMapOf(
        "z" to true,
        "a" to null,
        "list" to listOf("say \"hi\"", false, 1.5),
        "nested" to linkedMapOf("b" to "line\nbreak", "a" to "\u0001"),
        "empty" to emptyMap<String, Any?>(),
      )
    assertEquals(
      """{"z":true,"a":null,"list":["say \"hi\"",false,1.5],"nested":{"b":"line\nbreak","a":"\u0001"},"empty":{}}""",
      WireJson.encode(value),
    )
  }

  @Test
  fun `every wire number is a Double, so any other value is refused by name`() {
    for (value in listOf<Any>(1, 1L, 1.5f, Any(), arrayOf("x"))) {
      assertFailsWith<IllegalArgumentException>("$value") { WireJson.encode(value) }
      assertFailsWith<IllegalArgumentException>("$value nested") { WireJson.encode(mapOf("n" to listOf(value))) }
    }
    assertFailsWith<IllegalArgumentException>("a key that is not a string") { WireJson.encode(mapOf(1.0 to "x")) }
  }
}
