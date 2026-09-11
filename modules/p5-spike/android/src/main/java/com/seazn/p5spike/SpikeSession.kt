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
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeout

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

  /** Survives JS reloads: a second attach only swaps the emitter. */
  fun attach(context: Context, emitter: (String, Map<String, Any?>) -> Unit) {
    emit = emitter
    if (::appContext.isInitialized) return
    appContext = context
    log = SpikeLog(context)
    runIntents()
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
        val streamer = withContext(Dispatchers.Main) { cameraSingleStreamer(appContext) }
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
    streamerFlow.value?.let { runCatching { it.stopStream() }; runCatching { it.close() } }
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
      try {
        connect(streamer, file, current)
        srtFailures = 0
        event("dropped", "transport" to current, "reason" to awaitDrop(streamer, stale))
      } catch (failure: Throwable) {
        // A real cancel (the next intent) rethrows here. A timeout or a stray
        // library cancellation falls through and counts as a failed connect.
        currentCoroutineContext().ensureActive()
        val counted = current == "srt" && networkValidated()
        event("connect-failed", "transport" to current, "counted" to counted, "message" to describe(failure))
        if (counted && ++srtFailures >= FALLBACK_AFTER_FAILURES) {
          current = "rtmps"
          event("fell-back")
        }
      }
      runCatching { streamer.stopStream() }
      runCatching { streamer.close() }
      delay(RETRY_MS)
    }
  }

  /** One attempt, from connecting to publishing. Throws on failure or timeout. */
  private suspend fun connect(streamer: SingleStreamer, file: SessionFile, via: String) {
    transport = via
    event("connecting", "transport" to via)
    val startedAt = SystemClock.elapsedRealtime()
    withTimeout(CONNECT_TIMEOUT_MS) {
      if (via == "srt") streamer.startStream(srtDescriptor(file.srt)) else streamer.startStream(file.rtmpsUrl)
    }
    event("publishing", "transport" to via, "connectMs" to SystemClock.elapsedRealtime() - startedAt)
  }

  private fun srtDescriptor(srt: SrtTarget) = SrtMediaDescriptor(
    host = srt.host,
    port = srt.port,
    streamId = srt.streamId,
    passPhrase = srt.passphrase,
    latency = srt.latencyMs,
  )

  /** Suspends while publishing; returns why it stopped. */
  private suspend fun awaitDrop(streamer: SingleStreamer, stale: Throwable?): String = merge(
    streamer.isStreamingFlow.filter { !it }.map { "pipeline-stopped" },
    streamer.throwableFlow.filterNotNull().filter { it !== stale }.map { describe(it) },
  ).first()

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

  private fun describe(failure: Throwable): String = failure.message ?: failure.javaClass.simpleName

  fun mark(label: String) = event("mark", "label" to label)

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
