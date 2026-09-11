package com.seazn.p5spike

import android.annotation.SuppressLint
import android.content.Context
import android.media.AudioFormat
import android.media.MediaFormat
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
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineExceptionHandler
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.filter
import kotlinx.coroutines.flow.filterNotNull
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.merge
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

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
  private var session: SessionFile? = null
  private var publishJob: Job? = null
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
    SpikeTelemetry.start(context, scope) { sample ->
      log.sample(sample)
      emit("onSample", sample)
    }
  }

  @SuppressLint("MissingPermission") // JS requests CAMERA and RECORD_AUDIO before arm().
  fun arm() {
    scope.launch {
      val file = runCatching { SessionFile.read(appContext) }.getOrElse {
        return@launch event("error", "message" to "Bad session file: ${it.message}")
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
  /** C1: SRT failures before falling back. The ordering is R3's to rule; P5 measures it. */
  private const val FALLBACK_AFTER_FAILURES = 3

  fun start(requested: String) {
    wanted = requested
    SpikeForegroundService.start(appContext) // From a JS press, so the app is foreground.
    publishJob?.cancel()
    publishJob = scope.launch { publishLoop(requested) }
  }

  fun stop() {
    wanted = null
    publishJob?.cancel()
    scope.launch {
      streamerFlow.value?.let { runCatching { it.stopStream() }; runCatching { it.close() } }
      transport = null
      SpikeForegroundService.stop(appContext)
      event("stopped")
    }
  }

  /**
   * Native owns reconnect (P2). No promise waits on the network: the loop runs
   * until stop(), and every transition is an event.
   */
  private suspend fun publishLoop(first: String) {
    val file = session ?: return event("error", "message" to "start before arm")
    val streamer = streamerFlow.value ?: return event("error", "message" to "no streamer")
    var current = first
    var srtFailures = 0
    while (currentCoroutineContext().isActive && wanted != null) {
      // throwableFlow is a StateFlow: without this, a stale error from the last
      // attempt would end the next wait instantly.
      val stale = streamer.throwableFlow.value
      try {
        transport = current
        event("connecting", "transport" to current)
        val startedAt = SystemClock.elapsedRealtime()
        if (current == "srt") {
          streamer.startStream(
            SrtMediaDescriptor(
              host = file.srt.host,
              port = file.srt.port,
              streamId = file.srt.streamId,
              passPhrase = file.srt.passphrase,
              latency = file.srt.latencyMs,
            ),
          )
        } else {
          streamer.startStream(file.rtmpsUrl)
        }
        event("publishing", "transport" to current, "connectMs" to SystemClock.elapsedRealtime() - startedAt)
        srtFailures = 0
        val reason = merge(
          streamer.isStreamingFlow.filter { !it }.map { "stopped" },
          streamer.throwableFlow.filterNotNull().filter { it !== stale }.map { it.message ?: it.javaClass.simpleName },
        ).first()
        event("dropped", "transport" to current, "reason" to reason)
      } catch (cancelled: CancellationException) {
        throw cancelled
      } catch (failure: Throwable) {
        event("connect-failed", "transport" to current, "message" to (failure.message ?: failure.javaClass.simpleName))
        if (current == "srt" && ++srtFailures >= FALLBACK_AFTER_FAILURES) {
          current = "rtmps"
          event("fell-back")
        }
      }
      runCatching { streamer.stopStream() }
      runCatching { streamer.close() }
      delay(RETRY_MS)
    }
  }

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
    log.event(kind, extras.joinToString(" ") { "${it.first}=${it.second}" })
    emit("onEvent", mapOf<String, Any?>("kind" to kind, "atMs" to System.currentTimeMillis()) + extras)
  }
}
