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
 * - Review C7 I-2: StreamPack (3.2.0 and 3.2.1, javap) opens the camera lazily, at the first preview or
 *   the start, so a build holds nothing yet ([opening]). A take heard before it stands, and is told at
 *   the session's start; the camera is ours, and no longer contended, once StreamPack reports its source
 *   open ([opened]). The camera reads ready ([ready]) unless that open failed ([openFailed]).
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

  /** I-2: the open of [ours] failed since it was asked; a new open asked, or one seen, clears it. */
  private var failed = false

  /** The camera we hold now, or null. Ours is never contended. */
  @Synchronized
  fun held(id: String?) {
    ours = id
    if (id != null) contended.remove(id)
  }

  /**
   * I-2: our open of [id] is asked for (a build, a switch, a reopen, the slate's end). Its own events are
   * ours, but nothing is erased: StreamPack has opened nothing yet, so another app's take stands.
   */
  @Synchronized
  fun opening(id: String) {
    ours = id
    failed = false
  }

  /**
   * I-2: StreamPack reports [id]'s source open (previewing or streaming): ours, so no longer contended, and
   * a take told that this clears is told over. The open of a source we have moved off is nothing.
   */
  @Synchronized
  fun opened(id: String): Input? {
    if (id != ours) return null
    held(id)
    failed = false
    return if (inSession && told && contended.isEmpty()) releasedTold() else null
  }

  /**
   * I-2: the open of [id] failed (the preview's, StreamPack 3.2.1's `PreviewListener`): the camera is not
   * ready. A [busy] camera is another app's take, told as one, whose release is waited for.
   */
  @Synchronized
  fun openFailed(id: String, busy: Boolean): Input? {
    if (id != ours) return null
    failed = true
    if (!busy) return null
    val first = contended.isEmpty()
    contended += id
    return if (first && inSession) contendedTold() else null
  }

  /**
   * I-2: the camera reads ready while the source is a [camera] and no open of it has failed since it was
   * asked. Not "an open seen": with the phone locked nothing opens it before the start, and a go-live there
   * starts it from the service (CD37).
   */
  @Synchronized
  fun ready(camera: Boolean): Boolean = camera && !failed

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

  /**
   * Whether the device reports [id] held by another app (C6, T36). StreamPack (3.2.0 and 3.2.1,
   * javap) turns `StateCallback.onError`'s busy codes into a message-only `CameraException`, so the capture asks
   * this when an open fails with no Camera2 reason that [busy] reads.
   */
  @Synchronized
  fun contended(id: String): Boolean = id in contended

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
    // android-36's android.jar.
    /** `CameraAccessException.CAMERA_IN_USE`. */
    private const val CAMERA_IN_USE = 4

    /** `CameraAccessException.MAX_CAMERAS_IN_USE`. */
    private const val MAX_CAMERAS_IN_USE = 5

    /**
     * I4: a `CameraAccessException` reason that means another app holds the camera. A disconnect
     * (2) is not: it is also how a camera service restart looks, and F-P5-9's events already
     * report another app's take. A busy camera reported through `StateCallback.onError` is not
     * classified here: StreamPack 3.2.1 turns its code into a message-only `CameraException`, so
     * Task 36 carries that path (review 18 I2).
     */
    fun busy(reason: Int?): Boolean = reason == CAMERA_IN_USE || reason == MAX_CAMERAS_IN_USE
  }
}
