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
 * - Device session 4, F-S4-1: StreamPack's word that ours was lost ([lost]) reads as a failed open does: not
 *   ready until a new open is asked (the capture builds it afresh) or one is seen.
 * - N45: on air the capture tells a loss or a busy open of ours as a take ([taken]). Our own camera's available is
 *   no release of that take (our eviction says it too, review I1); a probe that opens our camera is ([probed]), and
 *   ends any take. After a busy word our open reports are no open until a new open is asked ([busyOpen]).
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

  /** I-2: the open of [ours] failed, or it was [lost], since it was asked; a new open asked, or one seen, clears it. */
  private var failed = false

  /** N45 I2: StreamPack logged the open of [ours] failed busy since it was asked ([busyOpen]); only a new open asked clears it. */
  private var busySinceOpening = false

  /** N45 I1: the take told is the capture's own, of [ours] ([taken]): its available is no release. A new open asked, or the release, ends it. */
  private var ownTake = false

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
    busySinceOpening = false
    ownTake = false
  }

  /**
   * I-2: StreamPack reports [id]'s source open (previewing or streaming): ours, so no longer contended, and
   * a take told that this clears is told over. The open of a source we have moved off is nothing. N45 I2: nor is
   * one whose open StreamPack logged busy since it was asked ([busyOpen]): 3.2.1 can report such a source open all
   * the same (javap, re-review R2-M3: `CameraSource.startPreview` and `startStream` both report it once
   * `CameraController.addTarget` returns, and `addTarget` swallows a failure of its session, not of the device's own
   * open; which busy failures come at which stage is device-only), and read after the busy word's take it told the take
   * over, so the machine reopened a camera another app held and reconnected twice in 10 s (review, probe A).
   */
  @Synchronized
  fun opened(id: String): Input? {
    if (id != ours || busySinceOpening) return null
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
   * F-S4-1: StreamPack reports [id] lost: Camera2 disconnected it, or put it in a device error (`CameraUtils`' own
   * lines, read by `VendorLines`), or a start failed on it. Ours reads not ready until a new open is asked or one
   * is seen. True when it was ours. No other app's take: its busy open says so, if it is one.
   */
  @Synchronized
  fun lost(id: String): Boolean {
    if (id != ours) return false
    failed = true
    return true
  }

  /**
   * N45 (device check 2026-11-17): another app took [id], ours, while a broadcast holds it. An app that opens OUR
   * camera evicts us, and Camera2 says so only as our device's disconnect, while its availability events for our id
   * read as ours ([unavailable]); and StreamPack keeps a busy open of it to itself where it swallows the open's
   * failure. So the capture, which knows a broadcast is held, tells it here: not ready, contended, told once, and a
   * probe that opens it ([probed]) is told as its release, so the engine reopens it. Null when [id] is not ours, or
   * already told.
   */
  @Synchronized
  fun taken(id: String): Input? {
    val told = openFailed(id, busy = true)
    if (id == ours) ownTake = true
    return told
  }

  /**
   * N45 I2: StreamPack logged an open of [id] failed busy (its `CameraUtils` error 1 or 2, read by `VendorLines`). Ours:
   * its open reports are no open until a new open is asked ([opening]). Marked as the word is heard, before its take
   * is queued, so a report read after the take always finds it.
   */
  @Synchronized
  fun busyOpen(id: String) {
    if (id == ours) busySinceOpening = true
  }

  /**
   * Review R1-I2: the broadcast ended, and the busy mark with it (the capture marks only while a broadcast is held). A
   * take whose camera source stayed in asks no new open at the stop, so without this the preview's open after it stayed
   * no open, and Go live with it. Re-review R2-M3: not because the preview reports no failed open; javap has the preview
   * and the stream report alike (see [opened]). Off air a false open costs at most a start that meets busy, which is
   * probed ([busyAtStart]), where a mark that outlived the broadcast left the camera taken with nothing to clear it.
   */
  @Synchronized
  fun offAir() {
    busySinceOpening = false
  }

  /**
   * N45 I1: a probe opened [id], ours, while a take of it is told: nothing holds it from us, whichever camera the
   * other app held (a hidden id: the device check's error 2). Review R1-C1: only ours is freed. Another app's take of
   * another camera (F-P5-9, a call on camera 1) keeps its own release, which reopens ours (F-P5-10's measured remedy),
   * so the take is told over only when nothing else is contended. Null when [id] is not ours, no take is told, or
   * another camera is still held.
   */
  @Synchronized
  fun probed(id: String): Input? {
    if (id != ours || !told) return null
    contended.remove(id)
    return if (contended.isEmpty()) releasedTold() else null
  }

  /**
   * N45 I1: a take of OUR camera is told and not yet told over: the capture probes it while the slate is up. Review
   * R1-C1: another app's take of another camera is never probed: its release is the end of it.
   */
  @Synchronized
  fun oursTaken(): Boolean = told && ours?.let { it in contended } == true

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
    // N45 I1: our eviction makes ours available too, before or after its take, while the other app still holds it
    // (review I1, I2), and a holder on a conflicting id may never make ours change again: the probe decides.
    if (ownTake && id == ours) return null
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
   * Re-review R2-I1: the held streamer's start found [id], ours, busy (C7). Waited for as an open is ([waiting]: the
   * holder's available is its release), but the streamer still holds our camera's source, so [id] stays ours: the
   * take is probed while the slate stands for it ([oursTaken], [probed]), since a holder on a hidden id (error 2)
   * sends no available for ours. A build's busy failure holds nothing, and stays [waiting]'s.
   */
  @Synchronized
  fun busyAtStart(id: String) {
    waiting(id)
    ours = id
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
    ownTake = false
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
