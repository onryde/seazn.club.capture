package com.seazn.capture.engine.adapter

import kotlin.test.Test
import kotlin.test.assertEquals

class MicSilenceWatchTest {
  @Test
  fun `F-P5-8 a call silences our recording only, matched by session id`() {
    val watch = MicSilenceWatch()
    assertEquals(null, watch.update(ours = 41, configs = listOf(RecordingConfig(41, false))), "the first reading sets the baseline: not silenced is no change")
    assertEquals(true, watch.update(41, listOf(RecordingConfig(41, true), RecordingConfig(7, false))))
    assertEquals(null, watch.update(41, listOf(RecordingConfig(41, true))), "unchanged")
    assertEquals(null, watch.update(41, listOf(RecordingConfig(7, true))), "another app's silencing is not ours, and our absence is no change")
    assertEquals(false, watch.update(41, listOf(RecordingConfig(41, false))))
  }

  @Test
  fun `no session id of ours is no reading`() {
    assertEquals(null, MicSilenceWatch().update(null, listOf(RecordingConfig(41, true))))
  }

  @Test
  fun `the first reading silenced is a change`() {
    assertEquals(true, MicSilenceWatch().update(41, listOf(RecordingConfig(41, true))))
  }

  @Test
  fun `silencing that toggles twice is reported each way, each time`() {
    val watch = MicSilenceWatch()
    val readings = listOf(true, false, true, false).map { watch.update(41, listOf(RecordingConfig(41, it))) }
    assertEquals(listOf<Boolean?>(true, false, true, false), readings)
  }

  @Test
  fun `no recording configs at all is no reading, and keeps the baseline`() {
    val watch = MicSilenceWatch()
    assertEquals(true, watch.update(41, listOf(RecordingConfig(41, true))))
    assertEquals(null, watch.update(41, emptyList()), "nothing recording: no change")
    assertEquals(null, watch.update(41, listOf(RecordingConfig(41, true))), "still silenced: told once")
    assertEquals(false, watch.update(41, listOf(RecordingConfig(41, false))))
  }

  @Test
  fun `another app's recording listed ahead of ours is not read for ours`() {
    val watch = MicSilenceWatch()
    assertEquals(null, watch.update(41, listOf(RecordingConfig(7, true), RecordingConfig(41, false))))
    assertEquals(true, watch.update(41, listOf(RecordingConfig(7, false), RecordingConfig(41, true))))
  }

  @Test
  fun `a new recording of ours is read against the last word told`() {
    val watch = MicSilenceWatch()
    assertEquals(true, watch.update(41, listOf(RecordingConfig(41, true))))
    // The viewfinder reopened: a new AudioRecord, a new session id, and the call has ended.
    assertEquals(false, watch.update(52, listOf(RecordingConfig(52, false), RecordingConfig(41, true))))
  }
}
