package com.seazn.p5spike

import android.content.Context
import android.hardware.camera2.CameraManager
import android.os.Handler
import android.os.Looper

/**
 * F-P5-9: evidence that another app has opened a camera while we publish. On 2026-09-28 WhatsApp
 * took camera 1 while the app held camera 0, and the broadcast starved without stopping.
 *
 * `onCameraUnavailable` is called whenever any camera API client opens a device (CameraManager's
 * documentation), our own open included, so the session's own camera is ignored. It is read at
 * every callback from the session ([ownCameraId]), never assumed to be `0`, and written on each row
 * so the controller can check it on the device.
 *
 * Only an unavailability that begins while publishing counts. The first registration replays every
 * camera's current status, and a camera closed off air says nothing about the broadcast. A contended
 * camera stays contended until it is available again, across a drop and a reconnect: a reconnect
 * does not give it back. Evidence only; nothing here changes recovery.
 */
class CameraContention(
  private val ownCameraId: () -> String?,
  private val publishing: () -> Boolean,
  private val onEvent: (String, Array<Pair<String, Any?>>) -> Unit,
) {
  /** Touched only on the main looper, where the callbacks run. */
  private val contended = linkedSetOf<String>()

  /** For the ~1 Hz snapshot, read from the sampler's thread. */
  @Volatile var anyContended = false
    private set

  private val callback = object : CameraManager.AvailabilityCallback() {
    override fun onCameraUnavailable(cameraId: String) = unavailable(cameraId)
    override fun onCameraAvailable(cameraId: String) = available(cameraId)
  }

  /** Once, for the session's lifetime: the session is a process singleton and is never torn down. */
  fun register(context: Context) {
    val cameras = context.getSystemService(CameraManager::class.java) ?: return
    // An explicit main-looper handler: with null, the caller's thread must have a looper, and the
    // session's coroutine threads do not.
    cameras.registerAvailabilityCallback(callback, Handler(Looper.getMainLooper()))
  }

  private fun unavailable(cameraId: String) {
    val own = ownCameraId()
    if (cameraId == own || !publishing() || !contended.add(cameraId)) return
    anyContended = true
    onEvent("camera-contended", arrayOf("cameraId" to cameraId, "ownCameraId" to own))
  }

  private fun available(cameraId: String) {
    if (!contended.remove(cameraId)) return
    anyContended = contended.isNotEmpty()
    onEvent("camera-released", arrayOf("cameraId" to cameraId, "ownCameraId" to ownCameraId()))
  }
}
