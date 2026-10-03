package com.seazn.capture.engine.adapter

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

class JsonReaderTest {
  private fun malformed(text: String) = assertFailsWith<JsonReader.Malformed>(text) { JsonReader.parse(text) }

  @Test
  fun `objects - plain maps with string keys, in the order sent`() {
    val read = JsonReader.parse("""{"a":1,"b":{"c":"d"},"e":{}}""")
    assertEquals(mapOf("a" to 1.0, "b" to mapOf("c" to "d"), "e" to emptyMap<String, Any?>()), read)
    assertEquals(listOf("a", "b", "e"), (read as Map<*, *>).keys.toList())
  }

  @Test
  fun `arrays - plain lists of any value`() {
    assertEquals(listOf(1.0, "x", listOf(true, null), emptyMap<String, Any?>(), emptyList<Any?>()), JsonReader.parse("""[1,"x",[true,null],{},[]]"""))
    assertEquals(emptyList<Any?>(), JsonReader.parse("[]"))
  }

  @Test
  fun `strings - every escape, and a surrogate pair`() {
    val text = "\"q\\\" b\\\\ s\\/ \\b\\f\\n\\r\\t e\\u00e9 bat\\ud83c\\udfcf\""
    assertEquals("q\" b\\ s/ \b\u000c\n\r\t e\u00e9 bat\ud83c\udfcf", JsonReader.parse(text))
    assertEquals("", JsonReader.parse("\"\""))
  }

  @Test
  fun `numbers - integer, negative, fraction and exponent, each a Double`() {
    assertEquals(42.0, JsonReader.parse("42"))
    assertEquals(-7.0, JsonReader.parse("-7"))
    assertEquals(0.5, JsonReader.parse("0.5"))
    assertEquals(1000.0, JsonReader.parse("1e3"))
    assertEquals(0.025, JsonReader.parse("2.5E-2"))
    assertEquals(120.0, JsonReader.parse("1.2e+2"))
    assertEquals(0.0, JsonReader.parse("0"))
    assertEquals(1790003600.0, JsonReader.parse("1790003600"))
  }

  @Test
  fun `true, false and null`() {
    assertEquals(true, JsonReader.parse("true"))
    assertEquals(false, JsonReader.parse("false"))
    assertNull(JsonReader.parse("null"))
  }

  @Test
  fun `whitespace - space, tab, line feed and carriage return, around every token`() {
    assertEquals(mapOf("a" to listOf(1.0, 2.0)), JsonReader.parse(" \t\n\r{ \"a\" :\t[ 1 ,\n2 ] }\r\n "))
  }

  @Test
  fun `a trailing comma is malformed`() {
    malformed("[1,2,]")
    malformed("""{"a":1,}""")
  }

  @Test
  fun `an unterminated string is malformed`() {
    malformed("\"abc")
    malformed("""{"a":"b""")
    malformed("\"ends in an escape\\")
  }

  @Test
  fun `a bare word is malformed`() {
    for (word in listOf("tru", "nul", "hello", "True", "NULL", "NaN", "Infinity", "undefined")) malformed(word)
  }

  @Test
  fun `a lone surrogate escape is malformed`() {
    malformed("\"\\ud83c\"")
    malformed("\"\\udfcf\"")
    malformed("\"\\ud83cx\"")
    malformed("\"\\ud83c\\u0041\"")
    malformed("\"\\ud83c\\ud83c\"")
  }

  @Test
  fun `nesting deeper than 32 is malformed, 32 is read`() {
    assertEquals(32, depth(JsonReader.parse("[".repeat(32) + "]".repeat(32))))
    malformed("[".repeat(33) + "]".repeat(33))
    malformed("{\"a\":".repeat(33) + "1" + "}".repeat(33))
    assertTrue(JsonReader.parse("{\"a\":".repeat(32) + "1" + "}".repeat(32)) is Map<*, *>)
  }

  @Test
  fun `anything after the value is malformed`() {
    for (text in listOf("{} {}", "1 2", "\"a\"x", "null,", "[]]", "true false")) malformed(text)
  }

  @Test
  fun `an unescaped control character inside a string is malformed (RFC 8259, section 7)`() {
    malformed("\"a\u0001b\"")
    malformed("\"line\nbreak\"")
    malformed("\"tab\there\"")
    assertEquals("a\u007fb", JsonReader.parse("\"a\u007fb\""))
  }

  @Test
  fun `a number outside the grammar is malformed`() {
    for (text in listOf("01", "-", "1.", ".5", "1e", "1e+", "+1", "0x10", "1d", "1f", "--1", "-01", "1.e3")) malformed(text)
  }

  @Test
  fun `a u escape takes exactly four ASCII hex digits`() {
    malformed("\"\\u12\"")
    malformed("\"\\u12G4\"")
    // Fullwidth digits: Character.digit reads them as hex; JSON does not.
    malformed("\"\\u\uff11\uff12\uff13\uff14\"")
    assertEquals("\u00ff\u00FF", JsonReader.parse("\"\\u00ff\\u00FF\""))
  }

  @Test
  fun `an unknown escape is malformed`() {
    for (escape in listOf("\\x41", "\\'", "\\a", "\\0", "\\U0041")) malformed("\"$escape\"")
  }

  @Test
  fun `an empty text, or whitespace alone, is malformed`() {
    malformed("")
    malformed(" \n\t ")
  }

  @Test
  fun `a key that is not a string, a missing colon or a missing comma is malformed`() {
    // `{ab":1}`: read from the wrong place, `b` would pass as a key; only the key check refuses it.
    for (text in listOf("{a:1}", "{1:2}", "{ab\":1}", "{\"a\" 1}", "[1 2]", "{\"a\":1 \"b\":2}", "{", "[", "{\"a\"}")) malformed(text)
  }

  @Test
  fun `a repeated key keeps its last value, as JSON parse does in JS`() {
    assertEquals(mapOf("a" to 2.0), JsonReader.parse("""{"a":1,"a":2}"""))
  }

  @Test
  fun `Malformed names a position, never the text`() {
    val secret = "pass+phrase/6d1e8b0c"
    val failure = assertFailsWith<JsonReader.Malformed> { JsonReader.parse("""{"passphrase":"$secret",}""") }
    val message = failure.message ?: ""
    assertTrue(Regex("\\bat [0-9]+\\b").containsMatchIn(message), message)
    assertFalse(secret in message, message)
    assertFalse("passphrase" in message, message)
  }

  private fun depth(value: Any?): Int = if (value is List<*>) 1 + (value.firstOrNull()?.let(::depth) ?: 0) else 0
}
