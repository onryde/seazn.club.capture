package com.seazn.capture.engine.adapter

import com.seazn.capture.engine.core.Input
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class CameraAvailabilityTest {
  // "session" is Camera2's capture session: ours is open from the viewfinder or a held broadcast on.
  private val cameras = CameraAvailability().apply { held("0"); sessionStarted() }

  @Test
  fun `F-P5-9 another app opening another camera while we hold ours is contention`() {
    assertEquals(Input.CameraContended, cameras.unavailable("1", 5_000))
    assertEquals(null, cameras.unavailable("2", 5_100), "already contended: one report")
  }

  @Test
  fun `F-P5-10 the last camera released while contended is a release, and our own reopen is not another app`() {
    cameras.unavailable("1", 5_000)
    cameras.unavailable("2", 5_000)
    assertEquals(null, cameras.available("1", 6_000))
    assertEquals(Input.CameraReleased, cameras.available("2", 6_100))
    assertEquals(null, cameras.unavailable("0", 7_000), "our own id is never another app")
  }

  @Test
  fun `our own switch's events inside its window are ignored`() {
    cameras.selfChange(10_000)
    assertEquals(null, cameras.unavailable("1", 10_400))
    cameras.held("1")
    assertEquals(Input.CameraContended, cameras.unavailable("0", 12_000), "after the window, the old camera taken by another app is contention")
  }

  @Test
  fun `a second unavailable inside the self window is ignored too, and the window ends at its edge`() {
    cameras.selfChange(10_000)
    assertEquals(null, cameras.unavailable("1", 10_400))
    assertEquals(null, cameras.unavailable("2", 11_499), "the last millisecond of the 1.5 s window")
    assertEquals(Input.CameraContended, cameras.unavailable("3", 11_500), "the window is over")
  }

  @Test
  fun `holding no camera, our old camera taken by another app is contention`() {
    cameras.held(null)
    assertEquals(Input.CameraContended, cameras.unavailable("0", 6_000), "0 is no longer ours")
  }

  @Test
  fun `a release nothing was contended for is no report`() {
    // Our old camera freed by our own switch: never in the set, so nothing empties.
    assertEquals(null, cameras.available("0", 5_000))
    assertEquals(null, cameras.available("1", 5_100))
  }

  @Test
  fun `no session, no report, and a session starting while contended is told so`() {
    val idle = CameraAvailability().apply { held("0") }
    assertEquals(null, idle.unavailable("1", 1_000))
    assertEquals(Input.CameraContended, idle.sessionStarted())
    idle.sessionEnded()
    assertEquals(null, idle.available("1", 2_000))
  }

  @Test
  fun `a camera still taken across a closed viewfinder is still contended at the next open`() {
    assertEquals(Input.CameraContended, cameras.unavailable("1", 5_000))
    cameras.sessionEnded()
    assertEquals(Input.CameraContended, cameras.sessionStarted(), "the set is the device's truth, kept while ours is closed")
    assertEquals(Input.CameraReleased, cameras.available("1", 6_000))
  }

  @Test
  fun `I4 a camera in use, or too many cameras in use, is contention - any other open failure is not`() {
    // javap -constants, android-36: CameraAccessException 1 disabled, 2 disconnected, 3 error, 4 in use, 5 max in use.
    assertTrue(CameraAvailability.busy(4))
    assertTrue(CameraAvailability.busy(5))
    for (reason in listOf(1, 2, 3, null)) assertFalse(CameraAvailability.busy(reason), "$reason")
  }

  @Test
  fun `I4 an open that failed on a busy camera hears its release, though we hold nothing`() {
    val failed = CameraAvailability()
    failed.waiting("0")
    assertEquals(Input.CameraReleased, failed.available("0", 3_000))
    failed.held("0")
    assertEquals(null, failed.sessionStarted(), "rebuilt on the released camera: nothing contended")
  }

  @Test
  fun `I4 an open that succeeds before the release is heard holds the camera, and the wait is told over`() {
    val failed = CameraAvailability()
    failed.waiting("0")
    failed.held("0") // a retry opened it: the other app let go, its callback not yet here
    assertEquals(Input.CameraReleased, failed.sessionStarted(), "ours now, so no longer taken")
    assertEquals(null, failed.available("0", 3_200), "the late release of our own camera is nothing")
  }

  @Test
  fun `I4 a camera we held before is not ours while we wait for it, so another take of it is heard`() {
    cameras.sessionEnded() // the viewfinder closed on camera 0
    cameras.waiting("0") // and its next open failed: another app holds 0
    assertEquals(Input.CameraReleased, cameras.available("0", 3_000))
    assertEquals(Input.CameraContended, cameras.unavailable("0", 3_200), "taken again before our reopen: not our own camera")
  }

  @Test
  fun `I3 a camera released while ours was closed is told at the next open, so the pairing's camera never stays taken`() {
    cameras.unavailable("1", 5_000)
    cameras.sessionEnded() // the viewfinder hidden while taken
    assertEquals(null, cameras.available("1", 6_000), "closed: nothing reported")
    assertEquals(Input.CameraReleased, cameras.sessionStarted())
    assertEquals(null, cameras.sessionStarted(), "told once")
  }

  // --- Review C7 I-2: StreamPack 3.2.1 opens the camera lazily, so a build holds nothing until the open is seen ---

  @Test
  fun `I-2 a camera taken before the build stays taken through it, and our open seen tells it over, once`() {
    val fresh = CameraAvailability()
    assertEquals(null, fresh.unavailable("0", 1_000), "no session yet: heard, not told")
    fresh.opening("0") // the build: StreamPack has not opened it
    assertEquals(Input.CameraContended, fresh.sessionStarted(), "the take heard before the build stands")
    assertTrue(fresh.contended("0"), "the build erased nothing")
    assertEquals(null, fresh.unavailable("0", 1_200), "our own camera's events are ours")
    assertEquals(null, fresh.opened("1"), "another camera's open is not ours")
    assertTrue(fresh.contended("0"))
    assertEquals(Input.CameraReleased, fresh.opened("0"), "the open seen: ours now, and the take is told over")
    assertFalse(fresh.contended("0"))
    assertEquals(null, fresh.opened("0"), "told once")
    assertEquals(null, fresh.unavailable("0", 9_000), "ours, so never another app's")
  }

  @Test
  fun `I-2 another app's release before our open is told, and the open after it is nothing more`() {
    val fresh = CameraAvailability()
    fresh.unavailable("0", 1_000)
    fresh.opening("0")
    assertEquals(Input.CameraContended, fresh.sessionStarted())
    assertEquals(Input.CameraReleased, fresh.available("0", 2_000), "the holder let go before our open")
    assertEquals(null, fresh.opened("0"), "nothing taken is left to tell")
  }

  @Test
  fun `I-2 a build with nothing taken tells nothing, at the build or the open`() {
    val fresh = CameraAvailability()
    fresh.opening("0")
    assertEquals(null, fresh.sessionStarted())
    assertEquals(null, fresh.opened("0"))
    assertTrue(fresh.ready(camera = true))
  }

  @Test
  fun `I-2 the open of a source we moved off is nothing, and the new one's is ours`() {
    val fresh = CameraAvailability()
    fresh.unavailable("1", 1_000)
    fresh.opening("0")
    assertEquals(Input.CameraContended, fresh.sessionStarted())
    fresh.opening("1") // the switch, before camera 0's open was seen
    assertEquals(null, fresh.opened("0"), "camera 0's late open: superseded")
    assertTrue(fresh.contended("1"))
    assertEquals(Input.CameraReleased, fresh.opened("1"))
  }

  @Test
  fun `I-2 after the release no open is ours, and the next build starts again`() {
    val fresh = CameraAvailability()
    fresh.opening("0")
    fresh.sessionStarted()
    fresh.held(null) // the release
    fresh.sessionEnded()
    fresh.unavailable("0", 3_000) // another app takes it while ours is closed
    assertEquals(null, fresh.opened("0"), "a late open after the release is nothing")
    assertTrue(fresh.contended("0"))
    fresh.opening("0")
    assertEquals(Input.CameraContended, fresh.sessionStarted(), "the next build is told")
  }

  @Test
  fun `I-2 the camera reads ready while the source is a camera and no open of it failed since it was asked`() {
    val fresh = CameraAvailability()
    assertTrue(fresh.ready(camera = true), "nothing asked yet: a locked go-live's start opens it (CD37)")
    assertFalse(fresh.ready(camera = false), "the slate is no camera")
    fresh.opening("0")
    fresh.sessionStarted()
    assertTrue(fresh.ready(camera = true), "asked, not answered")
    assertEquals(null, fresh.openFailed("0", busy = false), "a failure that is no other app's tells nothing")
    assertFalse(fresh.ready(camera = true), "the open failed")
    assertEquals(null, fresh.opened("1"), "another camera's open clears nothing")
    assertFalse(fresh.ready(camera = true))
    fresh.opening("0") // a reopen
    assertTrue(fresh.ready(camera = true), "a new open is asked")
    fresh.openFailed("0", busy = false)
    fresh.opened("0")
    assertTrue(fresh.ready(camera = true), "an open seen clears the failure")
  }

  @Test
  fun `I-2 an open failed on a busy camera is contention, once, and its release is told`() {
    val fresh = CameraAvailability()
    fresh.opening("0")
    assertEquals(null, fresh.sessionStarted())
    assertEquals(null, fresh.openFailed("1", busy = true), "not the camera we are opening")
    assertFalse(fresh.contended("1"))
    assertEquals(Input.CameraContended, fresh.openFailed("0", busy = true), "another app outranks us")
    assertTrue(fresh.contended("0"))
    assertEquals(null, fresh.openFailed("0", busy = true), "told once")
    assertFalse(fresh.ready(camera = true))
    assertEquals(null, fresh.unavailable("0", 2_000), "the holder's events of our camera are no news")
    assertEquals(Input.CameraReleased, fresh.available("0", 3_000), "the holder let go: the engine reopens")
    fresh.opening("0")
    assertTrue(fresh.ready(camera = true))
  }

  @Test
  fun `I-2 a busy open failure while another camera is already taken tells nothing new`() {
    val fresh = CameraAvailability()
    fresh.unavailable("1", 1_000)
    fresh.opening("0")
    assertEquals(Input.CameraContended, fresh.sessionStarted())
    assertEquals(null, fresh.openFailed("0", busy = true), "already told")
    assertEquals(null, fresh.available("1", 2_000), "camera 0 still taken")
    assertEquals(Input.CameraReleased, fresh.available("0", 2_100))
  }

  /**
   * C6 (T36): StreamPack 3.2.1 (as 3.2.0, javap) turns `StateCallback.onError`'s busy codes into a message-only
   * `CameraException`, so a failed open asks the device's own availability whether another app holds it.
   */
  @Test
  fun `C6 a camera is contended while another app holds it, never while it is ours, and not after its release`() {
    val fresh = CameraAvailability()
    assertFalse(fresh.contended("1"), "nothing heard: not contended")
    fresh.unavailable("1", 1_000) // another app opened camera 1 while ours was closed
    assertTrue(fresh.contended("1"))
    assertFalse(fresh.contended("0"), "another camera is not contended")
    fresh.available("1", 2_000)
    assertFalse(fresh.contended("1"), "released")
    fresh.unavailable("1", 3_000)
    fresh.held("1") // and then our own open of it succeeded
    assertFalse(fresh.contended("1"), "ours is never contended")
    fresh.held(null)
    fresh.selfChange(4_000)
    fresh.unavailable("1", 4_500) // our own reopen's event, inside the window
    assertFalse(fresh.contended("1"), "our own change is never another app's take")
  }
}
