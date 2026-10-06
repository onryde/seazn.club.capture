package com.seazn.capture.engine.debug

import com.seazn.capture.engine.adapter.JsonReader
import com.seazn.capture.engine.core.Json
import kotlin.math.abs

/**
 * The scripted code server's rules (debug builds only, Task 34). Pure, so core's tests compile and
 * run it; it never reaches a release. Per route, the script's answers in order, the last repeating;
 * a new script version starts every route from its first answer.
 */
class ScriptAnswers {
  sealed interface Result {
    data object Pass : Result

    data object Unreadable : Result

    data object Unscripted : Result

    data object Fail : Result

    class Answer(val route: String, val status: Int, val body: String, val retryAfter: String?) : Result {
      override fun toString() = "Answer(route=$route, status=$status, body=<${body.length} chars>)"
    }
  }

  class Script(val text: String, val version: Long)

  private var version: Long? = null
  private var routes: Map<*, *>? = null
  private val cursors = mutableMapOf<String, Int>()

  @Synchronized
  fun answer(method: String, url: String, script: Script?): Result {
    val route = route(method, url) ?: return Result.Pass
    if (script == null) return Result.Pass
    val loaded = load(script) ?: return Result.Unreadable
    val list = (loaded[route] as? List<*>)?.takeIf { it.isNotEmpty() } ?: return Result.Unscripted
    val at = cursors.getOrDefault(route, 0)
    cursors[route] = at + 1
    val entry = list[minOf(at, list.size - 1)] as? Map<*, *> ?: return Result.Unreadable
    return read(route, entry)
  }

  /** Writes a parsed value back as JSON: a whole number as an integer, as the server writes it. */
  internal fun write(value: Any?): String =
    when (value) {
      null -> "null"
      is String -> Json.string(value)
      is Boolean -> value.toString()
      is Double -> if (value % 1.0 == 0.0 && abs(value) < MAX_EXACT) value.toLong().toString() else value.toString()
      is Map<*, *> -> value.entries.joinToString(",", "{", "}") { (key, inner) -> Json.string(key.toString()) + ":" + write(inner) }
      is List<*> -> value.joinToString(",", "[", "]") { write(it) }
      else -> Json.string(value.toString())
    }

  /**
   * The code paths only (A5, _Who reads what_), as the phone API names them (D3): `GET` the code, `POST`
   * its `/beats` and its `/start`. Anything else, another method on those paths included, passes.
   */
  private fun route(method: String, url: String): String? {
    val path = url.substringBefore('?').substringBefore('#')
    val at = path.indexOf(CODE_PATH)
    if (at < 0) return null
    val parts = path.substring(at + CODE_PATH.length).split('/')
    return when {
      parts.size == 1 && method == "GET" -> "code"
      parts.size == 2 && parts[1] == "beats" && method == "POST" -> "beat"
      parts.size == 2 && parts[1] == "start" && method == "POST" -> "start"
      else -> null
    }
  }

  private fun load(script: Script): Map<*, *>? {
    if (script.version != version) {
      version = script.version
      cursors.clear()
      routes =
        try {
          JsonReader.parse(script.text) as? Map<*, *>
        } catch (_: JsonReader.Malformed) {
          null
        }
    }
    return routes
  }

  private fun read(route: String, entry: Map<*, *>): Result {
    if (entry["fail"] == true) return Result.Fail
    val status = (entry["status"] as? Double)?.toInt() ?: return Result.Unreadable
    val body = if (entry.containsKey("body")) write(entry["body"]) else ""
    return Result.Answer(route, status, body, entry["retryAfter"] as? String)
  }

  private companion object {
    const val MAX_EXACT = 9.0e15

    /** The phone API's code path (D3), as `PairRequest` checks the code's URL. */
    const val CODE_PATH = "/api/v1/capture/codes/"
  }
}
