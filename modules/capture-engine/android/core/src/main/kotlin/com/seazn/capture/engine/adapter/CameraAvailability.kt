package com.seazn.capture.engine.adapter

import com.seazn.capture.engine.core.Input

/**
 * F-P5-9 and F-P5-10 as rules over Camera2's availability callbacks: another app opening a camera
 * while ours is held is contention, and the last such camera released is a release. "Session" here
 * is Camera2's capture session, ours from the viewfinder or a held broadcast on, not the engine's.
 *
 * - Our own camera's events are never another app's, and neither is anything inside [selfWindowMs]
 *   of our own switch or reopen ([selfChange]): opening the new camera makes it unavailable.
 * - The contended set is the device's truth, kept while ours is closed, so the next open is told.
 * - I3: a release heard while ours was closed is told at the next open, so the engine never keeps
 *   a camera taken that is free. The engine ignores a release it is not waiting for (Task 7).
 * - I4: an open that failed on a camera another app holds ([waiting]) waits for its release.
 *
 * The camera callback (main looper, Task 37) and the capture scope (Task 36) both call it.
 */
class CameraAvailability(private val selfWindowMs: Long = 1_500) {
  private var ours: String? = null
  private var selfUntil = Long.MIN_VALUE
  private val contended = mutableSetOf<String>()
  private var inSession = false

  /** The last report was [Input.CameraContended], or an open is [waiting]: the engine holds the camera taken. */
  private var told = false

  /** The camera we hold now, or null. Ours is never contended. */
  @Synchronized
  fun held(id: String?, monoMs: Long) {
    ours = id
    if (id != null) contended.remove(id)
  }

  /** Our own switch or reopen starts now: the availability events it causes are ours. */
  @Synchronized
  fun selfChange(monoMs: Long) {
    selfUntil = monoMs + selfWindowMs
  }

  @Synchronized
  fun unavailable(id: String, monoMs: Long): Input? {
    if (id == ours || monoMs < selfUntil) return null
    val first = contended.isEmpty()
    contended += id
    return if (first && inSession) contendedTold() else null
  }

  @Synchronized
  fun available(id: String, monoMs: Long): Input? {
    if (!contended.remove(id) || contended.isNotEmpty() || !inSession) return null
    return releasedTold()
  }

  @Synchronized
  fun sessionStarted(): Input? {
    inSession = true
    return when {
      contended.isNotEmpty() -> contendedTold()
      told -> releasedTold()
      else -> null
    }
  }

  /** Ours closed. The set stays: it is the device's truth, and the next session needs it. */
  @Synchronized
  fun sessionEnded() {
    inSession = false
  }

  /** I4: our open failed because another app holds [id]. Its release is what we wait for, and it is told. */
  @Synchronized
  fun waiting(id: String) {
    ours = null
    inSession = true
    contended += id
    told = true
  }

  private fun contendedTold(): Input {
    told = true
    return Input.CameraContended
  }

  private fun releasedTold(): Input {
    told = false
    return Input.CameraReleased
  }

  companion object {
    // The platform's constants, which the core cannot import. Read with `javap -constants` against
    // android-36's android.jar: the two classes number the same conditions differently.
    /** `CameraAccessException.CAMERA_IN_USE`. */
    private const val CAMERA_IN_USE = 4

    /** `CameraAccessException.MAX_CAMERAS_IN_USE`. */
    private const val MAX_CAMERAS_IN_USE = 5

    /** `CameraDevice.StateCallback.ERROR_CAMERA_IN_USE`. */
    private const val ERROR_CAMERA_IN_USE = 1

    /** `CameraDevice.StateCallback.ERROR_MAX_CAMERAS_IN_USE`. */
    private const val ERROR_MAX_CAMERAS_IN_USE = 2

    /**
     * I4: a `CameraAccessException` reason that means another app holds the camera. A disconnect
     * (2) is not: it is also how a camera service restart looks, and F-P5-9's events already
     * report another app's take.
     */
    fun busy(reason: Int?): Boolean = reason == CAMERA_IN_USE || reason == MAX_CAMERAS_IN_USE

    /** I4: a `CameraDevice.StateCallback.onError` code that means another app holds the camera. */
    fun busyError(error: Int): Boolean = error == ERROR_CAMERA_IN_USE || error == ERROR_MAX_CAMERAS_IN_USE
  }
}
