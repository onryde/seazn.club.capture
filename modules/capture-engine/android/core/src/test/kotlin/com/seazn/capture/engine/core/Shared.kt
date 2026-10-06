package com.seazn.capture.engine.core

import java.io.File
import org.json.JSONObject

/** A vector file shared with the JS side, under `modules/capture-engine/src/`. */
object Shared {
  fun read(path: String): JSONObject {
    val root = System.getProperty("capture.shared") ?: error("capture.shared is not set: run through Gradle")
    return JSONObject(File(root, path).readText(Charsets.UTF_8))
  }
}
