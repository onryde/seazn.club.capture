package com.seazn.capture.engine.host

import com.seazn.capture.engine.adapter.WireJson
import org.json.JSONArray
import org.json.JSONObject

/** The host's NDJSON: stdin lines in, as Expo would hand them to the module; events out, one line each. */
object Protocol {
  /**
   * A stdin object as Expo hands one over: every number a `Double` (org.json reads an `Int`, a
   * `Long`, a `BigInteger` or a `BigDecimal`, so each is converted; review 11, gap 2), every nested
   * object a map, every array a list, and JSON's null a null.
   */
  fun toWire(json: JSONObject): Map<String, Any?> = json.keySet().associateWith { value(json.get(it)) }

  /** `{"ev": event, ...fields}` on one line, through the wire's own writer: numbers as JS writes them. */
  fun encode(event: String, fields: Map<String, Any?>): String = WireJson.encode(linkedMapOf<String, Any?>("ev" to event) + fields)

  /** An `AsyncFunction`'s answer: `{"ev":"scoringLink","call":N,"answer":{…}}`, the call it resolves and the value Expo would resolve it with. */
  fun scoringLink(call: Int, answer: Map<String, Any?>): String = encode("scoringLink", mapOf("call" to call.toDouble(), "answer" to answer))

  private fun value(raw: Any?): Any? =
    when (raw) {
      null, JSONObject.NULL -> null
      is Number -> raw.toDouble()
      is JSONObject -> toWire(raw)
      is JSONArray -> (0 until raw.length()).map { value(raw.get(it)) }
      else -> raw
    }
}
