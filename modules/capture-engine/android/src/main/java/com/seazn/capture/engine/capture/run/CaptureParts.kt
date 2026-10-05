package com.seazn.capture.engine.capture.run

import com.seazn.capture.engine.core.Command

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

  /** True when the camera opened again. */
  suspend fun reopenCamera(): Boolean

  suspend fun slate(on: Boolean)

  /** Whether StreamPack's AudioRecord session id can be read (N8). */
  fun micSessionKnown(): Boolean
}

/** What a build made: a streamer, or why none. */
sealed interface Built {
  data object Ready : Built

  /**
   * Nothing built. [reason] is Camera2's `CameraAccessException` reason, when one is in the cause chain;
   * [encoder] when the camera was had and the codecs' configuration failed. [error] is the platform's own.
   */
  class Failed(val cameraId: String, val reason: Int?, val encoder: Boolean, val error: Throwable) : Built
}
