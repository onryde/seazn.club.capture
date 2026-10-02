package com.seazn.capture.engine.adapter

import com.seazn.capture.engine.core.Json
import kotlin.math.abs

/**
 * A wire value as one JSON text, for the shared vectors' test and the JVM host. Expo never reads it:
 * Expo takes the map itself. It writes what the wire holds — a map with string keys, a list, a
 * string, a boolean, null and a Double — and refuses anything else by name. An Int or a Long is
 * refused too: every wire number is a Double (JS has one number type), so an Int here is a field
 * [SnapshotWire] forgot to convert.
 */
object WireJson {
  /** 2^53: every whole Double up to here is an exact Long, and a JS number reads it back exactly. */
  private const val EXACT = 9_007_199_254_740_992.0

  fun encode(value: Any?): String = StringBuilder().also { write(value, it) }.toString()

  private fun write(value: Any?, out: StringBuilder) {
    when (value) {
      null -> out.append("null")
      is String -> out.append(Json.string(value))
      is Boolean -> out.append(value)
      is Double -> out.append(number(value))
      is Map<*, *> -> obj(value, out)
      is List<*> -> list(value, out)
      else -> throw IllegalArgumentException("not a wire value: ${value::class.simpleName}")
    }
  }

  /**
   * Whole, and within 2^53: no `.0`, as JS writes it. Otherwise Kotlin's own form, which JSON reads
   * (`29.5`, `1.0E20`). Neither follows the phone's locale. JSON holds no NaN or infinity: null.
   */
  private fun number(value: Double): String =
    when {
      !value.isFinite() -> "null"
      value % 1.0 == 0.0 && abs(value) <= EXACT -> value.toLong().toString()
      else -> value.toString()
    }

  private fun obj(map: Map<*, *>, out: StringBuilder) {
    out.append('{')
    for ((index, entry) in map.entries.withIndex()) {
      val key = entry.key as? String ?: throw IllegalArgumentException("a wire key is a string, not ${entry.key}")
      if (index > 0) out.append(',')
      out.append(Json.string(key)).append(':')
      write(entry.value, out)
    }
    out.append('}')
  }

  private fun list(items: List<*>, out: StringBuilder) {
    out.append('[')
    for ((index, item) in items.withIndex()) {
      if (index > 0) out.append(',')
      write(item, out)
    }
    out.append(']')
  }
}
