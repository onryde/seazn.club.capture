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

  /**
   * Review I-1, spec §4 ("a call means not ready"): before air our one recording is the meter's (SoundMeter, 41).
   * StreamPack's AudioRecord (52) is built with the streamer but records only from the connect, so a watch that
   * read it before air would never hear a call there.
   */
  @Test
  fun `I-1 before air the meter's recording is ours, though StreamPack's exists, and a call on it is heard`() {
    val watch = MicSilenceWatch()
    val ours = MicSilenceWatch.ours(meter = 41, streamer = { 52 })
    assertEquals(41, ours, "the meter's session while it records")
    assertEquals(true, watch.update(ours, listOf(RecordingConfig(41, true))), "a call before Go live")
    assertEquals(false, watch.update(ours, listOf(RecordingConfig(41, false))), "and its end")
  }

  /**
   * Review I-1 and G-2, the handover in the glue's own order (StreamerAdapter): the meter records from the build;
   * `beforeConnect` stops it, so StreamPack's recording is ours on air; `afterBroadcast` starts a new meter, so a
   * call that outlives the broadcast is still heard ending (G-2: watching StreamPack's alone, its recording leaves
   * the list with the broadcast and the call's end is never read). Each step: who records, the configs Android
   * hands over, and the word the watch must report.
   */
  @Test
  fun `I-1 G-2 the watched session hands over to StreamPack's at the connect and back to a new meter after the broadcast`() {
    data class Step(val name: String, val meter: Int?, val configs: List<RecordingConfig>, val told: Boolean?)
    val streamer = 52 // StreamPack's AudioRecord, built with the streamer, readable from the build to the release
    val steps =
      listOf(
        Step("before air, a quiet room", meter = 41, listOf(RecordingConfig(41, false)), told = null),
        Step("the connect: the meter stopped, StreamPack records", meter = null, listOf(RecordingConfig(52, false)), told = null),
        Step("a call on air", meter = null, listOf(RecordingConfig(52, true)), told = true),
        Step("the broadcast ends during the call: a new meter records, still silenced", meter = 63, listOf(RecordingConfig(63, true)), told = null),
        Step("the call ends", meter = 63, listOf(RecordingConfig(63, false)), told = false),
        Step("a second call, before the next Go live", meter = 63, listOf(RecordingConfig(63, true)), told = true),
      )
    val watch = MicSilenceWatch()
    var checked = 0
    for (step in steps) {
      assertEquals(step.told, watch.update(MicSilenceWatch.ours(step.meter) { streamer }, step.configs), step.name)
      checked += 1
    }
    assertEquals(6, checked, "the steps' own count")
  }

  @Test
  fun `I-1 with no meter recording, StreamPack's session is ours, and with neither there is none`() {
    assertEquals(52, MicSilenceWatch.ours(meter = null, streamer = { 52 }))
    assertEquals(null, MicSilenceWatch.ours(meter = null, streamer = { null }))
  }
}
