package com.seazn.capture.engine.core

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertIs
import kotlin.test.assertTrue

class StallWatchdogTest {
  /** A reading every 500 ms with the given increments; ticks after each one. Returns the first rebuild or held verdict. */
  private class Drive(var dog: StallWatchdog = StallWatchdog(startedAtMs = 0)) {
    var video = 0L
    var audio = 0L
    var t = 0L
    val verdicts = mutableListOf<Pair<Long, StallVerdict>>()

    fun step(videoAdd: Long, audioAdd: Long, cameraTaken: Boolean = false) {
      t += 500
      video += videoAdd
      audio += audioAdd
      val (afterFrames, frameVerdict) = dog.frames(video, audio, t, cameraTaken)
      val (afterTick, tickVerdict) = afterFrames.tick(t, cameraTaken)
      dog = afterTick
      for (verdict in listOf(frameVerdict, tickVerdict)) if (verdict != StallVerdict.None) verdicts += t to verdict
    }

    fun steps(count: Int, videoAdd: Long, audioAdd: Long, cameraTaken: Boolean = false) =
      repeat(count) { step(videoAdd, audioAdd, cameraTaken) }
  }

  private fun healthy(): Drive = Drive().apply { dog = dog.frames(0, 0, 0, false).first; steps(10, 15, 23) }

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
    val drive = Drive().apply { dog = dog.frames(0, 0, 0, false).first }
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
    val drive = Drive().apply { dog = dog.frames(0, 0, 0, false).first }
    drive.steps(7, 15, 3)
    val (at, verdict) = drive.verdicts.single()
    assertEquals(3_500L, at)
    assertIs<StallVerdict.Rebuild>(verdict)
    assertEquals(6.0, verdict.audioFps)
    assertEquals(30.0, verdict.videoFps)
  }

  @Test
  fun `F-P5-9 a short dip that averages above the floors is not a rebuild`() {
    // Video: P5's browser run, "30 fps apart from one second at 12 fps". Audio: a dip to 15 and 18
    // frames/s, chosen here. The worst 3 s windows hold 72 video and 80 audio frames: 24.0 and 26.6 a second.
    val drive = Drive().apply { dog = dog.frames(0, 0, 0, false).first }
    val video = listOf(15L, 15, 15, 6, 6, 15, 15, 15, 15, 15, 15, 15)
    val audio = listOf(23L, 23, 24, 7, 8, 9, 9, 23, 24, 23, 24, 23)
    video.zip(audio).forEach { (v, a) -> drive.step(v, a) }
    assertTrue(drive.verdicts.isEmpty(), "got ${drive.verdicts}")
  }

  @Test
  fun `exactly 10 video fps and 20 audio frames a second is not starved`() {
    val drive = Drive().apply { dog = dog.frames(0, 0, 0, false).first }
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
    val (dog, verdict) = drive.dog.frames(3, 5, drive.t + 500, cameraTaken = false)
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
  fun `the rates shown are the window's, truncated to one decimal`() {
    // Audio 23, 23, 24 frames a half second: every 3 s window holds 140 frames, 46.67 a second.
    // Truncated, that shows 46.6; rounded, it would show 46.7.
    val drive = Drive().apply { dog = dog.frames(0, 0, 0, false).first }
    repeat(4) {
      drive.step(15, 23)
      drive.step(15, 23)
      drive.step(15, 24)
    }
    assertEquals(30.0, drive.dog.videoFps)
    assertEquals(46.6, drive.dog.audioFps)
  }
}
