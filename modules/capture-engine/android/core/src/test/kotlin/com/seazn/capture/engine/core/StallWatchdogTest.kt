package com.seazn.capture.engine.core

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertIs
import kotlin.test.assertNull
import kotlin.test.assertTrue

class StallWatchdogTest {
  /** A reading every 500 ms with the given increments; ticks after each one. Returns the first rebuild or held verdict. */
  private class Drive(var dog: StallWatchdog = StallWatchdog(startedAtMs = 0), val micSilenced: Boolean = false) {
    var video = 0L
    var audio = 0L
    var t = 0L
    val verdicts = mutableListOf<Pair<Long, StallVerdict>>()

    fun step(videoAdd: Long, audioAdd: Long, cameraTaken: Boolean = false) {
      t += 500
      video += videoAdd
      audio += audioAdd
      val (afterFrames, frameVerdict) = dog.frames(video, audio, t, cameraTaken, micSilenced)
      val (afterTick, tickVerdict) = afterFrames.tick(t, cameraTaken)
      dog = afterTick
      for (verdict in listOf(frameVerdict, tickVerdict)) if (verdict != StallVerdict.None) verdicts += t to verdict
    }

    fun steps(count: Int, videoAdd: Long, audioAdd: Long, cameraTaken: Boolean = false) =
      repeat(count) { step(videoAdd, audioAdd, cameraTaken) }
  }

  private fun healthy(mic: Boolean = false): Drive =
    Drive(micSilenced = mic).apply { dog = dog.frames(0, 0, 0, false, mic).first; steps(10, 15, 23) }

  @Test
  fun `F-P5-6 no video frame for 3 s is a rebuild, while audio still flows`() {
    val drive = healthy()
    drive.steps(5, 0, 23)
    assertTrue(drive.verdicts.isEmpty(), "2.5 s without video is not yet a stall")
    drive.step(0, 23)
    val (at, verdict) = drive.verdicts.single()
    assertEquals(8_000L, at)
    assertIs<StallVerdict.Rebuild>(verdict)
    assertEquals(StallCause.NO_VIDEO, verdict.cause)
    assertEquals(3_000L, verdict.msSinceAdvance)
  }

  @Test
  fun `F-P5-6 the first frame gets a 5 s grace`() {
    val dog = StallWatchdog(startedAtMs = 0)
    assertEquals(StallVerdict.None, dog.tick(4_999, cameraTaken = false).second)
    val verdict = dog.tick(5_000, cameraTaken = false).second
    assertIs<StallVerdict.Rebuild>(verdict)
    assertEquals(StallCause.NO_FIRST_FRAME, verdict.cause)
  }

  @Test
  fun `F-P5-9 a slideshow above zero is a rebuild - 8 fps`() {
    val drive = Drive().apply { dog = dog.frames(0, 0, 0, false, false).first }
    drive.steps(7, 4, 23)
    val (at, verdict) = drive.verdicts.single()
    assertEquals(3_500L, at, "the first full window after the first frame")
    assertIs<StallVerdict.Rebuild>(verdict)
    assertEquals(StallCause.BELOW_FLOOR, verdict.cause)
    assertEquals(8.0, verdict.videoFps)
  }

  @Test
  fun `F-P5-4 audio at a seventh of its rate is a rebuild though video runs 30 fps`() {
    // F-P5-4: 6.36 audio packets/s against the full AAC rate of 46.88.
    val drive = Drive().apply { dog = dog.frames(0, 0, 0, false, false).first }
    drive.steps(7, 15, 3)
    val (at, verdict) = drive.verdicts.single()
    assertEquals(3_500L, at)
    assertIs<StallVerdict.Rebuild>(verdict)
    assertEquals(6.0, verdict.audioFps)
    assertEquals(30.0, verdict.videoFps)
  }

  @Test
  fun `F-P5-8 while the mic is silenced no rate floor is judged, and a frozen picture still rebuilds`() {
    // P5, a phone call answered on 2026-09-28 evening: "delivery-starved videoFps=9.7 audioFps=15.2", the
    // mic silenced by the system. Readings 2 s apart make a 4 s window: 39 video and 61 audio frames are
    // 9.75 and 15.25 a second, shown as 9.7 and 15.2.
    fun dip(micSilenced: Boolean): Pair<StallWatchdog, StallVerdict> {
      var dog = StallWatchdog(startedAtMs = 0).frames(0, 0, 0, false, micSilenced).first
      dog = dog.frames(15, 23, 500, false, micSilenced).first
      dog = dog.frames(35, 53, 2_500, false, micSilenced).first
      return dog.frames(15 + 39, 23 + 61, 4_500, false, micSilenced)
    }
    val (silenced, verdict) = dip(micSilenced = true)
    assertEquals(StallVerdict.None, verdict)
    assertEquals(9.7, silenced.videoFps, "Diagnostics still shows the rates")
    assertEquals(15.2, silenced.audioFps)
    assertEquals(StallVerdict.Rebuild(StallCause.BELOW_FLOOR, 0, 9.7, 15.2), dip(micSilenced = false).second)
    // The zero test is not a rate floor: a picture that stops dead is rebuilt, mic or no mic.
    val frozen = healthy(mic = true)
    frozen.steps(6, 0, 23)
    val rebuild = StallVerdict.Rebuild(StallCause.NO_VIDEO, 3_000, 30.0, 46.0)
    assertEquals(listOf<Pair<Long, StallVerdict>>(8_000L to rebuild), frozen.verdicts)
  }

  @Test
  fun `F-P5-9 a short dip that averages above the floors is not a rebuild`() {
    // Video: P5's browser run, "30 fps apart from one second at 12 fps". Audio: a dip to 15 and 18
    // frames/s, chosen here. The worst 3 s windows hold 72 video and 80 audio frames: 24.0 and 26.6 a second.
    val drive = Drive().apply { dog = dog.frames(0, 0, 0, false, false).first }
    val video = listOf(15L, 15, 15, 6, 6, 15, 15, 15, 15, 15, 15, 15)
    val audio = listOf(23L, 23, 24, 7, 8, 9, 9, 23, 24, 23, 24, 23)
    video.zip(audio).forEach { (v, a) -> drive.step(v, a) }
    assertTrue(drive.verdicts.isEmpty(), "got ${drive.verdicts}")
  }

  @Test
  fun `exactly 10 video fps and 20 audio frames a second is not starved`() {
    val drive = Drive().apply { dog = dog.frames(0, 0, 0, false, false).first }
    drive.steps(12, 5, 10)
    assertTrue(drive.verdicts.isEmpty(), "got ${drive.verdicts}")
    assertEquals(10.0, drive.dog.videoFps)
    assertEquals(20.0, drive.dog.audioFps)
  }

  @Test
  fun `F-P5-10 while the camera is taken it holds and never rebuilds`() {
    val drive = healthy()
    drive.steps(20, 0, 23, cameraTaken = true)
    assertTrue(drive.verdicts.isNotEmpty())
    assertTrue(drive.verdicts.all { it.second == StallVerdict.Held }, "got ${drive.verdicts}")
  }

  @Test
  fun `F-P5-10 a camera held with video stopped shows no rates`() {
    // Held from 3 s after the last frame. The 30.0 and 46.0 from before are not a rate of a camera
    // that is sending nothing, so Diagnostics must not show them, as it does not for a slate.
    val drive = healthy()
    drive.steps(6, 0, 23, cameraTaken = true)
    assertEquals(listOf<Pair<Long, StallVerdict>>(8_000L to StallVerdict.Held), drive.verdicts)
    assertNull(drive.dog.videoFps)
    assertNull(drive.dog.audioFps)
  }

  @Test
  fun `F-P5-10 a slate at a low rate is not judged while the camera is taken`() {
    val drive = healthy()
    drive.steps(12, 1, 23, cameraTaken = true)
    assertTrue(drive.verdicts.isEmpty(), "got ${drive.verdicts}")
  }

  @Test
  fun `F-P5-10 after our reopen the camera gets a full stall window`() {
    val drive = healthy()
    drive.steps(20, 0, 23, cameraTaken = true)
    drive.verdicts.clear()
    drive.dog = drive.dog.rebaselined(drive.t)
    drive.steps(5, 0, 23)
    assertTrue(drive.verdicts.isEmpty(), "2.5 s after the reopen is inside the window")
    drive.steps(2, 15, 23)
    assertTrue(drive.verdicts.isEmpty())
  }

  @Test
  fun `a counter that goes backwards is a fresh baseline, not an advance`() {
    val drive = healthy()
    val (dog, verdict) = drive.dog.frames(3, 5, drive.t + 500, cameraTaken = false, micSilenced = false)
    assertEquals(StallVerdict.None, verdict)
    assertEquals(3L, dog.lastVideo)
    assertEquals(drive.dog.lastAdvanceAtMs, dog.lastAdvanceAtMs)
  }

  @Test
  fun `the LIVE gate - advancing only within 3 s of the last frame`() {
    val drive = healthy()
    val last = drive.dog.lastAdvanceAtMs!!
    assertTrue(drive.dog.advancing(last + 2_999))
    assertFalse(drive.dog.advancing(last + 3_000))
    assertFalse(StallWatchdog(startedAtMs = 0).advancing(0))
  }

  @Test
  fun `F-P5-6 the LIVE gate - a reopen is not a frame`() {
    val reopened = StallWatchdog(startedAtMs = 0).rebaselined(1_000)
    assertFalse(reopened.advancing(1_000))
    val baseline = reopened.frames(40, 60, 1_500, false, false).first
    assertFalse(baseline.advancing(1_500), "the first reading after a reopen is a baseline")
    // The reopened camera still gets its full 3 s, counted from the reopen.
    assertEquals(StallVerdict.None, baseline.tick(3_999, cameraTaken = false).second)
    assertEquals(StallVerdict.Rebuild(StallCause.NO_VIDEO, 3_000, null, null), baseline.tick(4_000, cameraTaken = false).second)
    // A count that grew across the reopen is a baseline too, not a frame.
    val drive = healthy()
    val after = drive.dog.rebaselined(drive.t).frames(drive.video + 15, drive.audio + 23, drive.t + 500, false, false).first
    assertFalse(after.advancing(drive.t + 500))
  }

  @Test
  fun `the rates shown are the window's, truncated to one decimal`() {
    // Audio 23, 23, 24 frames a half second: every 3 s window holds 140 frames, 46.67 a second.
    // Truncated, that shows 46.6; rounded, it would show 46.7.
    val drive = Drive().apply { dog = dog.frames(0, 0, 0, false, false).first }
    repeat(4) {
      drive.step(15, 23)
      drive.step(15, 23)
      drive.step(15, 24)
    }
    assertEquals(30.0, drive.dog.videoFps)
    assertEquals(46.6, drive.dog.audioFps)
  }

  // Each test below pins a guard that a mutation of the code above showed no other test kills.

  @Test
  fun `F-P5-4 a slideshow after healthy video is caught within one window`() {
    // F-P5-4: 30.02 fps for 20 minutes, then 3.2–9.1 fps. At 4 frames a half second: 2.5 s in, the
    // window still holds one healthy half second (35 frames, 11.6 a second); 3 s in it holds 24 (8.0).
    val drive = healthy()
    drive.steps(5, 4, 23)
    assertTrue(drive.verdicts.isEmpty(), "got ${drive.verdicts}")
    drive.step(4, 23)
    val (at, verdict) = drive.verdicts.single()
    assertEquals(8_000L, at)
    assertIs<StallVerdict.Rebuild>(verdict)
    assertEquals(8.0, verdict.videoFps)
  }

  @Test
  fun `F-P5-6 a first frame late inside its grace is judged from its own arrival`() {
    // No frame for 4 s, then 30 fps. Readings from the wait would make the window at 4.5 s one frame
    // step in 3 s: 5 fps.
    val drive = Drive().apply { dog = dog.frames(0, 0, 0, false, false).first }
    drive.steps(8, 0, 23)
    drive.steps(8, 15, 23)
    assertTrue(drive.verdicts.isEmpty(), "got ${drive.verdicts}")
    assertEquals(30.0, drive.dog.videoFps)
  }

  @Test
  fun `the window is the last 3 s, a pause inside it included`() {
    // 1.5 s without video, then 15 frames a half second. The 3 s ending at the fourth step after the
    // pause hold those four steps: 60 / 3 = 20.0. Stretched back to the last frame before the pause,
    // it would read 60 / 3.5 = 17.1.
    val drive = healthy()
    drive.steps(3, 0, 23)
    drive.steps(4, 15, 23)
    assertTrue(drive.verdicts.isEmpty(), "got ${drive.verdicts}")
    assertEquals(20.0, drive.dog.videoFps)
  }

  @Test
  fun `after a counter goes backwards the window starts again`() {
    // The encoder's counters restart. Readings kept from before would give the window 1 s later a
    // base of 90 frames against a count of 30: −20 fps.
    val drive = healthy()
    drive.video = 0
    drive.audio = 0
    drive.steps(8, 15, 23)
    assertTrue(drive.verdicts.isEmpty(), "got ${drive.verdicts}")
    assertEquals(30.0, drive.dog.videoFps)
  }

  @Test
  fun `an audio counter that goes backwards restarts the window, and the video advance still counts`() {
    // The audio encoder restarts on its own. Against the window's base of 115 audio frames, a count
    // of 23 would read (23 - 115) / 3 = −30.7 a second: a rebuild of a healthy pipeline.
    val drive = healthy()
    drive.audio = 0
    drive.step(15, 23)
    assertEquals(drive.t, drive.dog.lastAdvanceAtMs, "15 new video frames are still a frame")
    drive.steps(7, 15, 23)
    assertTrue(drive.verdicts.isEmpty(), "got ${drive.verdicts}")
    assertEquals(46.0, drive.dog.audioFps)
  }

  @Test
  fun `an audio counter that goes backwards on a reading with no new frame restarts the window too`() {
    val drive = healthy()
    drive.audio = 0
    drive.step(0, 23)
    drive.steps(7, 15, 23)
    assertTrue(drive.verdicts.isEmpty(), "got ${drive.verdicts}")
    assertEquals(46.0, drive.dog.audioFps)
  }

  @Test
  fun `F-P5-4 audio that stops dead while video runs is caught within one window`() {
    // A flat audio count is not a restart. From 5 s: windows from 2.5, 3, 3.5 and 4 s end at 230
    // audio frames against bases of 115, 138, 161 and 184, which is 38.3, 30.6, 23.0, then 15.3.
    val drive = healthy()
    drive.steps(4, 15, 0)
    val rebuild = StallVerdict.Rebuild(StallCause.BELOW_FLOOR, 0, 30.0, 15.3)
    assertEquals(listOf<Pair<Long, StallVerdict>>(7_000L to rebuild), drive.verdicts)
  }

  @Test
  fun `F-P5-10 a camera back on its own is judged from its return`() {
    // A slate at 2 frames a second while taken, then the camera again at 30 fps with no reopen.
    val slate = healthy()
    slate.steps(12, 1, 23, cameraTaken = true)
    assertNull(slate.dog.videoFps, "a taken camera's slate has no rate")
    slate.steps(7, 15, 23)
    assertTrue(slate.verdicts.isEmpty(), "got ${slate.verdicts}")
    assertEquals(30.0, slate.dog.videoFps)
    // Video stopped while taken (held), then the camera again at 30 fps with no reopen.
    val stopped = healthy()
    stopped.steps(12, 0, 23, cameraTaken = true)
    stopped.verdicts.clear()
    stopped.steps(7, 15, 23)
    assertTrue(stopped.verdicts.isEmpty(), "got ${stopped.verdicts}")
    assertEquals(30.0, stopped.dog.videoFps)
  }

  @Test
  fun `F-P5-10 after our reopen the old rates are gone and the window starts at the first frame`() {
    // The camera is taken for 2 s with video stopped, not yet held, so the old window's rates still show.
    val drive = healthy()
    drive.steps(4, 0, 23, cameraTaken = true)
    assertEquals(30.0, drive.dog.videoFps)
    drive.dog = drive.dog.rebaselined(drive.t)
    assertNull(drive.dog.videoFps)
    assertNull(drive.dog.audioFps)
    // No frame for 2 s after the reopen, then 9 frames a half second from 2.5 s. The first window is
    // judged 3 s after that first frame, at 5.5 s: six steps of 9, 54 / 3 = 18.0. Readings from the
    // wait would start the window 1 s after the reopen and judge it at 4 s: 36 / 3 = 12.0.
    drive.steps(4, 0, 23)
    drive.steps(6, 9, 23)
    assertNull(drive.dog.videoFps, "5 s after the reopen, no window is full yet")
    drive.step(9, 23)
    assertTrue(drive.verdicts.isEmpty(), "got ${drive.verdicts}")
    assertEquals(18.0, drive.dog.videoFps)
  }
}
