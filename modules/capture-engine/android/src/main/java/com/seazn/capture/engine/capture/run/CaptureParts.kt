package com.seazn.capture.engine.capture.run

import com.seazn.capture.engine.core.Command
import kotlinx.coroutines.flow.Flow

/**
 * What [CaptureRun]'s rules ask of StreamPack (Task 36). `StreamerAdapter` is the real one; core's tests
 * fake it. Every call comes from the run's one consumer, never two at once.
 */
interface CaptureParts {
  /** A streamer is built and not yet released. */
  val held: Boolean

  /** Builds the camera, microphone and encoders, encoding at [rotation] (CD42), or says why it built nothing. */
  suspend fun build(rotation: Int): Built

  /** Releases the held streamer, if any, and closes the camera's session: the preview unbinds first (CD37). */
  suspend fun release()

  /** Before a connect: the meter's own recording stops, and the tally, the capture clock and the encoder's bitrate start [attemptId]. */
  fun beforeConnect(attemptId: Int, startBitrateBps: Int)

  /** Opens the endpoint and starts the stream. False when the target does not plan; a throw is the connect's failure. */
  suspend fun start(connect: Command.Connect): Boolean

  /** Stops the stream and closes the endpoint. A call's failure is recorded, never thrown. */
  suspend fun stop()

  /** Returns once the held endpoint has closed. */
  suspend fun endpointClosed()

  /** The broadcast is over and the camera stays: the slate off, the tally idle, the meter's recording back. */
  suspend fun afterBroadcast()

  fun bitrate(bps: Int)

  fun maxBw(attemptId: Int, bytesPerSecond: Long)

  suspend fun switchCamera()

  /**
   * The slate's swap back to our camera: true when that opened it again. False over a camera source, which
   * StreamPack would skip as the same source (item (c)); the run builds the camera afresh when nothing is on air.
   */
  suspend fun reopenCamera(): Boolean

  suspend fun slate(on: Boolean)

  /** Whether StreamPack's AudioRecord session id can be read (N8). */
  fun micSessionKnown(): Boolean

  /**
   * C7 carry: the id of the camera another app holds, when [failure], a start's, is Camera2 saying ours
   * is busy. StreamPack (3.2.0 and 3.2.1, javap) opens the camera lazily, at the first preview or the start, so a camera
   * taken before then shows only there. Null for any other failure, the transport's included.
   */
  fun busyCamera(failure: Throwable): String?

  /**
   * Review C7 I-2: the id of each camera source the held streamer is given, each time StreamPack reports it open,
   * previewing or streaming (3.2.1, javap: `isPreviewingFlow` and `isStreamingFlow` turn true only after the
   * lazy open succeeds; F-S4-1: each time, so an open after a loss is seen). Nothing while nothing is held.
   */
  fun cameraOpens(): Flow<String>

  /**
   * Device session 4, F-S4-1: the id of each camera StreamPack reports lost (Camera2 disconnected it, or put it in a
   * device error), from its own log lines (`VendorLines`): 3.2.1 has no other word for it.
   */
  fun cameraLosses(): Flow<String>

  /**
   * F-S4-1: the id of our camera when [failure], a start's, is the camera's own (`CameraFailures`), not the
   * transport's. Asked after [busyCamera]: another app's take is that one. Null for any other failure.
   */
  fun cameraFailed(failure: Throwable): String?
}

/** What a build made: a streamer, or why none. */
sealed interface Built {
  /** A streamer, on [cameraId]: asked for, not yet opened (StreamPack opens it lazily, review C7 I-2). */
  data class Ready(val cameraId: String) : Built

  /**
   * Nothing built. [reason] is Camera2's `CameraAccessException` reason, when one is in the cause chain;
   * [encoder] when the camera was had and the codecs' configuration failed. [error] is the platform's own.
   */
  class Failed(val cameraId: String, val reason: Int?, val encoder: Boolean, val error: Throwable) : Built
}
