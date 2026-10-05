package com.seazn.capture.engine.adapter

import org.json.JSONObject

/**
 * Final review I-2b: the staging beat the web lane captured on 2026-10-05 (`POST …/beats`, 200, the phone
 * armed), its overlay key redacted and nothing else changed. [body] is its `body` alone; `_meta` says how it
 * was taken. A fresh copy each read, so no test can change another's.
 */
object StgBeat {
  private val text = StgBeat::class.java.getResource("/stg-beat-waiting.redacted.json")!!.readText()

  val body: JSONObject
    get() = JSONObject(text).getJSONObject("body")

  /** The body with [field] set to [value] (null is JSON's null). */
  fun with(field: String, value: Any?): String = body.put(field, value ?: JSONObject.NULL).toString()
}
