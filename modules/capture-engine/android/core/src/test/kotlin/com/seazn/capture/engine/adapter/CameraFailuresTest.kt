package com.seazn.capture.engine.adapter

import android.hardware.camera2.CameraAccessException
import com.seazn.capture.engine.StreamPack
import com.seazn.capture.engine.thrownAt
import io.github.thibaultbee.streampack.core.elements.sources.video.camera.CameraException
import java.net.ConnectException
import java.util.concurrent.TimeoutException
import kotlin.test.Test
import kotlin.test.assertEquals

/**
 * F-S4-1: a start's failure is the camera's own as StreamPack 3.2.1 makes one (its sources): `CameraUtils.openCamera`'s
 * words, Camera2's access failure, or a throw made inside the camera source. Anything else is the path's.
 */
class CameraFailuresTest {
  @Test
  fun `F-S4-1 the camera's own failures read as the camera's, through the cause chain, and the path's never do`() {
    val rows =
      listOf(
        CameraException("Camera device has crashed") to true, // onError, ERROR_CAMERA_DEVICE
        CameraException("Camera service has crashed") to true,
        CameraAccessException(2, "CAMERA_DISCONNECTED (2): connect:1234: Camera service is busy") to true,
        RuntimeException("Camera has been disconnected") to true, // onDisconnected, while the open waits
        thrownAt(IllegalArgumentException("Output STREAM not found"), "${StreamPack.CAMERA}.controllers.CameraController", "addTarget") to true,
        thrownAt(IllegalStateException("closed"), "${StreamPack.CAMERA}.CameraSource\$startStream\$2", "invokeSuspend") to true,
        RuntimeException("start failed", CameraException("Camera has been disabled")) to true,
        RuntimeException("start failed", RuntimeException("Camera has been disconnected")) to true,
        thrownAt(IllegalArgumentException("Endpoint must be opened before starting stream"), StreamPack.PIPELINE_OUTPUT, "startStreamUnsafe") to false,
        thrownAt(ConnectException("Connection setup failure: connection rejected"), "com.seazn.capture.engine.srt.SeaznSrtSink", "startStream") to false,
        thrownAt(IllegalStateException("Codec is released"), StreamPack.ENCODER, "startStream") to false,
        TimeoutException("start timed out after 14000 ms") to false,
        RuntimeException("Camera has been disconnected twice") to false, // the words, not a word in them
        thrownAt(IllegalStateException("x"), "io.github.thibaultbee.streampack.core.elements.sources.video.cameraX.Other", "run") to false,
      )
    var checked = 0
    for ((failure, camera) in rows) {
      assertEquals(camera, CameraFailures.camera(failure), "${failure.javaClass.simpleName}: ${failure.message}")
      checked += 1
    }
    assertEquals(14, checked, "the sweep's own count")
    assertEquals(rows.count { it.second }, 8, "both sides of the rule are swept")
  }
}
