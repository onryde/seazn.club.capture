package com.seazn.capture.engine.capture

import android.content.ContentResolver
import android.content.ContentValues
import android.graphics.Bitmap
import android.provider.MediaStore
import com.seazn.capture.engine.core.Side
import io.github.thibaultbee.streampack.core.elements.sources.video.camera.ICameraSource
import io.github.thibaultbee.streampack.core.streamers.single.SingleStreamer
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/**
 * Spec §8, R1: one still of the camera picture, no scorebug (the score is a WebView, not in the frames), written to
 * `Pictures/Seazn Capture` with MediaStore. minSdk is 31, so the app writes its own image with no storage permission.
 * A throw goes up to PhotoRun, the one place that answers it.
 */
class GalleryPhoto(
  private val resolver: ContentResolver,
  private val streamer: () -> SingleStreamer?,
  private val side: () -> Side,
) {
  suspend fun shoot(name: String) {
    val video = streamer()?.videoInput ?: error("no-streamer")
    check(video.sourceFlow.value is ICameraSource) { "not-the-camera" } // the slate is up: that is not a picture of the match
    val bitmap = video.takeSnapshot(side().rotationDegrees) // D5: the side held for the broadcast
    try {
      withContext(Dispatchers.IO) { store(name, bitmap) }
    } finally {
      bitmap.recycle() // withContext returns only once store has, a cancelled photo included, so this never meets a running compress
    }
  }

  private fun store(name: String, bitmap: Bitmap) {
    val pending =
      ContentValues().apply {
        put(MediaStore.Images.Media.DISPLAY_NAME, name)
        put(MediaStore.Images.Media.MIME_TYPE, "image/jpeg")
        put(MediaStore.Images.Media.RELATIVE_PATH, "Pictures/Seazn Capture")
        put(MediaStore.Images.Media.IS_PENDING, 1)
      }
    val uri = resolver.insert(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, pending) ?: error("no-uri")
    try {
      val stream = resolver.openOutputStream(uri) ?: error("no-stream")
      stream.use { check(bitmap.compress(Bitmap.CompressFormat.JPEG, QUALITY, it)) { "compress-failed" } }
      check(resolver.update(uri, ContentValues().apply { put(MediaStore.Images.Media.IS_PENDING, 0) }, null, null) == 1) { "not-published" }
    } catch (t: Throwable) {
      resolver.delete(uri, null, null) // no half-written row is left in the gallery
      throw t
    }
  }

  private companion object {
    const val QUALITY = 92
  }
}
