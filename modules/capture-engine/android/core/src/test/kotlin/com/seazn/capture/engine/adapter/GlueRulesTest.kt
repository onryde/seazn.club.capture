package com.seazn.capture.engine.adapter

import java.io.File
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue
import org.junit.jupiter.api.Assumptions.assumeTrue

/**
 * The rules the endpoint and streamer glue would otherwise hold, read from the glue's own source: the
 * calls this programme has paid to learn are wrong. The glue module (`modules/capture-engine/android`)
 * arrives in Tasks 33–36, batch C6. Until then its rules report SKIPPED, never a vacuous pass, and come
 * live in C6, when Task 33 and Task 34 each delete their assumption.
 */
class GlueRulesTest {
  private val src = File(System.getProperty("capture.glue") ?: error("capture.glue is not set: run through Gradle"))
  private val root = File(src, "main/java")

  /**
   * The glue's main Kotlin files. Until Task 33 the folder does not exist, and every rule here reports
   * SKIPPED, never a vacuous pass; Task 33 deletes the assumption. A folder that exists but holds no
   * Kotlin is a wrong path, and fails.
   */
  private fun sources(): List<File> {
    assumeTrue(root.exists(), "the glue arrives in Task 33 (batch C6)") // Task 33 deletes this line.
    return root.walkTopDown().filter { it.extension == "kt" }.toList().also { assertTrue(it.isNotEmpty(), "no Kotlin under ${root.path}") }
  }

  /** Never skipped: the skips below are honest only while this path is the glue module's own `src`. */
  @Test
  fun `the rules read the glue module's src, beside this core build`() {
    assertEquals("src", src.name, src.path)
    assertTrue(File(src.parentFile, "core/settings.gradle.kts").isFile, "${src.path} is not beside the core build")
  }

  @Test
  fun `F-P5-6 no glue code calls setTargetRotation`() {
    for (file in sources()) assertFalse("setTargetRotation(" in file.readText(), file.path)
  }

  @Test
  fun `CD30 StreamPack's logger is replaced before any streamer exists`() {
    val assigned = sources().filter { "Logger.logger = VendorLogger" in it.readText() }
    assertEquals(listOf("EngineHost.kt"), assigned.map { it.name }, "one assignment, in EngineHost's first use")
  }

  @Test
  fun `Review Focus 1 nothing in the glue blocks the scheduler thread`() {
    for (file in sources()) {
      val text = file.readText()
      assertFalse("runBlocking" in text, "${file.path}: runBlocking")
      if (!file.path.endsWith("srt/SeaznSrtSink.kt")) assertFalse("InetAddress" in text, "${file.path}: a DNS lookup outside the sink's IO dispatcher")
    }
  }

  @Test
  fun `the glue never attaches StreamPack's lifecycle observer, logs to the console, or names a service`() {
    for (file in sources()) {
      val text = file.readText()
      for (banned in listOf("StreamerLifeCycleObserver", "android.util.Log", "println(", "streampack.services")) assertFalse(banned in text, "${file.path}: $banned")
    }
  }

  @Test
  fun `A11 the encode's rotation never reads the display`() {
    for (file in sources()) {
      val text = file.readText()
      for (banned in listOf("defaultDisplay", "display.rotation", "display?.rotation", "getRotation()")) assertFalse(banned in text, "${file.path}: $banned")
    }
  }

  /**
   * Security: the scripted code server (Task 34) and its file are debug-only. A release build carries
   * none of it. Until Task 34 its folder does not exist, and the rule reports SKIPPED.
   */
  @Test
  fun `the scripted code server lives in the debug source set only, and nothing else names it`() {
    val debug = File(src, "debug/java")
    assumeTrue(debug.exists(), "the scripted server arrives in Task 34 (batch C6)") // Task 34 deletes this line.
    val scripted = debug.walkTopDown().filter { it.extension == "kt" && "ScriptedCodeServer" in it.readText() }.toList()
    assertTrue(scripted.isNotEmpty(), "no ScriptedCodeServer under ${debug.path}: wrong path")
    for (file in sources()) {
      val text = file.readText()
      for (banned in listOf("ScriptedCodeServer", "scripted-code.json")) assertFalse(banned in text, "${file.path}: $banned")
    }
    assertFalse(File(src, "release").exists(), "a release source set must not exist beside the debug one")
  }
}
