package com.seazn.capture.engine.core

import java.io.File

/** A file of the web's contracts, vendored under the repo's `contracts/` (plan D spec §3.1), by its path there. */
object Vendored {
  fun text(path: String): String {
    val root = System.getProperty("capture.contracts") ?: error("capture.contracts is not set: run through Gradle")
    return File(root, path).readText(Charsets.UTF_8)
  }
}
