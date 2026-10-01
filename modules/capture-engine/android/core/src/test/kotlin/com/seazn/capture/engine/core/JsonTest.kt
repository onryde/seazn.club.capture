package com.seazn.capture.engine.core

import java.util.Locale
import kotlin.test.AfterTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertNull

class JsonTest {
  private val saved = Locale.getDefault()

  @AfterTest
  fun restoreLocale() = Locale.setDefault(saved)

  private enum class Colour(override val wire: String) : Wire {
    LIME("lime-led")
  }

  @Test
  fun `an object keeps field order and writes each JSON type`() {
    val text =
      Json.obj(
        listOf(
          "s" to "a",
          "n" to null,
          "b" to true,
          "i" to 7,
          "l" to 9_000_000_000L,
          "d" to Decimal.tenths(1.25),
          "w" to Colour.LIME,
          "o" to JsonObject(listOf("x" to 1)),
        )
      )
    assertEquals(
      """{"s":"a","n":null,"b":true,"i":7,"l":9000000000,"d":1.3,"w":"lime-led","o":{"x":1}}""",
      text,
    )
  }

  @Test
  fun `strings are escaped, control characters included`() {
    assertEquals("\"a\\\"b\\\\c\\nd\\u0001\"", Json.string("a\"b\\c\nd\u0001"))
  }

  @Test
  fun `decimals never follow the phone's locale`() {
    for (locale in listOf(Locale.FRANCE, Locale.GERMANY, Locale.forLanguageTag("nl-NL"), Locale.forLanguageTag("es-ES"))) {
      Locale.setDefault(locale)
      assertEquals("""{"v":1.5}""", Json.obj(listOf("v" to Decimal.tenths(1.5))))
    }
  }

  @Test
  fun `tenths round half away from zero and keep the sign`() {
    assertEquals("0.1", Decimal.tenths(0.05)?.text)
    assertEquals("-2.5", Decimal.tenths(-2.46)?.text)
    assertEquals("12.0", Decimal.tenths(12.0)?.text)
    assertEquals("0.0", Decimal.tenths(-0.04)?.text) // 0.4 tenths rounds to zero, which has no sign
  }

  @Test
  fun `a number that is not finite has no decimal`() {
    assertNull(Decimal.tenths(Double.NaN))
    assertNull(Decimal.tenths(Double.POSITIVE_INFINITY))
  }

  @Test
  fun `a value JSON cannot hold is refused, not stringified`() {
    assertFailsWith<IllegalArgumentException> { Json.value(Any()) }
  }

  // Expected strings from `date -u -r <seconds>`, never from the code under test.
  @Test
  fun `epoch milliseconds become ISO-8601 UTC without java time`() {
    assertEquals("1970-01-01T00:00:00.000Z", IsoTime.utc(0))
    assertEquals("2026-09-21T14:13:20.000Z", IsoTime.utc(1_790_000_000_000))
    assertEquals("2026-09-30T14:32:05.123Z", IsoTime.utc(1_790_778_725_123))
    assertEquals("2000-03-01T00:00:00.000Z", IsoTime.utc(951_868_800_000))
    assertEquals("2028-02-29T23:59:59.999Z", IsoTime.utc(1_835_481_599_999))
  }
}
