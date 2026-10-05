package com.seazn.capture.engine.adapter

import java.io.File
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

/**
 * The rules the endpoint and streamer glue would otherwise hold, read from the glue's own source: the
 * calls this programme has paid to learn are wrong. The glue module (`modules/capture-engine/android`)
 * arrived in Task 33 (batch C6), which made these rules live.
 */
class GlueRulesTest {
  private val src = File(System.getProperty("capture.glue") ?: error("capture.glue is not set: run through Gradle"))
  private val root = File(src, "main/java")

  /** The glue's main Kotlin files. A folder that holds no Kotlin, or none at all, is a wrong path, and fails. */
  private fun sources(): List<File> =
    root.walkTopDown().filter { it.extension == "kt" }.toList().also { assertTrue(it.isNotEmpty(), "no Kotlin under ${root.path}") }

  /** The rules below are honest only while this path is the glue module's own `src`. */
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

  /**
   * StreamPack 3.2.0's own display readers (javap): `ContextExtensionsKt.getDisplayRotation`, which Kotlin
   * reads as `context.displayRotation`, is `ContextCompat.getDisplayOrDefault(context).getRotation()`; its
   * rotation providers follow the display or the sensor, moving the encode mid-broadcast (F-P5-6).
   */
  private val displayReaders =
    listOf(
      "defaultDisplay",
      "display.rotation",
      "display?.rotation",
      "getRotation()",
      "displayRotation",
      "DisplayRotation",
      "getDisplayOrDefault",
      "RotationProvider",
    )

  /**
   * Every StreamPack 3.2.0 streamer factory and constructor (`cameraSingleStreamer`, `SingleStreamer`,
   * the video-only, media-projection and dual ones, the `Impl`s) and `StreamerPipeline.createEncodingOutput`
   * default `defaultRotation` to `getDisplayRotation(context)` (javap of each `$default`). A call that
   * leaves it out encodes from the display.
   */
  private val streamerCall = Regex("""\b(?:\w*(?:Single|Dual)Streamer(?:Impl)?|createEncodingOutput)\(""")

  /** The call's argument text, from its `(` at [open] to the matching `)`; the rest of the file if unbalanced. */
  private fun arguments(text: String, open: Int): String {
    var depth = 0
    for (i in open until text.length) {
      when (text[i]) {
        '(' -> depth++
        ')' -> if (--depth == 0) return text.substring(open, i + 1)
      }
    }
    return text.substring(open)
  }

  @Test
  fun `A11 the encode's rotation never reads the display, StreamPack's default included`() {
    val problems = mutableListOf<String>()
    for (file in sources()) {
      val text = file.readText()
      for (banned in displayReaders) if (banned in text) problems += "${file.name}: $banned"
      for (call in streamerCall.findAll(text)) {
        val args = arguments(text, call.range.last)
        if (!Regex("""\bdefaultRotation\s*=""").containsMatchIn(args)) problems += "${file.name}: ${call.value} with no defaultRotation ="
      }
    }
    assertEquals(emptyList(), problems)
  }

  /**
   * Security: `cred` is read in `Bodies` and nowhere else, onto the ingest host only (amendment, _Who reads
   * what_), and `SrtOptions.plan`'s all-environment host list rests on Bodies being the only producer of a
   * target (review 19, m8). The glue receives targets; it never builds one.
   */
  @Test
  fun `the glue never builds an ingest target - Bodies alone reads cred`() {
    val built = Regex("""\b(?:SrtTarget|RtmpsTarget)\(""")
    val problems = sources().flatMap { file -> built.findAll(file.readText()).map { "${file.name}: ${it.value}" }.toList() }
    assertEquals(emptyList(), problems)
  }

  /**
   * Security: the scripted code server (Task 34) and its file are debug-only. A release build carries
   * none of it: nothing in main names it, the main manifest declares no part of it, and the debug
   * manifest declares its installer.
   */
  @Test
  fun `the scripted code server lives in the debug source set only, and nothing else names it`() {
    val debug = File(src, "debug/java")
    val scripted = debug.walkTopDown().filter { it.extension == "kt" && "ScriptedCodeServer" in it.readText() }.toList()
    assertTrue(scripted.isNotEmpty(), "no ScriptedCodeServer under ${debug.path}: wrong path")
    for (file in sources()) {
      val text = file.readText()
      for (banned in listOf("ScriptedCodeServer", "scripted-code.json")) assertFalse(banned in text, "${file.path}: $banned")
    }
    assertFalse(File(src, "release").exists(), "a release source set must not exist beside the debug one")
    val manifest = File(src, "main/AndroidManifest.xml").readText()
    assertFalse("scripted" in manifest.lowercase(), "the main manifest names the scripted server")
    assertTrue(File(src, "debug/AndroidManifest.xml").readText().contains("ScriptedServerInstaller"), "the installer is declared in the debug manifest")
  }
}
