package com.seazn.capture.engine.adapter

/**
 * Device session 4, F-S4-1: whether a start's failure is the camera's own, as StreamPack 3.2.1 makes one (its
 * sources), so the capture reports it as the camera's (`ConnectFailure.CAMERA`) and builds the camera afresh,
 * never as the path's. Read by name: the core imports neither Android nor StreamPack. Through the cause chain,
 * as [Failures] reads it, since coroutines' stack-trace recovery may hand the run a copy that wraps the throw:
 * - Camera2's `CameraAccessException`, or StreamPack's `CameraException` (`CameraUtils.openCamera`'s `onError`
 *   words);
 * - the `RuntimeException` `CameraUtils.openCamera` makes of `onDisconnected`, "Camera has been disconnected";
 * - any throw made inside StreamPack's camera source package, such as `CameraController.addTarget`'s.
 *
 * Another app's take is the adapter's busy reading, asked first (C7 carry); this is every other camera failure.
 */
object CameraFailures {
  fun camera(failure: Throwable): Boolean = generateSequence(failure) { it.cause }.take(MAX_CAUSES).any(::own)

  private fun own(thrown: Throwable): Boolean =
    named(thrown) || thrown.message == DISCONNECTED || thrown.stackTrace.firstOrNull()?.className?.startsWith(SOURCE) == true

  private fun named(thrown: Throwable): Boolean = generateSequence<Class<*>>(thrown.javaClass) { it.superclass }.any { it.name in CLASSES }

  private const val MAX_CAUSES = 8

  /** `CameraUtils.openCamera`'s `onDisconnected`, while the open waits (3.2.1). */
  private const val DISCONNECTED = "Camera has been disconnected"

  /** StreamPack 3.2.1's camera source and everything under it: `CameraSource`, its controllers and utils. */
  private const val SOURCE = "io.github.thibaultbee.streampack.core.elements.sources.video.camera."

  private val CLASSES = setOf("android.hardware.camera2.CameraAccessException", SOURCE + "CameraException")
}
