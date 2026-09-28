package com.seazn.p5spike

import android.content.Context
import android.hardware.camera2.CameraManager
import android.os.Handler
import android.os.Looper
import android.os.SystemClock

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
 *
 * F-P5-10 hands the session the release that leaves no camera contended ([onAllReleased]), for its
 * `hold` and `reopen` experiments. A `reopen` switches our own cameras, and those opens and closes
 * are not another app's: inside [selfSwitchStarted]..[selfSwitchEnded] they are logged as
 * `camera-reopen-status`, which is also the evidence that our camera really closed and reopened.
 */
class CameraContention(
  private val ownCameraId: () -> String?,
  private val publishing: () -> Boolean,
  private val onEvent: (String, Array<Pair<String, Any?>>) -> Unit,
  /** On the main looper, inside this class's guard: the ID whose release left nothing contended. */
  private val onAllReleased: (String) -> Unit = {},
) {
  /** Touched only on the main looper, where the callbacks run. */
  private val contended = linkedSetOf<String>()

  /** For the ~1 Hz snapshot, read from the sampler's thread. */
  @Volatile var anyContended = false
    private set

  /**
   * Until when (elapsedRealtime) camera callbacks are our own reopen's. [Long.MAX_VALUE] while it
   * runs. The service dispatches status changes asynchronously, so a grace after the switch keeps a
   * late one from reading as another app, which would start a second reopen off our own.
   */
  @Volatile private var selfSwitchUntilMs = 0L

  fun selfSwitchStarted() {
    selfSwitchUntilMs = Long.MAX_VALUE
  }

  fun selfSwitchEnded() {
    selfSwitchUntilMs = SystemClock.elapsedRealtime() + SELF_SWITCH_GRACE_MS
  }

  private fun selfSwitch(cameraId: String, available: Boolean): Boolean {
    if (SystemClock.elapsedRealtime() >= selfSwitchUntilMs) return false
    onEvent("camera-reopen-status", arrayOf("cameraId" to cameraId, "available" to available))
    return true
  }

  /**
   * The callbacks run on the main looper, outside the session scope's exception handler, and
   * [onEvent] writes the CSV. A throw here would kill the process mid-broadcast, so nothing leaves.
   */
  private val callback = object : CameraManager.AvailabilityCallback() {
    override fun onCameraUnavailable(cameraId: String) = guarded { unavailable(cameraId) }
    override fun onCameraAvailable(cameraId: String) = guarded { available(cameraId) }
  }

  private fun guarded(body: () -> Unit) {
    runCatching(body).onFailure { failure ->
      // Reporting it is best-effort too: the log may be what failed.
      runCatching { onEvent("error", arrayOf("message" to "camera contention callback: $failure")) }
    }
  }

  /** Once, for the session's lifetime: the session is a process singleton and is never torn down. */
  fun register(context: Context) {
    val cameras = context.getSystemService(CameraManager::class.java) ?: return
    // An explicit main-looper handler: with null, the caller's thread must have a looper, and the
    // session's coroutine threads do not.
    cameras.registerAvailabilityCallback(callback, Handler(Looper.getMainLooper()))
  }

  private fun unavailable(cameraId: String) {
    if (selfSwitch(cameraId, available = false)) return
    val own = ownCameraId()
    if (cameraId == own || !publishing() || !contended.add(cameraId)) return
    anyContended = true
    onEvent("camera-contended", arrayOf("cameraId" to cameraId, "ownCameraId" to own))
  }

  private fun available(cameraId: String) {
    if (selfSwitch(cameraId, available = true)) return
    if (!contended.remove(cameraId)) return
    anyContended = contended.isNotEmpty()
    onEvent("camera-released", arrayOf("cameraId" to cameraId, "ownCameraId" to ownCameraId()))
    if (!anyContended) onAllReleased(cameraId)
  }

  private companion object {
    /** Four status changes in a round trip, each within a few hundred ms of the open or close behind it. */
    const val SELF_SWITCH_GRACE_MS = 1_500L
  }
}
