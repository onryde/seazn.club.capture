package com.seazn.p5spike

import android.annotation.SuppressLint
import android.content.Context
import android.media.AudioFormat
import android.media.MediaFormat
import android.util.Size
import io.github.thibaultbee.streampack.core.streamers.orientation.DisplayRotationProvider
import io.github.thibaultbee.streampack.core.streamers.orientation.asFlowProvider
import io.github.thibaultbee.streampack.core.streamers.single.AudioConfig
import io.github.thibaultbee.streampack.core.streamers.single.SingleStreamer
import io.github.thibaultbee.streampack.core.streamers.single.VideoConfig
import io.github.thibaultbee.streampack.core.streamers.single.cameraSingleStreamer
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/**
 * The native session, as a process singleton. Native owns it (AGENTS.md §2):
 * JS sends intents and receives events; nothing here waits on JavaScript.
 */
object SpikeSession {
  private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
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

  fun start(requested: String) = event("error", "message" to "start() arrives in Task 4 ($requested)")

  fun stop() = event("stopped")

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
