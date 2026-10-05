package com.seazn.capture.engine.capture

import android.annotation.SuppressLint
import android.content.Context
import android.hardware.camera2.CameraAccessException
import android.media.AudioFormat
import android.media.MediaFormat
import android.os.SystemClock
import android.util.Size
import com.seazn.capture.engine.adapter.AttemptSignals
import com.seazn.capture.engine.adapter.CameraAvailability
import com.seazn.capture.engine.adapter.CameraFailures
import com.seazn.capture.engine.adapter.EncoderKeys
import com.seazn.capture.engine.adapter.FrameTally
import com.seazn.capture.engine.adapter.PeakMeter
import com.seazn.capture.engine.adapter.SrtOptions
import com.seazn.capture.engine.capture.run.Built
import com.seazn.capture.engine.capture.run.CaptureParts
import com.seazn.capture.engine.capture.run.CaptureRun
import com.seazn.capture.engine.capture.run.CoreCalls
import com.seazn.capture.engine.core.Command
import com.seazn.capture.engine.core.Encode
import com.seazn.capture.engine.core.PairRequest
import com.seazn.capture.engine.core.RecordEntry
import com.seazn.capture.engine.core.RtmpsTarget
import com.seazn.capture.engine.core.Side
import com.seazn.capture.engine.core.SrtTarget
import com.seazn.capture.engine.endpoints.CaptureClockLine
import com.seazn.capture.engine.net.HostLookup
import com.seazn.capture.engine.endpoints.CaptureEndpointFactory
import com.seazn.capture.engine.endpoints.RtmpDispatcher
import com.seazn.capture.engine.srt.SeaznSrtSink
import io.github.thibaultbee.streampack.core.elements.encoders.AudioCodecConfig
import io.github.thibaultbee.streampack.core.elements.encoders.VideoCodecConfig
import io.github.thibaultbee.streampack.core.elements.endpoints.composites.muxers.ts.data.TSServiceInfo
import io.github.thibaultbee.streampack.core.elements.sources.video.IVideoSourceInternal
import io.github.thibaultbee.streampack.core.elements.sources.video.camera.CameraException
import io.github.thibaultbee.streampack.core.elements.sources.video.camera.CameraSourceFactory
import io.github.thibaultbee.streampack.core.elements.sources.video.camera.ICameraSource
import io.github.thibaultbee.streampack.core.elements.sources.video.camera.extensions.backCameras
import io.github.thibaultbee.streampack.core.elements.sources.video.camera.extensions.cameraManager
import io.github.thibaultbee.streampack.core.elements.sources.video.camera.extensions.defaultCameraId
import io.github.thibaultbee.streampack.core.elements.sources.video.camera.extensions.frontCameras
import io.github.thibaultbee.streampack.core.elements.sources.video.camera.extensions.isBackCamera
import io.github.thibaultbee.streampack.core.interfaces.startStream
import io.github.thibaultbee.streampack.core.streamers.single.SingleStreamer
import io.github.thibaultbee.streampack.core.streamers.single.cameraSingleStreamer
import io.github.thibaultbee.streampack.ext.srt.configuration.mediadescriptor.SrtMediaDescriptor
import java.net.URLEncoder
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineExceptionHandler
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.awaitCancellation
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.emptyFlow
import kotlinx.coroutines.flow.filter
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.transformLatest
import kotlinx.coroutines.launch

/**
 * Capture and publish with StreamPack (CD27, CD37, CD42). Holds no rule: [CaptureRun] decides which call
 * comes when and what is reported, on one consumer (PV38); [Parts] makes StreamPack's calls.
 */
@SuppressLint("MissingPermission") // CD37: the capture opens only after CAMERA and RECORD_AUDIO are granted
class StreamerAdapter(
  private val context: Context,
  private val tally: FrameTally,
  signals: AttemptSignals,
  private val cameras: CameraAvailability,
  private val calls: CoreCalls,
  side: () -> Side,
  /** F-S4-1: StreamPack's word that a camera was lost, from its own log lines (EngineHost's `VendorLines`). */
  private val losses: Flow<String>,
) : Capture {
  private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default + CoroutineExceptionHandler { _, t -> calls.failure(t) })
  private val shown = PeakMeter()
  private val ready = PeakMeter()
  private val sound = SoundMeter(::level, calls.line)
  private val sink = SeaznSrtSink(Dispatchers.IO.limitedParallelism(2), signals, calls.report, calls.line)
  private val lookup = HostLookup()
  private val clock = CaptureClockLine(calls.line)
  private val endpoints = CaptureEndpointFactory(tally, sink, RtmpDispatcher.create(), clock)
  private val current = MutableStateFlow<SingleStreamer?>(null)
  override val streamer: StateFlow<SingleStreamer?> = current

  @Volatile private var cameraId: String? = null
  private var readinessJob: Job? = null

  // Last: the run's consumer starts here, and only ever calls the parts for a call made after construction.
  private val run = CaptureRun(Parts(), signals, cameras, calls, side, scope)

  override fun open(request: PairRequest) = run.open(request)

  override fun close() = run.close()

  override fun execute(command: Command) = run.execute(command)

  override fun foreground() = run.foreground()

  override fun frames(attemptId: Int) = tally.read(attemptId)

  override fun link(attemptId: Int) = sink.counters(attemptId)

  override fun facts() = CaptureFacts(shown.take(), clock.lastVideoEpochMs)

  /**
   * Review C7 I-2: the preview's open of the camera source failed (StreamPack 3.2.1's `PreviewView` catches it
   * and hands it to its `PreviewListener`, javap). The camera is not ready, and another app's hold of it is
   * contention, whose release has the machine reopen it.
   */
  override fun previewFailed(failure: Throwable) {
    val camera = current.value?.videoInput?.sourceFlow?.value as? ICameraSource ?: return
    cameras.openFailed(camera.cameraId, busy(failure))?.let(calls.report)
  }

  /**
   * C7 carry: Camera2's busy word anywhere in [failure]'s cause chain. An open that throws keeps Camera2's own
   * reason; one that fails in `StateCallback.onError` reaches us as a message-only `CameraException`, whose
   * busy messages are [BUSY_WORDS].
   */
  private fun busy(failure: Throwable): Boolean =
    generateSequence(failure) { it.cause }.take(8).any { cause ->
      (cause is CameraException && cause.message in BUSY_WORDS) || (cause is CameraAccessException && CameraAvailability.busy(cause.reason))
    }

  /** Task 37's MicWatch: our AudioRecord's session id, by reflection (StreamPack keeps it private). */
  fun audioSessionId(): Int? = current.value?.audioInput?.sourceFlow?.value?.let(AudioSessionIds::of)

  private fun level(peak: Double) {
    shown.offer(peak)
    ready.offer(peak)
  }

  /** A11, CD42: every 500 ms while open, until the release cancels it. BridgeCore sends only a change of check on. */
  private suspend fun reportReadiness() {
    while (true) {
      calls.readiness(current.value?.let(::cameraOurs) ?: false, ready.take())
      delay(READINESS_MS)
    }
  }

  /**
   * CD42: before the connect, our camera is the video source and its open has not failed (review C7 I-2);
   * contention is the engine's `camera` field.
   */
  private fun cameraOurs(held: SingleStreamer): Boolean = cameras.ready(held.videoInput.sourceFlow.value is ICameraSource)

  /** A teardown call whose failure is recorded and does not stop the next one. Never swallows cancellation. */
  private suspend fun quietly(action: String, block: suspend () -> Unit): Boolean =
    try {
      block()
      true
    } catch (e: CancellationException) {
      throw e
    } catch (e: Exception) {
      calls.line(RecordEntry("capture-call-failed", listOf("action" to action, "error" to e.javaClass.simpleName)))
      false
    }

  /** StreamPack's calls, one at a time on the run's consumer. */
  private inner class Parts : CaptureParts {
    override val held: Boolean
      get() = current.value != null

    /** P11, P12, I4: a failure is returned, with Camera2's reason when one is in its cause chain; never thrown. */
    override suspend fun build(rotation: Int): Built {
      val id = context.cameraManager.backCameras.firstOrNull() ?: context.defaultCameraId
      cameras.selfChange(SystemClock.elapsedRealtime()) // our own open's availability events are ours
      val made =
        try {
          cameraSingleStreamer(context, cameraId = id, endpointFactory = endpoints, defaultRotation = rotation)
        } catch (e: CancellationException) {
          throw e
        } catch (e: Exception) {
          return Built.Failed(id, accessReason(e), encoder = false, error = e)
        }
      configured(made)?.let { return Built.Failed(id, accessReason(it), encoder = true, error = it) }
      cameraId = id
      current.value = made
      sound.start()
      readinessJob = scope.launch { reportReadiness() }
      return Built.Ready(id) // I-2: asked for, not opened: StreamPack opens it at the first preview or the start
    }

    /** I4: the Camera2 reason anywhere in the cause chain, so a wrapper of StreamPack's does not hide it. */
    private fun accessReason(e: Throwable): Int? =
      generateSequence(e) { it.cause }.take(8).filterIsInstance<CameraAccessException>().firstOrNull()?.reason

    /** The codecs and the level effect; the streamer is released when they fail, and the failure returned. */
    private suspend fun configured(made: SingleStreamer): Exception? =
      try {
        made.setAudioConfig(AUDIO)
        made.setVideoConfig(video())
        made.audioInput.processor.add(AudioLevelEffect(::level))
        null
      } catch (e: CancellationException) {
        throw e
      } catch (e: Exception) {
        quietly("release") { made.release() }
        e
      }

    override suspend fun release() {
      sound.stop()
      readinessJob?.cancel()
      readinessJob = null
      val held = current.value
      current.value = null // the preview unbinds first (Task 39)
      if (held != null) {
        quietly("stop") { held.stopStream() }
        quietly("close") { held.close() }
        quietly("release") { held.release() }
      }
      cameras.held(null) // C6: another app's take of our old camera is heard again
      cameras.sessionEnded()
      tally.begin(-1)
      calls.readiness(false, 0.0)
    }

    override fun beforeConnect(attemptId: Int, startBitrateBps: Int) {
      sound.stop()
      tally.begin(attemptId)
      clock.newAttempt()
      current.value?.videoEncoder?.bitrate = startBitrateBps
    }

    override suspend fun start(connect: Command.Connect): Boolean {
      val held = checkNotNull(current.value) { "no streamer held" }
      when (val target = connect.target) {
        is SrtTarget -> {
          val plan = SrtOptions.plan(target, connect.maxBwBytesPerSecond) ?: return false
          sink.next(plan, connect.attemptId)
          held.startStream(SrtMediaDescriptor(plan.host, plan.port, serviceInfo = SERVICE))
        }
        is RtmpsTarget -> {
          lookup.warm(target.url) // C6 re-review: komuxer's own lookup is blocking; this one is inside the start's bound
          held.startStream(target.url.trimEnd('/') + "/" + URLEncoder.encode(target.streamKey, "UTF-8"))
        }
      }
      return true
    }

    override suspend fun stop() {
      val held = current.value ?: return
      quietly("stop") { held.stopStream() }
      quietly("close") { held.close() }
    }

    override suspend fun endpointClosed() {
      val held = current.value ?: awaitCancellation()
      held.endpoint.isOpenFlow.first { open -> !open }
    }

    override suspend fun afterBroadcast() {
      slate(false)
      tally.begin(-1)
      sound.start()
    }

    override fun bitrate(bps: Int) {
      current.value?.videoEncoder?.bitrate = bps
    }

    override fun maxBw(attemptId: Int, bytesPerSecond: Long) = sink.setMaxBw(attemptId, bytesPerSecond)

    override suspend fun switchCamera() {
      val held = current.value ?: return
      val manager = context.cameraManager
      val onBack = cameraId?.let(manager::isBackCamera) ?: true
      val other = (if (onBack) manager.frontCameras else manager.backCameras).firstOrNull() ?: return
      cameras.selfChange(SystemClock.elapsedRealtime())
      cameras.opening(other) // I-2: before the source, so its open is ours; held once StreamPack reports it open
      held.setVideoSource(CameraSourceFactory(other))
      cameraId = other
    }

    override suspend fun reopenCamera(): Boolean {
      val held = current.value ?: return false
      val id = cameraId ?: return false
      // Item (c): StreamPack skips a camera source of the same id (isSourceEquals), so only the slate's swap opens one.
      if (held.videoInput.sourceFlow.value is ICameraSource) return false
      cameras.selfChange(SystemClock.elapsedRealtime())
      cameras.opening(id) // I-2, review C7 M-4: held once StreamPack reports the new source open
      return quietly("reopen") { held.setVideoSource(CameraSourceFactory(id)) }
    }

    override suspend fun slate(on: Boolean) {
      val held = current.value ?: return
      val onSlate = held.videoInput.sourceFlow.value !is ICameraSource
      if (on == onSlate) return
      if (on) {
        held.setVideoSource(SlateSource.factory(context))
      } else {
        cameraId?.let {
          cameras.opening(it) // I-2: a new camera source, opened afresh
          held.setVideoSource(CameraSourceFactory(it))
        }
      }
      held.audioInput.isMuted = on
    }

    override fun micSessionKnown(): Boolean = audioSessionId() != null

    /** C7 carry: our camera's id when the start failed on Camera2's busy word ([busy]). */
    override fun busyCamera(failure: Throwable): String? = cameraId?.takeIf { busy(failure) }

    /** F-S4-1: our camera's id when the start failed on the camera's own failure, by the core's reading of it. */
    override fun cameraFailed(failure: Throwable): String? = cameraId?.takeIf { CameraFailures.camera(failure) }

    override fun cameraLosses(): Flow<String> = losses

    /**
     * Review C7 I-2: each camera source's id when StreamPack 3.2.1 reports it open, previewing or streaming
     * (javap: `CameraSource.startPreview` and `startStream` emit true after `CameraController.addTarget`, the
     * lazy open). A new source, a switch's or a reopen's, is watched afresh. F-S4-1: each time it turns open,
     * not once: a camera lost on air reads not ready until StreamPack's next start opens it again, and only
     * that open says so (CameraSource turns both false when its device closes, the 3.2.1 sources).
     */
    @OptIn(ExperimentalCoroutinesApi::class) // transformLatest
    override fun cameraOpens(): Flow<String> {
      val held = current.value ?: return emptyFlow()
      return held.videoInput.sourceFlow.transformLatest { source ->
        val camera = source as? ICameraSource ?: return@transformLatest
        val streaming = (camera as? IVideoSourceInternal)?.isStreamingFlow ?: MutableStateFlow(false)
        combine(camera.isPreviewingFlow, streaming) { previewing, streams -> previewing || streams }
          .distinctUntilChanged()
          .filter { it }
          .collect { emit(camera.cameraId) }
      }
    }
  }

  private fun video() =
    VideoCodecConfig(
      mimeType = MediaFormat.MIMETYPE_VIDEO_AVC,
      startBitrate = Encode.START_BPS,
      resolution = Size(1280, 720),
      fps = 30,
      gopDurationInS = 2f,
      customize = { _ -> EncoderKeys.VIDEO.forEach { (key, value) -> setInteger(key, value) } },
    )

  private companion object {
    const val READINESS_MS = 500L

    /**
     * StreamPack's `CameraException` messages (3.2.0 and 3.2.1) for `StateCallback.onError`'s ERROR_CAMERA_IN_USE (1) and
     * ERROR_MAX_CAMERAS_IN_USE (2), read with javap from `CameraUtils$openCamera$2$callbacks$1`. Its other
     * codes (disabled, device, service, unknown) are no other app's hold.
     */
    val BUSY_WORDS = setOf("Camera already in use", "Max cameras in use")

    // StreamPack's TSServiceInfo declares `id: Short` (3.2.0's source, TSServiceInfo.kt:20; 3.2.1 javap).
    val SERVICE = TSServiceInfo(TSServiceInfo.ServiceType.DIGITAL_TV, 0x4698.toShort(), "Seazn", "Seazn Capture")

    /** M10: PcmPeak reads 16-bit samples, so the byte format is set, never left to a default. */
    val AUDIO =
      AudioCodecConfig(
        mimeType = MediaFormat.MIMETYPE_AUDIO_AAC,
        startBitrate = 128_000,
        sampleRate = 48_000,
        channelConfig = AudioFormat.CHANNEL_IN_STEREO,
        byteFormat = AudioFormat.ENCODING_PCM_16BIT,
      )
  }
}
