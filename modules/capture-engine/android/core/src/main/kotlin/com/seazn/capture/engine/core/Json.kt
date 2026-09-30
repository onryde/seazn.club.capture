package com.seazn.capture.engine.core

/** A value with the spelling the spec uses on the wire (spec §2). The bridge copies [wire] verbatim. */
interface Wire {
  val wire: String
}

/** A nested JSON object, fields in order. */
data class JsonObject(val fields: List<Pair<String, Any?>>)

/**
 * A number with one decimal, formatted by hand. `String.format` follows the phone's locale, and a
 * French, Dutch or Spanish phone would write `1,5` into a JSON body (AGENTS §10, question 4).
 */
class Decimal private constructor(val text: String) {
  override fun equals(other: Any?): Boolean = other is Decimal && other.text == text

  override fun hashCode(): Int = text.hashCode()

  override fun toString(): String = text

  companion object {
    /** Rounded half away from zero to one decimal; null for NaN or infinity, which JSON cannot hold. */
    fun tenths(value: Double): Decimal? {
      if (!value.isFinite()) return null
      val scaled = Math.round(Math.abs(value) * 10)
      val sign = if (value < 0 && scaled != 0L) "-" else ""
      return Decimal("$sign${scaled / 10}.${scaled % 10}")
    }
  }
}

/**
 * The only JSON the core writes: the heartbeat body and session-record lines. Hand-rolled so the
 * core has no dependency. It reads nothing: responses arrive already typed from the platform.
 */
object Json {
  fun obj(fields: List<Pair<String, Any?>>): String =
    fields.joinToString(",", "{", "}") { (key, value) -> "${string(key)}:${value(value)}" }

  fun value(value: Any?): String =
    when (value) {
      null -> "null"
      is String -> string(value)
      is Boolean, is Int, is Long -> value.toString()
      is Decimal -> value.text
      is Wire -> string(value.wire)
      is JsonObject -> obj(value.fields)
      else -> throw IllegalArgumentException("not a JSON value: ${value::class.simpleName}")
    }

  fun string(text: String): String {
    val out = StringBuilder(text.length + 2).append('"')
    for (char in text) {
      when {
        char == '"' -> out.append("\\\"")
        char == '\\' -> out.append("\\\\")
        char == '\n' -> out.append("\\n")
        char == '\r' -> out.append("\\r")
        char == '\t' -> out.append("\\t")
        char < ' ' -> out.append("\\u").append(char.code.toString(16).padStart(4, '0'))
        else -> out.append(char)
      }
    }
    return out.append('"').toString()
  }
}

/**
 * Epoch milliseconds as ISO-8601 UTC. Not `java.time`: the app's minSdk is 24 and `java.time`
 * arrives in API 26, without desugaring. The date arithmetic is Howard Hinnant's civil-from-days.
 */
object IsoTime {
  private const val DAY_MS = 86_400_000L

  fun utc(epochMs: Long): String {
    val days = epochMs.floorDiv(DAY_MS)
    val msOfDay = epochMs.mod(DAY_MS)
    val (year, month, day) = civil(days)
    return "${pad(year, 4)}-${pad(month, 2)}-${pad(day, 2)}T" +
      "${pad(msOfDay / 3_600_000, 2)}:${pad(msOfDay / 60_000 % 60, 2)}:" +
      "${pad(msOfDay / 1_000 % 60, 2)}.${pad(msOfDay % 1_000, 3)}Z"
  }

  private fun civil(daysSinceEpoch: Long): Triple<Long, Long, Long> {
    val z = daysSinceEpoch + 719_468
    val era = z.floorDiv(146_097L)
    val dayOfEra = z - era * 146_097
    val yearOfEra = (dayOfEra - dayOfEra / 1_460 + dayOfEra / 36_524 - dayOfEra / 146_096) / 365
    val dayOfYear = dayOfEra - (365 * yearOfEra + yearOfEra / 4 - yearOfEra / 100)
    val shiftedMonth = (5 * dayOfYear + 2) / 153
    val day = dayOfYear - (153 * shiftedMonth + 2) / 5 + 1
    val month = if (shiftedMonth < 10) shiftedMonth + 3 else shiftedMonth - 9
    val year = yearOfEra + era * 400 + if (month <= 2) 1 else 0
    return Triple(year, month, day)
  }

  private fun pad(value: Long, width: Int): String = value.toString().padStart(width, '0')
}
