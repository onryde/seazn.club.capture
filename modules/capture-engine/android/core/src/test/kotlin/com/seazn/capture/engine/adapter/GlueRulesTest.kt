package com.seazn.capture.engine.adapter

import com.seazn.capture.engine.core.Shared
import java.io.File
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
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

  /** The top-level items of [args], `arguments`' parenthesised text: split at commas outside any bracket or lambda. */
  private fun topLevel(args: String): List<String> {
    val inner = args.removePrefix("(").removeSuffix(")").replace(Regex("""/\*.*?\*/""", RegexOption.DOT_MATCHES_ALL), "")
    val items = mutableListOf<String>()
    var depth = 0
    var from = 0
    for ((i, c) in inner.withIndex()) {
      when (c) {
        '(', '{', '<', '[' -> depth++
        ')', '}', ']' -> depth--
        '>' -> if (i > 0 && inner[i - 1] != '-') depth--
        ',' -> if (depth == 0) items += inner.substring(from, i).also { from = i + 1 }
      }
    }
    items += inner.substring(from)
    return items.map { it.trim() }.filter { it.isNotEmpty() }
  }

  /**
   * Final review round 2, minor 3, kept under spec §4 (owner, 2026-10-06): the silence window that was the core's one
   * readiness timing parameter is gone, so BridgeCore declares none, and the glue has none to pass. The timing
   * parameters are read from BridgeCore's constructor (every one whose name ends `Ms`), never listed here. A
   * companion constant such as `NO_AUDIO_MS` is not a parameter, and the glue cannot pass it.
   */
  @Test
  fun `D2 BridgeCore declares no readiness timing parameter`() {
    val core = File(src.parentFile, "core/src/main/kotlin/com/seazn/capture/engine/adapter/BridgeCore.kt").readText()
    val declared = core.indexOf("class BridgeCore(").also { assertTrue(it >= 0, "BridgeCore's constructor") }
    val params = topLevel(arguments(core, core.indexOf('(', declared))).map { Regex("""^(?:(?:private|internal)\s+)?(?:va[lr]\s+)?(\w+)\s*:""").find(it)!!.groupValues[1] }
    val timing = params.filter { it.endsWith("Ms") }
    assertTrue("clock" in params && "newId" in params, "the constructor parsed: $params")
    assertEquals(emptyList(), timing, "a new timing parameter re-opens final r2: the glue must never pass it")
  }

  /**
   * Pre-flight F5: under spec §4 any finite level is a buffer, so the release's closing report must carry none, or
   * sound reads ready after the capture is gone. The tick hands over PeakMeter's take as it is (F4).
   */
  @Test
  fun `F5 the glue's release reports no audio buffer, and its tick hands over the meter's take`() {
    val glue = sources().single { it.name == "StreamerAdapter.kt" }.readText()
    val at = glue.indexOf("override suspend fun release()").also { assertTrue(it >= 0, "release()") }
    val release = glue.substring(at, glue.indexOf("\n    }\n", at))
    assertTrue("calls.readiness(false, null)" in release, "release() reports no buffer: $release")
    assertFalse(Regex("""calls\.readiness\([^)]*\b0\.0\b""").containsMatchIn(glue), "no literal level reaches the core as a buffer")
    assertTrue("ready.take())" in glue.substring(glue.indexOf("private suspend fun reportReadiness()")), "the tick passes the take")
  }

  /**
   * Review I-1, spec §4 ("a call means not ready"): MicWatch reads the session of the recording that records. Before
   * air that is the meter's own AudioRecord, StreamPack's records only on air, and every connect stops the meter
   * first, so `MicSilenceWatch.ours` picks the meter's while it records (MicSilenceWatchTest drives the handover).
   * N8's check stays StreamPack's: it asks whether the reflection works.
   */
  @Test
  fun `I-1 MicWatch reads the meter's session before air and StreamPack's after the connect stops the meter`() {
    val adapter = glue("StreamerAdapter.kt")
    assertTrue("fun audioSessionId(): Int? = MicSilenceWatch.ours(sound.sessionId(), ::streamerSession)" in adapter, "the meter's session first")
    assertTrue("private fun streamerSession(): Int? = current.value?.audioInput?.sourceFlow?.value?.let(AudioSessionIds::of)" in adapter, "StreamPack's, by reflection")
    assertTrue(Regex("""^\{\s+sound\.stop\(\)\n""").containsMatchIn(body(adapter, "override fun beforeConnect(")), "the connect stops the meter first")
    assertTrue("sound.start()" in body(adapter, "override suspend fun afterBroadcast()"), "G-2: a new meter after the broadcast")
    assertTrue("override fun micSessionKnown(): Boolean = streamerSession() != null" in adapter, "N8 asks after StreamPack's")
    val meter = glue("SoundMeter.kt")
    assertTrue("fun sessionId(): Int? = session" in meter, "the meter hands over its session")
    val start = body(meter, "fun start()")
    assertTrue(Regex("""session = it\.audioSessionId [^\n]*\n\s+it\.startRecording\(\)""").containsMatchIn(start), "set before it records, so the callback for this start finds it")
    assertTrue(Regex("""catch \(e: Exception\) \{[^\n]*\n\s+session = null\n""").containsMatchIn(start), "cleared when the start fails")
    assertTrue(Regex("""record = null\s+session = null\n""").containsMatchIn(body(meter, "fun stop()")), "cleared before the release")
    assertTrue("MicWatch(app, capture::audioSessionId, MicSilenceWatch(), report, toCore)" in glue("EngineHost.kt"), "MicWatch reads it")
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

  @Test
  fun `the scoring link is the module's second answering call, an AsyncFunction on the Promise (R-F3), and no event carries it`() {
    val module = glue("CaptureEngineModule.kt")
    val pattern = Regex("""AsyncFunction\("scoringLink"\)\s*\{\s*promise: Promise ->\s*core\.scoringLink \{ answer -> promise\.resolve\(answer\) \}\s*\}""")
    assertEquals(1, pattern.findAll(module).count(), "one AsyncFunction, resolved with the core's answer, point to point")
    assertEquals(1, Regex("""AsyncFunction\("takePhoto"\)""").findAll(module).count(), "PR B's call is still the other one")
    assertEquals(2, Regex("""\bAsyncFunction\(""").findAll(module).count(), "two calls answer, no more (AGENTS §2)")
    assertTrue(Regex("""Events\("onSnapshot", "onRecord", "onAck"\)""").containsMatchIn(module), "the three events, and the scoring link is none of them")
    assertFalse("onScoringLink" in module, "no event")
    assertFalse(Regex("""fun scoringLink""").containsMatchIn(glue("AndroidPlatform.kt")), "the platform does not carry the answer")
  }

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
    assertTrue(args.trimEnd().endsWith("pose::side, cameraLosses)"), "the side supplier is the pose watch's: $args")
    for (side in listOf("Side.LEFT", "Side.RIGHT")) assertFalse(side in glue("EngineHost.kt"), "EngineHost names $side")
  }

  /**
   * Device session 4, F-S4-1: StreamPack's camera-loss lines reach the capture's watch, through the one flow the
   * build makes: StreamPack's logger is the build's `VendorLines`, which tells the flow each loss, and the capture
   * is given that flow and hands it to the run; a start's failure is read by the core's `CameraFailures`. The run's
   * side is CaptureRunTest's; this is the wiring no JVM test reaches.
   */
  @Test
  fun `F-S4-1 StreamPack's camera-loss lines reach the capture's watch, and a start's failure is the core's reading`() {
    val build = hostBuild()
    assertTrue(Regex("""val cameraLosses = MutableSharedFlow<String>\(""").containsMatchIn(build), "the build makes the flow")
    assertTrue("val vendor = VendorLines({ id -> cameraLosses.tryEmit(id) })" in build, "each loss is told to it")
    assertTrue("Logger.logger = VendorLogger(vendor)" in build, "StreamPack's logger is that VendorLines")
    val capture = Regex("""\bStreamerAdapter\(""").findAll(build).single()
    assertTrue(arguments(build, capture.range.last).trimEnd().endsWith(", cameraLosses)"), "the capture is given it")
    val adapter = glue("StreamerAdapter.kt")
    assertTrue("private val losses: Flow<String>," in adapter, "the adapter takes it")
    assertTrue("override fun cameraLosses(): Flow<String> = losses" in adapter, "and hands it to the run")
    assertTrue("override fun cameraFailed(failure: Throwable): String? = cameraId?.takeIf { CameraFailures.camera(failure) }" in adapter, "the core's reading")
  }

  /**
   * Re-review 4 cap (controller ruling 2026-10-05): the app's return to the foreground re-arms the capture's camera
   * rebuilds. No native foreground watcher existed: Expo's module lifecycle is the one, and the host hands it to
   * the capture it holds, building nothing for it. CaptureRunTest drives the run's side.
   */
  @Test
  fun `re-review 4 the app's return to the foreground reaches the capture's run, building nothing`() {
    assertTrue("OnActivityEntersForeground { EngineHost.foreground() }" in glue("CaptureEngineModule.kt"), "the module hears it")
    val host = glue("EngineHost.kt")
    assertTrue(Regex("""fun foreground\(\) \{\s*parts\?\.capture\?\.foreground\(\)\s*\}""").containsMatchIn(host), "the host passes it on, to a capture already built")
    assertTrue(Regex("""\n  fun foreground\(\)\n""").containsMatchIn(glue("Capture.kt")), "the capture takes it")
    assertTrue("override fun foreground() = run.foreground()" in glue("StreamerAdapter.kt"), "and hands it to the run")
  }

  /**
   * Re-review 3 m1: VendorLines reads StreamPack's camera-loss lines by their text, which StreamPack can reword in
   * any release, and its test retypes them. So the regexes name the StreamPack they were read from, beside them,
   * and that is the one build.gradle pins strictly: a bump that does not re-read `CameraUtils.openCamera` and move
   * the pin reds here.
   */
  @Test
  fun `re-review 3 m1 the camera-loss regexes name the StreamPack they read, and it is the one build_gradle pins`() {
    val gradle = File(src.parentFile, "build.gradle").readText()
    val pinned = Regex("""streampack[^\n]*strictly '([^']+)'""").findAll(gradle).map { it.groupValues[1] }.toList()
    assertEquals(1, pinned.size, "one strict StreamPack pin: $pinned")
    val companion = glue("VendorLines.kt").substringAfter("private companion object {")
    val read = Regex("""const val STREAMPACK = "([^"]+)"""").findAll(companion).map { it.groupValues[1] }.toList()
    assertEquals(pinned, read, "VendorLines.STREAMPACK, beside the regexes, is build.gradle's StreamPack")
    for (regex in listOf("val DISCONNECTED = Regex(", "val IN_ERROR = Regex(")) assertTrue(regex in companion, "beside $regex")
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
    assertTrue("CameraWatch(app, cameras, report, toCore).start()" in watchers, "CameraWatch is fed the same instance and started")
  }

  /**
   * Review C7 fix rounds 2 and 3: `EngineHost.line` drops lines until the build returns, and every watcher the
   * build starts can write before then (the device sampler samples at once; a callback can answer at its
   * registration). One `toCore`, made once in the build, is the line of each. The watchers are read from the
   * code, not listed here: each class in `watch/` that takes a line, and each thing `startWatchers` starts.
   * A fifth watcher is held to the rule with no edit here.
   */
  @Test
  fun `every watcher the build starts writes its lines to the core, through one toCore`() {
    val host = glue("EngineHost.kt")
    val build = hostBuild()
    val starts = body(host, "private fun startWatchers(")
    val made = Regex("""val toCore: \(RecordEntry\) -> Unit = \{ core\.log\(it\.level, it\.kind, it\.fields\.toMap\(\)\) \}""").findAll(host).toList()
    assertEquals(1, made.size, "one toCore in EngineHost, the core's own log")
    assertTrue(build.indexOf(made.single().value) >= 0, "made in the build")
    assertTrue("startWatchers(app, cameras, capture, device, report, toCore)" in build, "and handed to startWatchers")
    // What each started watcher is made with: `Ctor(args).start()` in startWatchers, or `name.start()` for a `val name = Ctor(args)` of the build.
    val started = mutableMapOf<String, String>()
    for (call in Regex("""(?m)^\s*(?:([A-Z]\w*)\(|([a-z]\w*)\.start\(\))""").findAll(starts)) {
      val (ctor, name) = call.destructured
      if (ctor.isNotEmpty()) {
        val args = arguments(starts, call.range.last)
        assertTrue(starts.startsWith(".start()", starts.indexOf(args, call.range.first) + args.length), "$ctor is started")
        started[ctor] = args
      } else {
        val decl = Regex("""val $name = ([A-Z]\w*)\(""").find(build) ?: error("startWatchers starts $name, which the build does not make")
        started[decl.groupValues[1]] = arguments(build, decl.range.last)
      }
    }
    val watchDir = File(root, "com/seazn/capture/engine/watch")
    val takers = watchDir.listFiles()!!.filter { it.extension == "kt" && "line: (RecordEntry) -> Unit" in it.readText() }.map { it.nameWithoutExtension }
    // PoseWatch registers at Hold, after the build has returned (I-4), so its `::line` writes; it starts nowhere in the build.
    val afterBuild = setOf("PoseWatch")
    assertFalse(Regex("""\bpose\.start\(\)""").containsMatchIn(build + starts), "PoseWatch starts in the build")
    val inBuild = (takers - afterBuild).associateWith { name -> Regex("""\b$name\(""").find(host)?.let { arguments(host, it.range.last) } ?: error("$name is never made") } + started
    for ((name, args) in inBuild) {
      assertTrue(Regex("""\btoCore\b""").containsMatchIn(args), "$name writes to the core: $args")
      assertFalse("::line" in args, "$name never writes through EngineHost.line: $args")
    }
    assertEquals(setOf("CameraWatch", "MicWatch", "NetworkWatch", "DeviceSampler"), inBuild.keys, "the watchers checked (${inBuild.size})")
  }

  /**
   * Review C7 I-4 (CD9): registering and unregistering the accelerometer are binder calls, so `start` and `stop`
   * (called on the scheduler thread, from Hold and Release) post them to the pose thread, in order. A throw there
   * would end the process, so each posted step is guarded, a `watch-failed` line.
   */
  @Test
  fun `I-4 the pose watch registers and unregisters on its own thread, guarded`() {
    val pose = glue("PoseWatch.kt")
    assertTrue(Regex("""private val handler = Handler\(thread\.looper\)""").containsMatchIn(pose), "the pose thread's handler")
    assertTrue(Regex("""fun start\(\) \{\s+held = Side\.LEFT[^\n]*\s+handler\.post \{ guarded\("pose-start"\) \{ register\(\) \} \}\s+\}""").containsMatchIn(pose), "start resets the side (M-10), then posts: ${body(pose, "fun start()")}")
    assertTrue(Regex("""fun stop\(\) \{\s+handler\.post \{ guarded\("pose-stop"\) \{ unregister\(\) \} \}\s+\}""").containsMatchIn(pose), "stop posts: ${body(pose, "fun stop()")}")
    assertEquals(1, Regex("""\bregisterListener\(""").findAll(pose).count(), "one register")
    assertTrue(Regex("""\bregisterListener\(""").containsMatchIn(body(pose, "private fun register()")), "inside the posted step")
    assertTrue("registerListener(this, sensor, SensorManager.SENSOR_DELAY_UI, handler)" in pose, "its callbacks on the same thread")
    assertEquals(1, Regex("""\bunregisterListener\(""").findAll(pose).count(), "one unregister")
    assertTrue("unregisterListener(" in body(pose, "private fun unregister()"), "inside the posted step")
    for (step in listOf("register", "unregister")) assertEquals(1, Regex("""\b$step\(\)""").findAll(pose).count() - 1, "$step is called from its post alone")
    val guarded = body(pose, "private fun guarded(")
    assertTrue(Regex("""catch \(e: Exception\) \{\s+line\(RecordEntry\("watch-failed", listOf\("action" to action, "error" to e\.javaClass\.simpleName\)\)\)""").containsMatchIn(guarded), "a watch-failed line: $guarded")
  }

  /**
   * Review C7 M-1: the keeper's release guards each step alone, so a stop that throws still releases the wake lock
   * and deletes the marker (a marker left behind reads as a lost session at the next launch).
   */
  @Test
  fun `M-1 the keeper's release guards each step alone`() {
    val keeper = glue("PairingKeeper.kt")
    assertTrue(Regex("""fun release\(\) \{\s+survivesBackground = false\s+main\.post \{ finish\(\) \}\s+\}""").containsMatchIn(keeper), "no guard around the whole release")
    val finish = body(keeper, "private fun finish()")
    assertEquals(listOf("stop-service", "wake-lock", "marker"), Regex("""recordOnly\("([\w-]+)"\)""").findAll(finish).map { it.groupValues[1] }.toList(), finish)
    assertTrue(Regex("""recordOnly\("wake-lock"\) \{\s+if \(wakeLock\.isHeld\) \{\s+wakeLock\.release\(\)""").containsMatchIn(finish), "the wake lock's own guard")
    assertTrue("""recordOnly("marker") { marker.delete() }""" in finish, "the marker's own guard")
  }

  /**
   * Review C7 M-8 and M-9: a throw on a watcher's callback thread, or from the previous run's exit read inside
   * the engine's build, would end the process or leave the build half done. Each costs a `watch-failed` line.
   */
  @Test
  fun `M-8 M-9 the network and pose callbacks and the exit read are guarded`() {
    val network = glue("NetworkWatch.kt")
    assertTrue(Regex("""override fun onCapabilitiesChanged\(network: Network, caps: NetworkCapabilities\) = guarded \{ changed\(""").containsMatchIn(network), "onCapabilitiesChanged")
    assertTrue(Regex("""override fun onLost\(network: Network\) = guarded \{ changed\(false\) \}""").containsMatchIn(network), "onLost")
    assertTrue(Regex("""catch \(e: Exception\) \{\s+line\(RecordEntry\("watch-failed", listOf\("action" to "network", "error" to e\.javaClass\.simpleName\)\)\)""").containsMatchIn(body(network, "private fun guarded(")), "network's line")
    // Fix round 2: the network watch starts inside the build, where EngineHost.line drops every line, and its
    // first callback can come before the build returns; its lines go to the running core directly.
    val host = glue("EngineHost.kt")
    assertFalse(Regex("""\bNetworkWatch\([^)]*::line""").containsMatchIn(host), "never through EngineHost.line")
    assertTrue(Regex("""\bNetworkWatch\(app, report, toCore\)""").containsMatchIn(body(host, "private fun startWatchers(")), "the network watch writes to the core")
    val toCore = Regex("""val toCore: \(RecordEntry\) -> Unit = \{ core\.log\(it\.level, it\.kind, it\.fields\.toMap\(\)\) \}""").find(hostBuild())
    assertTrue(toCore != null, "toCore is the core's own log, made in the build")
    assertTrue(Regex("""startWatchers\(app, cameras, capture, device, report, toCore\)""").containsMatchIn(hostBuild()), "and handed to the watchers")
    val n10 = glue("CaptureForegroundService.kt")
    assertTrue("N10: proved by AOSP 14 source; device-unproved on 15/16" in n10, "the N10 comment says what is proved")
    assertFalse("is unproved" in n10, "and no longer that it is unproved")
    val pose = glue("PoseWatch.kt")
    assertTrue(Regex("""override fun onSensorChanged\(event: SensorEvent\) = guarded\("pose"\) \{ sensed\(event\) \}""").containsMatchIn(pose), "onSensorChanged")
    val build = hostBuild()
    val read = Regex("""try \{\s+ExitReader\.previousLoss\(app\)\?\.let \{ core\.log\("warn", it\.kind, it\.fields\.toMap\(\)\) \}\s+\} catch \(e: Exception\) \{\s+core\.log\("warn", "watch-failed", mapOf\("action" to "exit-read", "error" to e\.javaClass\.simpleName\)\)\s+\}""")
    assertEquals(1, read.findAll(build).count(), "the exit read, guarded: $build")
    assertEquals(1, Regex("""ExitReader\.previousLoss\(""").findAll(build).count(), "one exit read")
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
    assertTrue(Regex("""recordOnly\("stop-service"\) \{\s+if \(foreground\) \{\s+context\.stopService\([^\n]*\)\s+foreground = false""").containsMatchIn(finish), "only a foreground service is stopped: $finish")
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
    assertTrue("import com.facebook.react.modules.core.PermissionAwareActivity\n" in text, "Expo's own test: React's PermissionAwareActivity")
    assertTrue(Regex("""private fun permissionAware\(activity: Activity\?\): Boolean = activity is PermissionAwareActivity\n""").containsMatchIn(text), "review C7 M-5: by type, never by name")
    assertFalse("Class.forName" in text, "no lookup by name")
    val gradle = File(src.parentFile, "build.gradle").readText()
    assertEquals(listOf("implementation 'com.facebook.react:react-android'"), Regex("""\S+ ['"]com\.facebook\.react:react-android[^'"]*['"]""").findAll(gradle).map { it.value }.toList(), "react-android, unversioned, as every Expo module here has it")
  }

  /**
   * Final review M6: AudioSessionIds reads StreamPack's `audioRecord` by name, so an app that minifies must keep
   * that name. The module hands its keep rule to the app (`consumerProguardFiles`), and the rule keeps the very
   * field the reflection reads, on the class that declares it (StreamPack 3.2.1, javap).
   */
  @Test
  fun `M6 the field AudioSessionIds reads by name is kept for an app that minifies`() {
    val read = Regex("""\bit\.name == "(\w+)"""").findAll(glue("AudioSessionIds.kt")).map { it.groupValues[1] }.toList()
    assertEquals(listOf("audioRecord"), read, "the one field read by name")
    val gradle = File(src.parentFile, "build.gradle").readText()
    val named = Regex("""consumerProguardFiles\s+'([^']+)'""").findAll(gradle).map { it.groupValues[1] }.toList()
    assertEquals(listOf("consumer-rules.pro"), named, "the module hands one rule file to the app")
    val rules = File(src.parentFile, named.single()).readText()
    val rule = Regex("""-keepclassmembers class ([\w.]+) \{\s*private android\.media\.AudioRecord (\w+);\s*\}""")
    val kept = rule.findAll(rules).map { it.groupValues[1] to it.groupValues[2] }.toList()
    assertEquals(listOf("io.github.thibaultbee.streampack.core.elements.sources.audio.audiorecord.AudioRecordSource" to read.single()), kept)
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
    val perEmission = Regex("""streamer\.collect \{ streamer ->\s+try \{\s+preview\.setVideoSourceProvider\(streamer\)\s+\} catch \(e: CancellationException\) \{\s+throw e\s+\} catch \(e: Exception\) \{\s+failed\("follow", e\)""")
    assertTrue(perEmission.containsMatchIn(attach), "review C7 M-7: one streamer's failed bind is a line, and the follow carries on: $attach")
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
    assertTrue("combine(camera.isPreviewingFlow, streaming) { previewing, streams -> previewing || streams }" in adapter, "previewing or streaming")
    // F-S4-1: each time it turns open, so a camera lost on air reads ready again once StreamPack's start reopens it.
    val eachOpen = Regex("""previewing \|\| streams \}\s+\.distinctUntilChanged\(\)\s+\.filter \{ it \}\s+\.collect \{ emit\(camera\.cameraId\) \}""")
    assertTrue(eachOpen.containsMatchIn(adapter), "the source's id, each time it turns open")
    assertTrue("cameras.ready(held.videoInput.sourceFlow.value is ICameraSource)" in adapter, "the readiness reads the open's outcome")
    assertTrue("cameras.openFailed(camera.cameraId, busy(failure))?.let(calls.report)" in adapter, "a failed open is heard, a busy one told")
    val view = glue("CapturePreviewView.kt")
    val failed = Regex("""override fun onPreviewFailed\(t: Throwable\) \{\s+failed\("open", t\)\s+guarded\("open"\) \{ EngineHost\.capture\(context\)\.previewFailed\(t\) \}""")
    assertEquals(1, failed.findAll(view).count(), "the preview's open failure is recorded and reaches the capture, guarded")
  }

  /**
   * Device fix round, item (c): StreamPack 3.2.1's `VideoInput.setSource` skips a camera source of the same id
   * (`CameraSourceFactory.isSourceEquals`, javap), so the reopen's swap opens a camera only from the slate. Over a
   * camera source it answers false before announcing or setting anything, never a silent true; with nothing on air
   * the run builds the camera afresh instead (CaptureRunTest, CaptureRunMachineTest).
   */
  @Test
  fun `(c) the reopen's swap opens only from the slate, and answers false over a camera source`() {
    val reopen = body(glue("StreamerAdapter.kt"), "override suspend fun reopenCamera()")
    val refusal = Regex("""if \(held\.videoInput\.sourceFlow\.value is ICameraSource\) return false""").find(reopen)
    assertNotNull(refusal, "a camera source held is no swap: $reopen")
    val announced = reopen.indexOf("cameras.opening(id)")
    val set = reopen.indexOf("held.setVideoSource(CameraSourceFactory(id))")
    assertTrue(refusal.range.last < reopen.indexOf("cameras.selfChange(") && refusal.range.last < announced && announced < set, "refused before anything is announced or set: $reopen")
  }

  /**
   * Session 7, F-S7-1: every SRT start failed `IndexOutOfBoundsException: Index 0 out of bounds for length 0`.
   * StreamPack 3.2.1's `TsMuxer.addStreams(configs)` is `addStreams(services[0], configs)` (javap), and only
   * StreamPack's own factories add a service: `SrtEndpointFactory` at creation, `DynamicEndpoint` at open from the
   * descriptor's `TSServiceInfo`. Ours built a bare `TsMuxer()`, so the descriptor's `serviceInfo` was read by
   * nothing. Reproduced and cleared on the JVM against 3.2.1's bytecode (task-C7-report.md). The muxer holds the
   * service from its creation; `CompositeEndpoint` never releases it (only its streams, at a stop), so every attempt
   * finds it. The descriptor names the same service.
   */
  @Test
  fun `F-S7-1 the SRT endpoint's TS muxer holds the service before any stream is added`() {
    val factory = glue("CaptureEndpointFactory.kt")
    assertTrue("private val service: TSServiceInfo," in factory, "the factory is given the service")
    assertEquals(listOf("CompositeEndpoint(TsMuxer().apply { addService(service) }, sink)"), Regex("""CompositeEndpoint\([^\n]*""").findAll(factory).map { it.value }.toList())
    val adapter = glue("StreamerAdapter.kt")
    assertTrue("CaptureEndpointFactory(tally, sink, RtmpDispatcher.create(), clock, SERVICE)" in adapter, "the adapter's one service")
    assertEquals(listOf("serviceInfo = SERVICE"), Regex("""serviceInfo = \w+""").findAll(adapter).map { it.value }.toList(), "the descriptor names the same")
  }

  /**
   * Session 7, item 2: the Link poller asked the SRT sink alone, so RTMPS had no reading and every beat's
   * `bitrateKbps` was null. An RTMPS attempt is begun at its start and ended at a stop, a release or an SRT start
   * ([RtmpsLink], whose gating core's tests run), and read from the RTMP endpoint the factory built last.
   */
  @Test
  fun `item 2 the link is read on RTMPS too, from the RTMP endpoint, for the RTMPS attempt only`() {
    val adapter = glue("StreamerAdapter.kt")
    assertTrue("override fun link(attemptId: Int) = sink.counters(attemptId) ?: rtmps.counters(attemptId, endpoints::rtmpMetrics)" in adapter, "both transports")
    val start = body(adapter, "override suspend fun start(connect: Command.Connect)")
    val srt = start.indexOf("is SrtTarget ->")
    val rtmp = start.indexOf("is RtmpsTarget ->")
    assertTrue(srt in 0 until rtmp, start)
    assertTrue(start.indexOf("rtmps.end()") in srt until rtmp, "an SRT start ends any RTMPS reading: $start")
    val begun = start.indexOf("rtmps.begin(connect.attemptId)")
    assertTrue(begun > rtmp && begun < start.indexOf("held.startStream(target.url"), "begun before the RTMPS start: $start")
    for (signature in listOf("override suspend fun stop()", "override suspend fun release()")) {
      assertTrue("rtmps.end()" in body(adapter, signature), "$signature ends it")
    }
    val factory = glue("CaptureEndpointFactory.kt")
    assertTrue("rtmp = rtmpEndpoint as? RtmpEndpoint" in factory, "the factory keeps the RTMP endpoint it built")
    assertTrue("RtmpsMetrics(it.bytesWritten, it.packetsWritten, it.packetsWriteDropped, it.packetsWriteLost)" in factory, "its counters, field for field")
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
   * what_; the host is `Hosts.INGEST`, live.cloudflare.com, for both transports in both environments, owner
   * ruling A, 2026-10-05), and `SrtOptions.plan`'s own host check rests on Bodies being the only producer of a
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
   * holds, and each key it names is plain or a scalar. Read from each `RecordEntry(` call's own argument text,
   * and (final review M3) from each `.log(level, "kind", …)` call's, the core's own entry point
   * (`BridgeCore.log`): one whose kind is no literal passes a line through, so names none of its own.
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
    val logCall = Regex("""\.log\(""")
    val logged =
      files.flatMap { file ->
        val text = file.readText()
        logCall.findAll(text).map { arguments(text, it.range.last) }.mapNotNull { args ->
          Regex("""^\(\s*(?:"[^"]*"|[^,()"]+),\s*"([^"]+)"""").find(args)?.let { file.name to "(" + args.substring(it.groups[1]!!.range.first - 1) }
        }.toList()
      }
    // EngineHost's vendor-log and exit-read watch-failed lines, at least.
    assertTrue(logged.size >= 2, "a sweep of ${logged.size} `.log(` lines with a literal kind: the glue writes at least two")
    val undecided =
      (lines + logged).flatMap { (name, args) ->
        val kind = Regex("""^\(\s*"([^"]+)"""").find(args)?.groupValues?.get(1) ?: return@flatMap listOf("$name: no literal kind in $args")
        val keys = Regex(""""(\w+)"\s+to\b""").findAll(args).map { it.groupValues[1] }.toList()
        listOfNotNull(kind.takeUnless { it in kinds }?.let { "$name: kind $it" }) + keys.filterNot { it in plain || it in scalars }.map { "$name: $kind.$it" }
      }
    assertEquals(emptyList(), undecided)
  }

  /** Spec §8, D2: nothing the photo is made of can reach the session. A source-text rule: a comment counts, so a KDoc must not say these words. */
  @Test
  fun `M6 the photo's source never reaches the session`() {
    val photo = sources().filter { "/capture/photo/" in it.path || it.name == "GalleryPhoto.kt" }
    assertEquals(listOf("GalleryPhoto.kt", "PhotoName.kt", "PhotoRun.kt"), photo.map { it.name }.sorted())
    val banned = listOf("failure(", "report(", "readiness(", "pairFailed", "cameraBusy", "CoreCalls", "BridgeCore", "runBlocking", "android.util.Log", "println(")
    var checked = 0
    for (file in photo) {
      val text = file.readText()
      for (word in banned) {
        assertFalse(word in text, "${file.name}: $word")
        checked++
      }
    }
    assertEquals(3 * banned.size, checked)
  }

  /** Spec §8, D2 (1): the photo runs on a scope with a handler of its own, which writes one line and fails nothing; takePhoto answers from it and from no other. */
  @Test
  fun `M5 StreamerAdapter's photo scope has its own handler, and takePhoto answers from it`() {
    val text = glue("StreamerAdapter.kt")
    val at = text.indexOf("private val photoScope")
    assertTrue(at >= 0, "the photo scope is declared")
    assertEquals(at, text.lastIndexOf("private val photoScope"), "declared once")
    val declaration = text.substring(at, text.indexOf('\n', at))
    assertTrue("CoroutineExceptionHandler" in declaration, declaration)
    assertTrue("\"action\" to \"photo\"" in declaration, declaration)
    assertFalse("calls.failure" in declaration, declaration)
    assertFalse("calls.report" in declaration, declaration)
    val take = body(text, "override fun takePhoto(")
    assertTrue("photoScope.launch" in take, take)
    assertTrue("done(photo.take().wire)" in take, "the answer is what the photo came to, not a constant and not dropped: $take")
    assertFalse(Regex("""\bscope\.launch|\brun\.|serial""").containsMatchIn(take), "never on the capture's scope or its queue: $take")
  }

  /**
   * I-1: the photo is refused unless the camera is ours and not failed or lost. StreamPack's snapshot blocks a thread holding the
   * input's source lock, which Stop, Go live and the slate take too, and cancellation cannot interrupt it. PhotoRun's
   * own tests prove the gate against a lambda; this is the wire: the lambda is the viewfinder's own readiness.
   */
  @Test
  fun `I-1 StreamerAdapter hands the photo the readiness the viewfinder reads`() {
    val text = glue("StreamerAdapter.kt")
    val at = text.indexOf("private val photo = PhotoRun(")
    assertTrue(at >= 0, "the photo is declared")
    assertEquals(at, text.lastIndexOf("private val photo = PhotoRun("), "declared once")
    val declaration = text.substring(at, text.indexOf('\n', at))
    assertTrue("{ current.value?.let(::cameraOurs) ?: false }" in declaration, declaration)
    assertTrue("private fun cameraOurs(held: SingleStreamer): Boolean = cameras.ready(held.videoInput.sourceFlow.value is ICameraSource)" in text, "the one readiness")
  }

  /** Spec §8, the seam: JS calls `takePhoto`; the module declares it once and hands it to the capture. Without this, every photo fails and nothing in a unit test says so. */
  @Test
  fun `M9 the bridge declares takePhoto once and asks the capture`() {
    val module = glue("CaptureEngineModule.kt")
    assertEquals(1, Regex("""AsyncFunction\("takePhoto"\)""").findAll(module).count())
    assertTrue(Regex("""AsyncFunction\("takePhoto"\)[^\n]*EngineHost\.capture\([^\n]*\.takePhoto \{ (\w+) -> promise\.resolve\(\1\) \}""").containsMatchIn(module), "it asks the capture and resolves with the word it is given")
  }

  /** R1, R2: no storage permission in the manifest; the still goes to MediaStore, is cleaned up when it fails, and is the camera's own. */
  @Test
  fun `M7 M8 M11 the still needs no permission, goes to MediaStore, is removed when it fails, and is the camera's`() {
    val manifest = File(src, "main/AndroidManifest.xml").readText()
    for (banned in listOf("READ_EXTERNAL_STORAGE", "WRITE_EXTERNAL_STORAGE", "READ_MEDIA_", "MANAGE_EXTERNAL_STORAGE")) assertFalse(banned in manifest, banned)
    assertTrue("CAMERA" in manifest, "the positive pair: this is the real manifest")
    val writer = glue("GalleryPhoto.kt")
    // IS_PENDING is written twice (hidden while it is written, shown once it is whole), so each value is its own needle.
    val needles =
      listOf(
        "MediaStore.Images.Media.EXTERNAL_CONTENT_URI",
        "RELATIVE_PATH, \"Pictures/Seazn Capture\"",
        "IS_PENDING, 1",
        "IS_PENDING, 0",
        "check(bitmap.compress(", // a failed compress is a failed photo, never an empty file reported as saved
        "check(resolver.update(", // so is a row that never became visible
        "resolver.delete(",
        "is ICameraSource",
      )
    var checked = 0
    for (needed in needles) {
      assertTrue(needed in writer, needed)
      checked++
    }
    assertEquals(8, checked)
    assertTrue(Regex("""finally \{\s+bitmap\.recycle\(\)""").containsMatchIn(writer), "the bitmap is recycled in a finally, a cancelled photo included")
  }

  /**
   * Carried from PR A: a record that was built but would not start still holds the microphone. `AudioRecord` is
   * Android's, which core's JVM cannot compile, so this is a source-text rule and there is no behavioural witness
   * off a device (Task 7, item 12).
   */
  @Test
  fun `M10 SoundMeter releases an AudioRecord whose start threw`() {
    val start = body(glue("SoundMeter.kt"), "fun start()")
    assertTrue(Regex("""catch \(e: Exception\) \{\s+it\.release\(\)""").containsMatchIn(start), start)
  }
}
