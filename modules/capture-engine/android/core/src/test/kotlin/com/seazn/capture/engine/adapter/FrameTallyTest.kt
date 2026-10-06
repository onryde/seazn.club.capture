package com.seazn.capture.engine.adapter

import kotlin.test.Test
import kotlin.test.assertEquals

class FrameTallyTest {
  @Test
  fun `F-P5-4 only encoded frames that reached the endpoint count, video apart from audio`() {
    val tally = FrameTally()
    tally.begin(3)
    repeat(30) { tally.counted("video/avc", 4_000) }
    repeat(47) { tally.counted("audio/mp4a-latm", 300) }
    tally.counted(null, 10)
    assertEquals(FrameCount(30, 47), tally.read(3))
    assertEquals(30L * 4_000 + 47 * 300 + 10, tally.bytes(3))
  }

  @Test
  fun `a new attempt starts from zero, and an old attempt reads nothing`() {
    val tally = FrameTally()
    tally.begin(1)
    tally.counted("video/avc", 1)
    tally.begin(2)
    assertEquals(FrameCount(0, 0), tally.read(2))
    assertEquals(null, tally.read(1))
  }

  @Test
  fun `before any attempt nothing is counted, and an old attempt's bytes read nothing`() {
    val tally = FrameTally()
    tally.counted("video/avc", 500) // no attempt yet: dropped, not thrown
    assertEquals(null, tally.read(1))
    assertEquals(null, tally.bytes(1))
    tally.begin(1)
    tally.counted("video/avc", 7)
    assertEquals(FrameCount(1, 0), tally.read(1), "the frame before the attempt is in no attempt")
    tally.begin(2)
    assertEquals(null, tally.bytes(1))
    assertEquals(0L, tally.bytes(2))
  }
}
