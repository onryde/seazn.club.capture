package com.seazn.capture.engine.adapter

import com.seazn.capture.engine.core.Shared
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

  /** C6 m-4: komuxer's logger, RTMPS's, is replaced beside StreamPack's, before the first streamer, in the same build. */
  @Test
  fun `C6 m-4 komuxer's logger is replaced beside StreamPack's`() {
    val assigned = sources().filter { "KomuxerLogger.logger = KomuxerVendorLogger" in it.readText() }
    assertEquals(listOf("EngineHost.kt"), assigned.map { it.name }, "one assignment, in EngineHost")
    val host = assigned.single().readText()
    val build = host.substring(host.indexOf("private fun build("))
    assertTrue(build.indexOf("KomuxerLogger.logger = KomuxerVendorLogger") in 0 until build.indexOf("StreamerAdapter("), "set before the first streamer is built")
  }

  @Test
  fun `Review Focus 1 nothing in the glue blocks the scheduler thread`() {
    for (file in sources()) {
      val text = file.readText()
      assertFalse("runBlocking" in text, "${file.path}: runBlocking")
      if (!file.path.endsWith("net/HostLookup.kt")) assertFalse("InetAddress" in text, "${file.path}: a DNS lookup outside HostLookup's bounded IO lookup")
    }
    // The positive pair: the one lookup is where the rule says, so the exemption is not a stale path.
    assertTrue(sources().any { it.path.endsWith("net/HostLookup.kt") && "InetAddress" in it.readText() }, "HostLookup holds the glue's lookup")
  }

  @Test
  fun `the glue never attaches StreamPack's lifecycle observer, logs to the console, or names a service`() {
    for (file in sources()) {
      val text = file.readText()
      for (banned in listOf("StreamerLifeCycleObserver", "android.util.Log", "println(", "streampack.services")) assertFalse(banned in text, "${file.path}: $banned")
    }
  }

  /**
   * StreamPack's own display readers (javap, 3.2.0 and 3.2.1): `ContextExtensionsKt.getDisplayRotation`, which Kotlin
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
   * Every StreamPack 3.2.0 and 3.2.1 streamer factory and constructor (`cameraSingleStreamer`, `SingleStreamer`,
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

  /** The glue file named [name], read whole: exactly one, or the rule below reads the wrong path. */
  private fun glue(name: String): String = sources().filter { it.name == name }.also { assertEquals(1, it.size, name) }.single().readText()

  /** EngineHost's `build`, from its signature to the next function's. */
  private fun hostBuild(): String {
    val host = glue("EngineHost.kt")
    val start = host.indexOf("private fun build(")
    assertTrue(start >= 0, "EngineHost has no build")
    return host.substring(start, host.indexOf("\n  private fun ", start + 1).takeIf { it > start } ?: host.length)
  }

  /** C6 carry (Task 37): the build encodes the side held, the pose watch's, never a constant side (EngineHost's placeholder). */
  @Test
  fun `C6 the capture's side is the pose watch's, never a constant`() {
    val build = hostBuild()
    val calls = Regex("""\bStreamerAdapter\(""").findAll(build).toList()
    assertEquals(1, calls.size, "one capture built")
    val args = arguments(build, calls.single().range.last)
    assertTrue(args.trimEnd().endsWith("pose::side)"), "the side supplier is the pose watch's: $args")
    for (side in listOf("Side.LEFT", "Side.RIGHT")) assertFalse(side in glue("EngineHost.kt"), "EngineHost names $side")
  }

  /**
   * C6 carry (Task 37): CameraWatch feeds the capture's own CameraAvailability, so a busy camera waits, and
   * it starts inside the first build, after `core.start()` and before the build returns: no capture opens
   * before it, as the capture opens only on the engine's word. One instance, or the watch's word is inert.
   */
  @Test
  fun `C6 CameraWatch feeds the capture's own CameraAvailability, started inside the first build`() {
    val build = hostBuild()
    assertEquals(1, Regex("""\bCameraAvailability\(\)""").findAll(glue("EngineHost.kt")).count(), "one CameraAvailability in EngineHost")
    assertTrue(Regex("""val cameras = CameraAvailability\(\)""").containsMatchIn(build), "the build makes it")
    val capture = arguments(build, Regex("""\bStreamerAdapter\(""").find(build)!!.range.last)
    assertTrue(Regex("""\bcameras\b""").containsMatchIn(capture), "the capture reads it: $capture")
    val started = build.indexOf("startWatchers(app, cameras,")
    assertTrue(started > build.indexOf("core.start()") && started < build.indexOf("return Parts("), "the watchers start after core.start() and before the build returns")
    val watchers = glue("EngineHost.kt").substringAfter("private fun startWatchers(")
    assertTrue("CameraWatch(app, cameras, report, ::line).start()" in watchers, "CameraWatch is fed the same instance and started")
  }

  /** PV40: the pose tracker is replaced by `start` on the scheduler thread and read on the sensor thread. */
  @Test
  fun `PV40 the pose watch's tracker, swapped on one thread and read on another, is volatile`() {
    assertTrue(Regex("""@Volatile\s+private var tracker\b""").containsMatchIn(glue("PoseWatch.kt")), "PoseWatch.tracker is not @Volatile")
  }

  /**
   * C0b and C4a (Task 38): the service, the wake lock and the marker go at `Release` alone, an unpair,
   * Ended, or A8's final beat answered; the tick runs until then. One release in the glue, in that branch,
   * and one `stopService`, the keeper's; the service stops itself only when it is not held (review C7 I-3).
   */
  @Test
  fun `C0b the keeper releases at Release alone, and nothing else stops the service`() {
    val all = sources().joinToString("\n") { it.readText() }
    assertEquals(1, Regex("""\bkeeper\.release\(\)""").findAll(all).count(), "one keeper release in the glue")
    assertTrue(Regex("""Command\.Release -> \{\s*keeper\.release\(\)""").containsMatchIn(glue("AndroidPlatform.kt")), "the release is the Release branch's")
    assertEquals(1, Regex("""\bstopService\(""").findAll(all).count(), "one stopService in the glue")
    assertTrue("stopService(" in glue("PairingKeeper.kt"), "the keeper's")
    val service = glue("CaptureForegroundService.kt")
    assertEquals(1, Regex("""\bstopSelf\(""").findAll(service).count(), "one stopSelf")
    assertTrue(Regex("""if \(!held\) stopSelf\(\)""").containsMatchIn(service), "stopSelf only when the service is not held")
  }

  /**
   * Review C7 I-3: a service started with `startForegroundService` and stopped before it calls `startForeground`
   * crashes the app (AOSP 14 `ActiveServices`: "did not then call startForeground"). So the service calls it first,
   * whatever failed before, with a plain notification when the pairing's cannot be built; the keeper stops only
   * a service that went foreground; and one a Release came before stops itself, once foreground.
   */
  @Test
  fun `I-3 the service goes foreground before anything stops it, and the keeper stops only a foreground one`() {
    val service = glue("CaptureForegroundService.kt")
    val start = body(service, "override fun onStartCommand(")
    val foreground = start.indexOf("ServiceCompat.startForeground(this, CaptureNotification.ID, keeper.notification(), TYPES)")
    assertTrue(foreground >= 0, "the pairing's notification, or its plain fallback: $start")
    assertTrue(Regex("""TYPES\)\s+keeper\.foregrounded\(\)\s+\} catch \(e: RuntimeException\) \{[^\n]*\s+keeper\.fgsRefused\(e\)\s+false\s+\}""").containsMatchIn(start), "held once foreground and still wanted: $start")
    assertTrue(start.indexOf("stopSelf(") > foreground, "nothing stops the service before startForeground")
    val keeper = glue("PairingKeeper.kt")
    val notification = Regex("""fun notification\(\): Notification =\s+try \{\s+notes\.current\(\)\s+\} catch \(e: Exception\) \{\s+line\([^\n]*"notification"[^\n]*\s+recordOnly\("channel"\) \{ notes\.channel\(\) \}[^\n]*\s+notes\.plain\(\)\s+\}""")
    assertEquals(1, notification.findAll(keeper).count(), "a notification the start can always take, its failure recorded")
    assertTrue(Regex("""fun foregrounded\(\): Boolean \{\s+foreground = survivesBackground\s+return foreground""").containsMatchIn(keeper), "foreground while the pairing holds it")
    assertTrue(Regex("""fun fgsRefused\(e: Throwable\) \{\s+survivesBackground = false\s+foreground = false""").containsMatchIn(keeper), "a refused start is not foreground")
    val finish = body(keeper, "private fun finish()")
    assertTrue(Regex("""^\{\s+(//[^\n]*\s+)*if \(foreground\) \{\s+foreground = false\s+context\.stopService\(""").containsMatchIn(finish), "only a foreground service is stopped: $finish")
  }

  /**
   * CD21 (Task 38): Expo 57.0.20 answers DENIED for every permission when the current activity is not a
   * `PermissionAwareActivity` (`PermissionsService.delegateRequestToActivity`), a refusal no operator
   * saw. That reads as UNAVAILABLE, before Expo is asked.
   */
  @Test
  fun `CD21 a permission request with no activity to ask from is unavailable, never a refusal`() {
    val text = glue("Permissions.kt")
    val guard = Regex("""if \(!permissionAware\(context\.currentActivity\)\) return onResult\(Grant\.UNAVAILABLE\)""").find(text)
    assertTrue(guard != null, "the activity check answers UNAVAILABLE")
    assertTrue(guard!!.range.first < text.indexOf("askForPermissions("), "the check comes before the ask")
    assertTrue(""""com.facebook.react.modules.core.PermissionAwareActivity"""" in text, "Expo's own test: React's PermissionAwareActivity")
    assertTrue(Regex("""return aware\.isInstance\(activity\)""").containsMatchIn(text), "the activity is checked against it")
  }

  /**
   * CD16 and N1 (Task 38): the notification follows the snapshot only while the service is held, so an
   * idle phone posts nothing; its work on the main looper costs a line when it fails, never the process.
   */
  @Test
  fun `CD16 the notification is posted only while held, and its main-looper work never throws`() {
    assertTrue(Regex("""if \(keeper\.survivesBackground\) main\.post \{ keeper\.notify\(wire\) \}""").containsMatchIn(glue("AndroidPlatform.kt")), "AndroidPlatform.snapshot")
    assertEquals(1, Regex("""\.notify\(wire\)""").findAll(glue("AndroidPlatform.kt")).count(), "one notify, the guarded one")
    assertTrue(Regex("""fun notify\(wire: Map<String, Any\?>\) = recordOnly\("notify"\)""").containsMatchIn(glue("PairingKeeper.kt")), "PairingKeeper.notify goes through recordOnly")
  }

  /** T18 m2: the composed line runs to about 60 characters (fr), past one collapsed row; the expanded notification shows it whole. */
  @Test
  fun `T18 m2 the notification's text is its big text too`() {
    assertTrue(".setStyle(NotificationCompat.BigTextStyle().bigText(text))" in glue("PairingKeeper.kt"))
  }

  /** The body of the function whose declaration starts with [signature] in [text], braces included. */
  private fun body(text: String, signature: String): String {
    val start = text.indexOf(signature)
    assertTrue(start >= 0, "no $signature")
    val open = text.indexOf('{', start)
    var depth = 0
    for (i in open until text.length) {
      when (text[i]) {
        '{' -> depth++
        '}' -> if (--depth == 0) return text.substring(open, i + 1)
      }
    }
    return text.substring(open)
  }

  /**
   * Task 39 (I5, CD37) and review C7 I-1: the module registers the preview, or JS's `requireNativeView` finds no
   * view and the viewfinder report is inert. The viewfinder is shown while the view is attached to a window that
   * is visible: Android keeps a view attached when the activity stops (lock, Background) and only its window
   * turns invisible, which is how StreamPack 3.2.1's own PreviewView reads it (javap: `onWindowVisibilityChanged`
   * stops its preview on anything but VISIBLE). Each hook's direction, the one report, and the streamer follow
   * are pinned; nothing here may crash the app, so the report is guarded and the follow's scope has its handler.
   */
  @Test
  fun `I5 I-1 the preview reports the viewfinder from attach, visibility and detach, and follows the streamer`() {
    assertEquals(1, Regex("""\bView\(CapturePreviewView::class\)""").findAll(glue("CaptureEngineModule.kt")).count(), "the module's default view")
    val view = glue("CapturePreviewView.kt")
    val reports = Regex("""viewfinder\(""").findAll(view).toList()
    assertEquals(1, reports.size, "one report, which reads the view's state")
    val report = body(view, "private fun report(")
    assertTrue(Regex("""guarded\(action\) \{ EngineHost\.core\(context\)\.viewfinder\(attached && visibility == VISIBLE\) \}""").containsMatchIn(report), "the report: $report")
    val attach = body(view, "override fun onAttachedToWindow()")
    assertTrue(Regex("""attached = true\s+report\("attach"\)""").containsMatchIn(attach), "attach marks attached, then reports: $attach")
    assertTrue(Regex("""EngineHost\.capture\(context\)\.streamer\.collect \{ streamer ->""").containsMatchIn(attach), "the follow starts on attach")
    assertTrue("preview.setVideoSourceProvider(streamer)" in attach, "the follow binds each streamer, a null one unbinding")
    val visibility = body(view, "override fun onWindowVisibilityChanged(visibility: Int)")
    assertTrue(Regex("""super\.onWindowVisibilityChanged\(visibility\)\s+report\("visibility", visibility\)""").containsMatchIn(visibility), "visibility reports its own value: $visibility")
    val detach = body(view, "override fun onDetachedFromWindow()")
    assertTrue(Regex("""attached = false\s+report\("detach"\)""").containsMatchIn(detach), "detach clears attached, then reports: $detach")
    assertTrue("following?.cancel()" in detach, "the follow stops on detach")
    assertTrue("private var attached = false" in view, "not attached until attach")
    assertEquals(2, Regex("""(?<!var )\battached = (true|false)""").findAll(view).count(), "attached is set by attach and detach only")
    assertTrue(Regex("""CoroutineScope\(SupervisorJob\(\) \+ Dispatchers\.Main \+ failed\)""").containsMatchIn(view), "the follow's scope has its handler")
  }

  /**
   * Review C7 I-2 and M-4: StreamPack opens the camera lazily, at the first preview or the start, so the glue calls
   * no camera held; the run does, once StreamPack reports the source open (CaptureRunTest, CaptureRunMachineTest).
   * Every camera source the glue sets is announced first (`cameras.opening`), so its own open is ours; the open
   * signal is the source's previewing or streaming flow (3.2.1, javap); the readiness reads the open's outcome;
   * and the preview's open failure, which 3.2.1's PreviewView hands its listener, reaches the capture.
   */
  @Test
  fun `I-2 M-4 the glue holds no camera before StreamPack opens it, announces each camera source, and reads its open`() {
    val adapter = glue("StreamerAdapter.kt")
    assertEquals(listOf("cameras.held(null)"), Regex("""cameras\.held\([^)]*\)""").findAll(adapter).map { it.value }.toList(), "only the release sets what is held")
    assertFalse("sessionStarted" in adapter, "the run starts the camera's session, at the build")
    assertEquals(1, Regex("""return Built\.Ready\(id\)""").findAll(adapter).count(), "the build names the camera it asked for")
    val sources = Regex("""setVideoSource\(CameraSourceFactory\((\w+)\)\)""").findAll(adapter).toList()
    assertEquals(3, sources.size, "the switch, the reopen and the slate's end")
    for (source in sources) {
      val before = adapter.substring(0, source.range.first)
      val announced = Regex("""cameras\.opening\((\w+)\)""").findAll(before).lastOrNull()
      assertEquals(source.groupValues[1], announced?.groupValues?.get(1), "announced before it is set: ${source.value}")
      assertFalse("setVideoSource(" in before.substring(announced!!.range.last), "nothing set between: ${source.value}")
    }
    assertTrue("(camera as? IVideoSourceInternal)?.isStreamingFlow" in adapter, "the start's open is an open too")
    assertTrue("combine(camera.isPreviewingFlow, streaming) { previewing, streams -> previewing || streams }.first { it }" in adapter, "previewing or streaming")
    assertTrue(Regex("""\.first \{ it \}\s+emit\(camera\.cameraId\)""").containsMatchIn(adapter), "the source's id, once open")
    assertTrue("cameras.ready(held.videoInput.sourceFlow.value is ICameraSource)" in adapter, "the readiness reads the open's outcome")
    assertTrue("cameras.openFailed(camera.cameraId, busy(failure))?.let(calls.report)" in adapter, "a failed open is heard, a busy one told")
    val view = glue("CapturePreviewView.kt")
    val failed = Regex("""override fun onPreviewFailed\(t: Throwable\) \{\s+failed\("open", t\)\s+guarded\("open"\) \{ EngineHost\.capture\(context\)\.previewFailed\(t\) \}""")
    assertEquals(1, failed.findAll(view).count(), "the preview's open failure is recorded and reaches the capture, guarded")
  }

  /**
   * C7u, StreamPack#302: our SRT sink sends as StreamPack 3.2.1's SrtSink does, with srtdroid's
   * non-blocking `trySend` through [com.seazn.capture.engine.srt.connect.SrtConnection.send], whose rules
   * core's tests run; a blocking `send` would stall the encoder again under backpressure. Its drops reach
   * the link's sender drops, and its lines the record, from the adapter's own `calls.line`.
   */
  @Test
  fun `302 the SRT sink sends with trySend through the connection, never the blocking send, and its drops are wired`() {
    val sink = glue("SeaznSrtSink.kt")
    assertEquals(1, Regex("""connection\.send \{ held\.trySend\(packet\.buffer, msgCtrl\(packet\)\) \}""").findAll(sink).count(), "one send, through the connection")
    assertEquals(1, Regex("""\.trySend\(""").findAll(sink).count(), "no other trySend call")
    assertEquals(emptyList(), Regex("""\.send\(""").findAll(sink).map { it.value }.toList(), "srtdroid's suspend send blocks the encoder (#302)")
    assertTrue("stats.pktSndDropTotal.toLong() + connection.sendDropped" in sink, "the full-buffer drops reach the link's sender drops")
    assertTrue("SrtConnection(signals, report, line, SystemClock::elapsedRealtime)" in sink, "the connection's lines and monotonic clock")
    assertTrue("connection.closed { socket?.close() }" in sink, "the sink's close is marked, so a send failing on it is no cut")
    assertTrue(
      "SeaznSrtSink(Dispatchers.IO.limitedParallelism(2), signals, calls.report, calls.line)" in glue("StreamerAdapter.kt"),
      "the adapter hands the sink the record's line",
    )
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

  /**
   * C1 (standing): every record line the glue writes, in `main` and `debug`, names a kind the allow-list
   * holds, and each key it names is plain or a scalar. Read from each `RecordEntry(` call's own argument text.
   */
  @Test
  fun `C1 every record kind and key the glue writes is in the allow-list`() {
    val list = Shared.read("scrub/allow-list.json")
    val kinds = list.getJSONObject("kinds").keySet()
    val plain = list.getJSONArray("plain").let { a -> (0 until a.length()).map { a.getString(it) }.toSet() }
    val scalars = list.getJSONObject("scalars").keySet()
    val call = Regex("""\bRecordEntry\(""")
    val files = src.walkTopDown().filter { it.extension == "kt" }.toList()
    val lines = files.flatMap { file -> call.findAll(file.readText()).map { file.name to arguments(file.readText(), it.range.last) }.toList() }
    assertTrue(lines.size >= 7, "a sweep of ${lines.size} record lines: the glue writes at least seven")
    val undecided =
      lines.flatMap { (name, args) ->
        val kind = Regex("""^\(\s*"([^"]+)"""").find(args)?.groupValues?.get(1) ?: return@flatMap listOf("$name: no literal kind in $args")
        val keys = Regex(""""(\w+)"\s+to\b""").findAll(args).map { it.groupValues[1] }.toList()
        listOfNotNull(kind.takeUnless { it in kinds }?.let { "$name: kind $it" }) + keys.filterNot { it in plain || it in scalars }.map { "$name: $kind.$it" }
      }
    assertEquals(emptyList(), undecided)
  }
}
