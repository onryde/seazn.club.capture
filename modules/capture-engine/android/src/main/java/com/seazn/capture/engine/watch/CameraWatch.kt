package com.seazn.capture.engine.watch

import android.content.Context
import android.hardware.camera2.CameraManager
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import com.seazn.capture.engine.adapter.CameraAvailability
import com.seazn.capture.engine.core.Input
import com.seazn.capture.engine.core.RecordEntry

/**
 * F-P5-9 and F-P5-10: another app's camera use, from Camera2's availability callback, into the one
 * [CameraAvailability] the capture reads (C6 carry: a busy camera waits). Registered at the engine's
 * first build, so the contended set is the device's truth before the first open. Android calls a new
 * callback at once with every camera's state, on the main looper.
 */
class CameraWatch(
  private val context: Context,
  private val rule: CameraAvailability,
  private val report: (Input) -> Unit,
  private val line: (RecordEntry) -> Unit,
) {
  fun start() {
    val manager = context.getSystemService(CameraManager::class.java) ?: return
    manager.registerAvailabilityCallback(Callback(), Handler(Looper.getMainLooper()))
  }

  private inner class Callback : CameraManager.AvailabilityCallback() {
    override fun onCameraUnavailable(cameraId: String) = guarded { rule.unavailable(cameraId, SystemClock.elapsedRealtime()) }

    override fun onCameraAvailable(cameraId: String) = guarded { rule.available(cameraId, SystemClock.elapsedRealtime()) }
  }

  /** A callback that throws on the main thread kills the app: it is recorded instead (the spike's guarded callbacks). */
  private fun guarded(read: () -> Input?) {
    try {
      read()?.let(report)
    } catch (e: Exception) {
      line(RecordEntry("watch-failed", listOf("action" to "camera", "error" to e.javaClass.simpleName)))
    }
  }
}
