package com.seazn.capture.engine.adapter

/**
 * RFC 8259 JSON, read into plain values: `Map<String, Any?>` (in the order sent; a repeated key keeps
 * its last value, as `JSON.parse` does in JS), `List<Any?>`, `String`, `Double`, `Boolean` or null.
 * The core writes JSON but never read it, and `org.json` is test-only there, so the server's bodies
 * are read here: one implementation on the JVM, for the glue and the host alike (Task 15).
 *
 * Strict: one value, then only whitespace; nesting at most [MAX_DEPTH]; a `\u` escape is four ASCII
 * hex digits and never leaves a lone surrogate; no raw control character inside a string; numbers as
 * the grammar spells them, each a Double. Anything else throws [Malformed], and nothing else is thrown.
 */
object JsonReader {
  /** Deep enough for every body the server sends; shallow enough that the recursion is bounded. */
  const val MAX_DEPTH = 32

  /** [reason] names a position, never the text: a body can hold a secret. */
  class Malformed(reason: String) : Exception(reason)

  fun parse(text: String): Any? {
    val cursor = Cursor(text)
    cursor.space()
    val value = cursor.value(depth = 0)
    cursor.space()
    if (!cursor.done) throw cursor.fail("text after the value")
    return value
  }

  private class Cursor(private val text: String) {
    private var at = 0

    val done: Boolean
      get() = at >= text.length

    fun fail(what: String) = Malformed("$what at $at")

    fun space() {
      while (!done && text[at] in WHITESPACE) at += 1
    }

    fun value(depth: Int): Any? {
      if (done) throw fail("no value")
      return when (text[at]) {
        '{' -> obj(depth + 1)
        '[' -> list(depth + 1)
        '"' -> string()
        't' -> literal("true", true)
        'f' -> literal("false", false)
        'n' -> literal("null", null)
        else -> number()
      }
    }

    private fun obj(depth: Int): Map<String, Any?> {
      if (depth > MAX_DEPTH) throw fail("nesting deeper than $MAX_DEPTH")
      at += 1
      val map = LinkedHashMap<String, Any?>()
      space()
      if (take('}')) return map
      do {
        space()
        if (done || text[at] != '"') throw fail("a key that is not a string")
        val key = string()
        space()
        if (!take(':')) throw fail("no colon")
        space()
        map[key] = value(depth)
        space()
      } while (take(','))
      if (!take('}')) throw fail("an unclosed object")
      return map
    }

    private fun list(depth: Int): List<Any?> {
      if (depth > MAX_DEPTH) throw fail("nesting deeper than $MAX_DEPTH")
      at += 1
      val items = ArrayList<Any?>()
      space()
      if (take(']')) return items
      do {
        space()
        items += value(depth)
        space()
      } while (take(','))
      if (!take(']')) throw fail("an unclosed array")
      return items
    }

    private fun string(): String {
      val start = at
      at += 1
      val out = StringBuilder()
      while (true) {
        if (done) throw Malformed("an unterminated string at $start")
        val char = text[at]
        at += 1
        when {
          char == '"' -> return out.toString()
          char == '\\' -> escape(out)
          char < ' ' -> throw fail("a control character in a string")
          else -> out.append(char)
        }
      }
    }

    private fun escape(out: StringBuilder) {
      if (done) throw fail("an unterminated escape")
      val char = text[at]
      at += 1
      when (char) {
        'u' -> unicode(out)
        else -> out.append(ESCAPES[char] ?: throw fail("an unknown escape"))
      }
    }

    /** A pair of `\u` escapes for a character past U+FFFF; a surrogate alone is not a character. */
    private fun unicode(out: StringBuilder) {
      val unit = hex4()
      when {
        unit.isLowSurrogate() -> throw fail("a lone low surrogate")
        unit.isHighSurrogate() -> {
          if (!(take('\\') && take('u'))) throw fail("a lone high surrogate")
          val low = hex4()
          if (!low.isLowSurrogate()) throw fail("a lone high surrogate")
          out.append(unit).append(low)
        }
        else -> out.append(unit)
      }
    }

    /** Four ASCII hex digits: `Character.digit` also reads fullwidth ones, which JSON does not. */
    private fun hex4(): Char {
      if (at + 4 > text.length) throw fail("a short unicode escape")
      var code = 0
      repeat(4) {
        val char = text[at]
        val digit = if (char.code < 128) HEX.indexOf(char.lowercaseChar()) else -1
        if (digit < 0) throw fail("a unicode escape that is not hex")
        code = code * 16 + digit
        at += 1
      }
      return code.toChar()
    }

    private fun literal(word: String, value: Boolean?): Boolean? {
      if (!text.startsWith(word, at)) throw fail("a bare word")
      at += word.length
      return value
    }

    /** `-? (0 | [1-9][0-9]*) (. [0-9]+)? ([eE] [+-]? [0-9]+)?`, checked before `toDouble`, which reads more. */
    private fun number(): Double {
      val start = at
      take('-')
      when {
        take('0') -> Unit
        digit() in '1'..'9' -> digits()
        else -> throw fail("not a value")
      }
      if (take('.')) {
        if (digits() == 0) throw fail("a fraction with no digits")
      }
      if (take('e') || take('E')) {
        if (!take('+')) take('-')
        if (digits() == 0) throw fail("an exponent with no digits")
      }
      return text.substring(start, at).toDouble()
    }

    private fun digit(): Char? = if (done) null else text[at]

    private fun digits(): Int {
      val start = at
      while (!done && text[at] in '0'..'9') at += 1
      return at - start
    }

    private fun take(char: Char): Boolean {
      if (done || text[at] != char) return false
      at += 1
      return true
    }
  }

  private const val WHITESPACE = " \t\n\r"
  private const val HEX = "0123456789abcdef"
  private val ESCAPES = mapOf('"' to '"', '\\' to '\\', '/' to '/', 'b' to '\b', 'f' to '\u000c', 'n' to '\n', 'r' to '\r', 't' to '\t')
}
