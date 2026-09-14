package com.seazn.p5spike

import android.annotation.SuppressLint
import android.content.Context
import android.media.AudioFormat
import android.media.MediaFormat
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import android.net.Uri
import android.os.SystemClock
import android.util.Size
import io.github.thibaultbee.streampack.core.interfaces.startStream
import io.github.thibaultbee.streampack.core.streamers.orientation.DisplayRotationProvider
import io.github.thibaultbee.streampack.core.streamers.orientation.asFlowProvider
import io.github.thibaultbee.streampack.core.streamers.single.AudioConfig
import io.github.thibaultbee.streampack.core.streamers.single.SingleStreamer
import io.github.thibaultbee.streampack.core.streamers.single.VideoConfig
import io.github.thibaultbee.streampack.core.streamers.single.cameraSingleStreamer
import io.github.thibaultbee.streampack.ext.srt.configuration.mediadescriptor.SrtMediaDescriptor
import kotlinx.coroutines.CoroutineExceptionHandler
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancelAndJoin
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.delay
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.filter
import kotlinx.coroutines.flow.filterNotNull
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.merge
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeout
import kotlinx.coroutines.withTimeoutOrNull
import java.io.File
import java.net.InetAddress

/**
 * The native session, as a process singleton. Native owns it (AGENTS.md §2):
 * JS sends intents and receives events; nothing here waits on JavaScript.
 */
object SpikeSession {
  /** An uncaught failure on this scope becomes a CSV row, not a silent process death. */
  private val scope = CoroutineScope(
    SupervisorJob() + Dispatchers.Default + CoroutineExceptionHandler { _, t -> event("error", "message" to t.toString()) },
  )
  private lateinit var appContext: Context
  private var emit: (String, Map<String, Any?>) -> Unit = { _, _ -> }
  @Volatile private var session: SessionFile? = null
  /** Touched only by the intent actor. */
  private var publishJob: Job? = null
  /** Every intent, in the order JS sent it. null means stop. */
  private val intents = Channel<String?>(Channel.UNLIMITED)
  lateinit var log: SpikeLog
    private set

  val streamerFlow = MutableStateFlow<SingleStreamer?>(null)

  @Volatile var wanted: String? = null
    private set
  @Volatile var transport: String? = null
    private set

  /** F-P5-6's detector. The sampler reads its state; the publish loop answers its stalls. */
  val watchdog = VideoStallWatchdog(SystemClock::elapsedRealtime)

  /** Bumped to ask the publish loop to end the current attempt for a stall. A StateFlow, so a wait never misses one. */
  private val stallRequests = MutableStateFlow(0)

  /** From `publishing` until the attempt ends: the watchdog judges only a publish the loop itself vouches for. */
  @Volatile private var attemptPublishing = false

  /** Survives JS reloads: a second attach only swaps the emitter. */
  fun attach(context: Context, emitter: (String, Map<String, Any?>) -> Unit) {
    emit = emitter
    if (::appContext.isInitialized) return
    appContext = context
    log = SpikeLog(context)
    // First thing after the log exists: on a cable-free run this is the only record of how the
    // last process ended. Off the caller's thread, because it is a binder call.
    scope.launch { ExitHistory.record(context) }
    runIntents()
    watchMarkFile(context)
    StallSimulation.watch(context, scope) { present -> event("video-stall-simulation", "present" to present) }
    watchVideo()
    SpikeTelemetry.start(context, scope) { sample ->
      log.sample(sample)
      emit("onSample", sample)
    }
  }

  @SuppressLint("MissingPermission") // JS requests CAMERA and RECORD_AUDIO before arm().
  fun arm() {
    scope.launch {
      val file = runCatching { SessionFile.read(appContext) }.getOrElse {
        // The class name only: a parser's message can quote the file, credentials included.
        return@launch event("error", "message" to "Bad session file: ${it.javaClass.simpleName}")
      } ?: return@launch event("error", "message" to "No session file. Run cf.ts create, then adb push.")
      session = file
      if (streamerFlow.value == null) {
        // The default endpoint, counted (F-P5-4): encoded frames reaching the endpoint are what
        // tells a starving encoder from a lossy transport. With F-P5-6's proof hook present it
        // also discards video, so a stall can be proven on a device (StallSimulation).
        val streamer = withContext(Dispatchers.Main) {
          cameraSingleStreamer(
            appContext,
            endpointFactory = CountingEndpointFactory(discardVideo = StallSimulation::discardVideo),
          )
        }
        streamer.setAudioConfig(
          AudioConfig(
            mimeType = MediaFormat.MIMETYPE_AUDIO_AAC,
            startBitrate = 128_000,
            sampleRate = 48_000,
            channelConfig = AudioFormat.CHANNEL_IN_STEREO,
          ),
        )
        streamer.setVideoConfig(
          VideoConfig(
            mimeType = MediaFormat.MIMETYPE_VIDEO_AVC,
            startBitrate = 3_000_000,
            resolution = Size(1280, 720),
            fps = 30,
            gopDurationInS = 2f,
          ),
        )
        streamerFlow.value = streamer
        watchRotation(streamer)
      }
      event("armed", "overlayUrl" to file.overlayUrl, "playbackUrl" to file.playbackUrl)
    }
  }

  private const val RETRY_MS = 2_000L
  /** A half-open network must not park the loop inside a connect with no event. */
  private const val CONNECT_TIMEOUT_MS = 15_000L
  /** C1: validated-network SRT failures before falling back. The ordering is R3's to rule; P5 measures it. */
  private const val FALLBACK_AFTER_FAILURES = 3

  fun start(requested: String) {
    intents.trySend(requested)
  }

  fun stop() {
    intents.trySend(null)
  }

  /**
   * The single consumer of [intents]. One ordered actor means a stop can never
   * land after a later start, and it is the only caller of the foreground service.
   */
  private fun runIntents() {
    scope.launch {
      for (intent in intents) {
        try {
          applyIntent(intent)
        } catch (failure: Throwable) {
          // A real cancel rethrows here. A stray CancellationException from a
          // non-suspend call (the foreground service) is just a failed intent.
          currentCoroutineContext().ensureActive()
          // Keep consuming: one bad intent, or a failing log, must not end the actor.
          runCatching { event("error", "message" to "intent failed: $failure") }
        }
      }
    }
  }

  /** Every intent restarts from a closed endpoint, so start-while-live never attaches to the old one. */
  private suspend fun applyIntent(intent: String?) {
    publishJob?.cancelAndJoin()
    publishJob = null
    streamerFlow.value?.let {
      runCatching { it.stopStream() }
      runCatching { it.close() }
      endRegulation(it)
    }
    // A new intent is a new session: no stall episode, no recovery count and no regulation carry over.
    attemptPublishing = false
    watchdog.reset()
    LinkRegulators.newSession()
    // Cleared for every branch: a throwing service start below must not leave stale state.
    wanted = null
    transport = null
    val file = session
    val streamer = streamerFlow.value
    when {
      intent == null -> {
        SpikeForegroundService.stop(appContext)
        event("stopped")
      }
      file == null || streamer == null -> event("error", "message" to "start before arm")
      else -> {
        try {
          SpikeForegroundService.start(appContext) // Milliseconds after a JS press, so still foreground.
        } catch (failure: Throwable) {
          // A start-while-live service from the last intent must not outlive this one, wake lock and all.
          runCatching { SpikeForegroundService.stop(appContext) }
          throw failure
        }
        wanted = intent // After the service: if it throws, nothing claims to be wanted.
        publishJob = scope.launch { publishLoop(file, streamer, intent) }
      }
    }
  }

  /**
   * Native owns reconnect (P2). No promise waits on the network: the loop runs
   * until the next intent cancels it, and every transition is an event.
   */
  private suspend fun publishLoop(file: SessionFile, streamer: SingleStreamer, first: String) {
    var current = first
    var srtFailures = 0
    while (currentCoroutineContext().isActive && wanted != null) {
      // throwableFlow is a StateFlow: without this, a stale error from the last
      // attempt would end the next wait instantly.
      val stale = streamer.throwableFlow.value
      // Likewise for stall requests: only one made during this attempt may end it.
      val stallsBefore = stallRequests.value
      try {
        connect(streamer, file, current)
        srtFailures = 0
        attemptPublishing = true
        val drop = awaitDrop(streamer, stale, stallsBefore)
        attemptPublishing = false
        event("dropped", "transport" to current, *drop.detail)
        if (drop.reason == VIDEO_STALLED) beginVideoRecovery()
      } catch (failure: Throwable) {
        attemptPublishing = false
        // A real cancel (the next intent) rethrows here. A timeout or a stray
        // library cancellation falls through and counts as a failed connect.
        currentCoroutineContext().ensureActive()
        // R2: `validated` is the load-bearing column. Nine rejections in a row with
        // validated=false is a network that has not come up yet, not a bad descriptor —
        // so record it beside the shape rather than leaving it implied by `counted`.
        val validated = networkValidated()
        val counted = current == "srt" && validated
        val shape = if (current == "srt") srtShape(file.srt) else emptyArray()
        event(
          "connect-failed",
          "transport" to current,
          "counted" to counted,
          "validated" to validated,
          "message" to describe(failure),
          *shape,
        )
        if (counted && ++srtFailures >= FALLBACK_AFTER_FAILURES) {
          current = "rtmps"
          event("fell-back")
        }
      }
      runCatching { streamer.stopStream() }
      runCatching { streamer.close() }
      endRegulation(streamer)
      delay(RETRY_MS)
    }
  }

  /** One attempt, from connecting to publishing. Throws on failure or timeout. */
  private suspend fun connect(streamer: SingleStreamer, file: SessionFile, via: String) {
    transport = via
    // Before this attempt's first frame, so a hook file pushed just before a start applies from it.
    StallSimulation.refresh()
    event("connecting", "transport" to via)
    val startBps = regulate(streamer, via, file.srt.latencyMs)
    val startedAt = SystemClock.elapsedRealtime()
    withTimeout(CONNECT_TIMEOUT_MS) {
      if (via == "srt") {
        resolve(file.srt.host)
        streamer.startStream(srtDescriptor(file.srt))
      } else {
        streamer.startStream(file.rtmpsUrl)
      }
    }
    if (startBps != null) startAt(streamer, via, startBps)
    event("publishing", "transport" to via, "connectMs" to SystemClock.elapsedRealtime() - startedAt)
  }

  /**
   * F-P5-5: a fresh regulator for every attempt, installed before the stream starts so StreamPack
   * starts it with the stream. Per attempt for two reasons. It must read the transport this attempt
   * uses, and C1's fallback switches SRT to RTMPS. And StreamPack's interval controller never ticks
   * again once stopped, which happens at every drop (StreamPackSchedulerTest). A regulator that
   * cannot be installed must never cost the broadcast, so the attempt publishes unregulated and says so.
   *
   * @return the target this attempt starts at (the session's last, or a fresh session's start), or
   *   null when no regulator was installed.
   */
  private fun regulate(streamer: SingleStreamer, via: String, srtLatencyMs: Int): Int? = try {
    val startBps = LinkRegulators.startBps()
    streamer.bitrateRegulatorControllerFactory = LinkRegulators.controllerFactory(via, srtLatencyMs)
    startBps
  } catch (failure: Exception) {
    event("error", "message" to "regulator not installed: ${describe(failure)}")
    null
  }

  /**
   * Once the stream has started, and only then, so a failed connect writes no `regulator` row (a
   * 20 s data cut wrote eight). The start target is applied at once: the controller's first tick is a
   * poll later (`CoroutineScheduler` delays before it acts), and until then the codec runs at the
   * rate it was configured or reset with, 3000k. If the codec refuses it now, that first tick applies it.
   *
   * Applied off the publish loop. The setter is `MediaCodec.setParameters`, which can wait on the
   * codec, and nothing a codec is slow to answer may hold a connect or a stall recovery (28b050d: a
   * recovery that never reconnected, cause open).
   */
  private fun startAt(streamer: SingleStreamer, via: String, startBps: Int) {
    scope.launch { runCatching { streamer.videoEncoder?.bitrate = startBps } }
    event(
      "regulator",
      "transport" to via,
      "floorBps" to VideoBitratePolicy.FLOOR_BPS,
      "ceilingBps" to VideoBitratePolicy.CEILING_BPS,
      "startBps" to startBps,
    )
  }

  /** Stops this attempt's controller, and blanks column 25 until the next attempt's first tick. */
  private fun endRegulation(streamer: SingleStreamer) {
    runCatching { streamer.bitrateRegulatorControllerFactory = null }
    LinkRegulators.cleared()
  }

  private fun srtDescriptor(srt: SrtTarget) = SrtMediaDescriptor(
    host = srt.host,
    port = srt.port,
    streamId = srt.streamId,
    passPhrase = srt.passphrase,
    latency = srt.latencyMs,
  )

  /**
   * R2: srtdroid reaches libsrt through `InetSocketAddress(hostname, port)`, which does
   * *not* throw when DNS fails — it yields an unresolved address. `glue.cpp`'s
   * nativeConnect never null-checks the conversion, so libsrt is handed a null sockaddr
   * and answers "Operation not supported: Bad parameters" (MJ_NOTSUP + MN_INVAL). That is
   * a name resolution failure wearing a bad-descriptor error's clothes, and it is what the
   * rehearsal's nine rejections almost certainly were: every one of them carried
   * validated=false. Resolving first makes the CSV say UnknownHostException instead, and
   * costs nothing on a working network.
   */
  private suspend fun resolve(host: String) {
    withContext(Dispatchers.IO) { InetAddress.getByName(host) }
  }

  /**
   * The descriptor's shape, never its secrets — enough to tell a bad parameter from a bad
   * network in one run. libsrt wants a passphrase of 10..79 characters, so the length is
   * the diagnostic; the passphrase and the streamId themselves never leave the device.
   */
  private fun srtShape(srt: SrtTarget): Array<Pair<String, Any?>> = arrayOf(
    "host" to srt.host,
    "port" to srt.port,
    "streamIdLen" to srt.streamId.length,
    "passphraseLen" to (srt.passphrase?.length ?: 0),
    "latencyMs" to srt.latencyMs,
  )

  /** Long enough for a ClosedException from the next frame write; too short to delay a reconnect. */
  private const val DROP_CAUSE_GRACE_MS = 250L

  /**
   * Suspends while publishing; returns why it stopped, and which authority stopped it.
   *
   * R3: two StreamPack signals race here, and reporting whichever arrived first threw the
   * cause away. `isStreamingFlow` is the *pipeline's*, so it means the camera and
   * microphone inputs stopped — which is also what a dead SRT socket looks like, because
   * the sink's `isOpenFlow` stops the output and the output stops the inputs. Meanwhile
   * `CompositeEndpoint.throwableFlow` is a constant null, so a dead socket only becomes a
   * ClosedException on the next frame write, a frame later — and it lost the race every
   * time. So take the first signal, then give a throwable a moment to catch up, and report
   * the endpoint and input states that tell the three causes apart.
   *
   * F-P5-6 adds a signal of our own: the watchdog asking for a recovery. It ends the attempt with
   * `video-stalled`, so the recovery is this loop's own reconnect, and no second authority ever
   * touches the session (AGENTS.md §2).
   */
  private suspend fun awaitDrop(streamer: SingleStreamer, stale: Throwable?, stallsBefore: Int): Drop {
    val fresh = streamer.throwableFlow.filterNotNull().filter { it !== stale }
    val first: DropSignal = merge(
      streamer.isStreamingFlow.filter { !it }.map<Boolean, DropSignal> { DropSignal.InputsStopped },
      fresh.map<Throwable, DropSignal> { DropSignal.Failed(it) },
      stallRequests.filter { it != stallsBefore }.map<Int, DropSignal> { DropSignal.VideoStalled },
    ).first()
    val failure = when (first) {
      is DropSignal.Failed -> first.cause
      DropSignal.InputsStopped -> withTimeoutOrNull(DROP_CAUSE_GRACE_MS) { fresh.first() }
      DropSignal.VideoStalled -> null
    }
    val open = streamer.isOpenFlow.value
    // `requested` is rare by construction: a stop intent cancels this wait before it can
    // report. It exists so that if it ever does fire, the CSV never calls our own stop a
    // failure — which is the distinction the run notes could not make before.
    val reason = when {
      wanted == null -> "requested"
      first == DropSignal.VideoStalled -> VIDEO_STALLED
      !open -> "endpoint-closed"
      else -> "inputs-stopped"
    }
    val detail = arrayOf<Pair<String, Any?>>(
      "reason" to reason,
      "message" to (failure?.let { describe(it) } ?: "none"),
      "endpointOpen" to open,
      // Which input went away: a camera or microphone interruption is not a transport fault.
      "audioStreaming" to runCatching { streamer.audioInput.isStreamingFlow.value }.getOrNull(),
      "videoStreaming" to runCatching { streamer.videoInput.isStreamingFlow.value }.getOrNull(),
    )
    return Drop(reason, detail)
  }

  /** Why [awaitDrop] stopped waiting. */
  private sealed interface DropSignal {
    object InputsStopped : DropSignal
    class Failed(val cause: Throwable) : DropSignal
    object VideoStalled : DropSignal
  }

  /** How an attempt ended: [reason] for the loop, [detail] for the `dropped` row. */
  private class Drop(val reason: String, val detail: Array<Pair<String, Any?>>)

  /** The drop reason F-P5-6's recovery ends an attempt with. The loop reconnects on it as on any other drop. */
  private const val VIDEO_STALLED = "video-stalled"

  private const val WATCHDOG_TICK_MS = 500L

  /**
   * F-P5-6: judges the video frame counter twice a second. It only detects, reports and asks; the
   * publish loop does the recovering. Best-effort, like the mark file: a failing tick must never
   * take the heartbeat or the loop with it.
   */
  private fun watchVideo() {
    scope.launch {
      while (isActive) {
        runCatching { judgeVideo() }
        delay(WATCHDOG_TICK_MS)
      }
    }
  }

  private fun judgeVideo() {
    val streamer = streamerFlow.value
    val counts = (streamer?.endpoint as? CountingEndpoint)?.counts
    // The loop's word and the pipeline's together: a drop reaches the pipeline a moment before the loop.
    val publishing = attemptPublishing && streamer?.isStreamingFlow?.value == true
    watchdog.tick(publishing, counts?.videoFrames, counts?.audioFrames, transport).forEach(::report)
  }

  private fun report(verdict: VideoVerdict) {
    when (verdict) {
      is VideoVerdict.Stalled -> {
        event(
          "video-stalled",
          "msSinceAdvance" to verdict.msSinceAdvance,
          "videoFrames" to verdict.videoFrames,
          "audioAdvancing" to verdict.audioAdvancing,
          "transport" to verdict.transport,
        )
        stallRequests.update { it + 1 }
      }
      is VideoVerdict.Recovered -> event("video-recovered", "msStalled" to verdict.msStalled)
      is VideoVerdict.RecoveryFailed -> event("video-recovery-failed", "attempts" to verdict.attempts)
    }
  }

  /**
   * The loop has ended an attempt for a stall, and the reconnect that follows is the recovery: the
   * same stopStream, close and startStream as the manual reconnect that healed F-P5-6. The hook
   * file goes now, so the next attempt carries video, and one run proves detection, recovery and
   * recovered together.
   */
  private fun beginVideoRecovery() {
    val attempt = watchdog.recoveryStarted() ?: return
    event("video-recovery", "attempt" to attempt, "simulated" to StallSimulation.discardVideo())
    StallSimulation.clear()
  }

  /**
   * C1 counts an SRT failure only on a validated network: a blackout says
   * nothing about SRT. A UDP-blocked network still validates, so it still falls back.
   */
  private fun networkValidated(): Boolean = runCatching {
    // Some Android 11 builds throw SecurityException from getNetworkCapabilities.
    val connectivity = appContext.getSystemService(ConnectivityManager::class.java) ?: return@runCatching false
    val network = connectivity.activeNetwork ?: return@runCatching false
    val capabilities = connectivity.getNetworkCapabilities(network) ?: return@runCatching false
    capabilities.hasCapability(NetworkCapabilities.NET_CAPABILITY_VALIDATED)
  }.getOrDefault(false)

  /** Class *and* message: "Bad parameters" from two different libraries are two different bugs. */
  private fun describe(failure: Throwable): String =
    "${failure.javaClass.simpleName}: ${failure.message ?: "(no message)"}"

  fun mark(label: String) = event("mark", "label" to label)

  private const val MARK_FILE = "p5-mark"
  private const val MARK_POLL_MS = 1_000L
  private const val MARK_LABEL_MAX = 64
  /** Larger than this is not a label: read nothing rather than fold a log file into the CSV. */
  private const val MARK_FILE_MAX_BYTES = 4_096L

  /**
   * R1: the rehearsal drove Mark by tapping, and once the phone locked those taps went to
   * the lock screen, so the CSV had no marks at all and no thermal reading could be tied to
   * "the moment the screen went off". A file the protocol pushes needs neither the UI nor an
   * unlocked screen: `adb push` a one-line file, get a row. Everything here is best-effort —
   * a mark must never be able to kill the sampler or the intent actor.
   */
  private fun watchMarkFile(context: Context) {
    scope.launch {
      val file = File(context.getExternalFilesDir(null), MARK_FILE)
      while (isActive) {
        runCatching { takeMark(file)?.let { event("mark", "label" to it) } }
        delay(MARK_POLL_MS)
      }
    }
  }

  /**
   * Reads the label and removes the file, so one push is one mark. Removed even when it is
   * unusable: a file that cannot be read but survives would mark every second for hours.
   */
  private fun takeMark(file: File): String? {
    if (!file.exists()) return null
    val text =
      if (file.length() in 1..MARK_FILE_MAX_BYTES) runCatching { file.readText() }.getOrNull() else null
    // Truncated is as good as deleted: a zero-length file is ignored on the next tick.
    if (!file.delete()) runCatching { file.writeText("") }
    return text?.lineSequence()?.firstOrNull()?.trim()?.take(MARK_LABEL_MAX)?.ifBlank { null }
  }

  fun logPath(): String = log.file.absolutePath

  /** The app is landscape-locked, so follow the display, not the sensor (P4). */
  private fun watchRotation(streamer: SingleStreamer) {
    scope.launch {
      DisplayRotationProvider(appContext).asFlowProvider().rotationFlow.collect { rotation ->
        streamer.setTargetRotation(rotation)
        event("rotation", "value" to rotation)
      }
    }
  }

  fun event(kind: String, vararg extras: Pair<String, Any?>) {
    val safe = extras.map { (key, value) -> key to scrub(value) }
    log.event(kind, safe.joinToString(" ") { "${it.first}=${it.second}" })
    emit("onEvent", mapOf<String, Any?>("kind" to kind, "atMs" to System.currentTimeMillis()) + safe)
  }

  /**
   * Defence in depth: whoever built the extra, no credential of the current
   * session and no line break reaches the CSV or JS. Longest first, so a
   * secret that contains another is masked whole.
   */
  private fun scrub(value: Any?): Any? {
    if (value == null || value is Number || value is Boolean) return value
    val file = session
    val secrets = listOfNotNull(
      file?.rtmpsUrl,
      file?.rtmpsUrl?.substringAfterLast('/'),
      file?.srt?.passphrase,
      file?.srt?.streamId,
    ).filter { it.isNotBlank() }.flatMap { listOf(it, Uri.encode(it)) }.distinct().sortedByDescending { it.length }
    return secrets.fold(value.toString()) { text, secret -> text.replace(secret, "***") }
      .replace('\n', ' ')
      .replace('\r', ' ')
  }
}
