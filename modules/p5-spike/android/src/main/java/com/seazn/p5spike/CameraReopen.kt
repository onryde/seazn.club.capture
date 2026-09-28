package com.seazn.p5spike

import android.annotation.SuppressLint
import android.graphics.Bitmap
import android.hardware.camera2.CameraManager
import io.github.thibaultbee.streampack.core.elements.sources.video.bitmap.BitmapSourceFactory
import io.github.thibaultbee.streampack.core.elements.sources.video.camera.ICameraSource
import io.github.thibaultbee.streampack.core.interfaces.setCameraId
import io.github.thibaultbee.streampack.core.streamers.single.SingleStreamer

/**
 * F-P5-10 `reopen`: close our camera and open it again, without stopping the stream. After WhatsApp
 * released camera 1, a stream rebuild on the same camera session left the broadcast as noise; this
 * asks whether a fresh camera device and capture session heal it.
 *
 * StreamPack 3.2.0 offers no in-place reopen. `VideoInput.setSource` skips a factory for the camera
 * already set ("Camera id … is already set, skipping"), so the reopen is a camera-ID round trip,
 * own → [via] → own, through the public `setCameraId`: the path StreamPack's own demo uses to switch
 * cameras while live. For a camera-to-camera switch `setSource` stops and releases the previous
 * camera (device and session closed) before it creates the next, gives the new source a new input
 * surface in the GL processor, and starts it if the input was streaming. The endpoint and encoders
 * are untouched, so the publish carries on.
 *
 * The video is muted to black for the round trip (`IVideoInput.isMuted`, which the GL renderer
 * honours per frame), so viewers never see [via]'s picture, which is the operator's side.
 */
object CameraReopen {
  const val METHOD = "camera-id-round-trip"

  /**
   * The camera to pass through: the one just released when it is a real camera other than ours,
   * else the first other camera the device lists. Null on a single-camera device.
   */
  fun viaCamera(cameras: CameraManager, own: String, released: String): String? {
    val ids = cameras.cameraIdList.toList()
    return released.takeIf { it != own && it in ids } ?: ids.firstOrNull { it != own }
  }

  /**
   * Suspends until the round trip is done. On failure, puts our camera back ([restore]) before
   * rethrowing, and always unmutes: a failed reopen must not leave the broadcast black or cameraless.
   */
  @SuppressLint("MissingPermission") // CAMERA is granted before arm, which built this streamer.
  suspend fun roundTrip(streamer: SingleStreamer, own: String, via: String) {
    val input = streamer.videoInput
    input.isMuted = true
    try {
      streamer.setCameraId(via)
      streamer.setCameraId(own)
    } catch (failure: Throwable) {
      runCatching { restore(streamer, own) }.exceptionOrNull()?.let(failure::addSuppressed)
      throw failure
    } finally {
      input.isMuted = false
    }
  }

  /** Our camera ID as the video input sees it now: evidence for the row, and what [restore] checks. */
  fun currentCameraId(streamer: SingleStreamer): String? =
    (streamer.videoInput.sourceFlow.value as? ICameraSource)?.cameraId

  /**
   * A failure on the first leg leaves the released own camera as the input's source, and
   * `setCameraId(own)` would then be skipped as already set. So step through a blank bitmap source,
   * which opens no device, to make the own camera a fresh source again. A failure on the second leg
   * leaves [via] set, and own is simply set again.
   */
  @SuppressLint("MissingPermission")
  private suspend fun restore(streamer: SingleStreamer, own: String) {
    if (currentCameraId(streamer) == own) {
      streamer.setVideoSource(BitmapSourceFactory(Bitmap.createBitmap(16, 16, Bitmap.Config.ARGB_8888)))
    }
    streamer.setCameraId(own)
  }
}
