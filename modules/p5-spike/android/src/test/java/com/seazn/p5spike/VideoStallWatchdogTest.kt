package com.seazn.p5spike

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/**
 * F-P5-6's detector. Ticks run at the watchdog's real 500 ms cadence; a flowing counter advances by
 * 15 video and 23 audio frames a tick (30 fps, ~47 AAC frames/s).
 */
class VideoStallWatchdogTest {
  private var now = 0L
  private var video = 0L
  private var audio = 0L
  private val watchdog = VideoStallWatchdog(clock = { now })

  private fun tick(
    atMs: Long,
    publishing: Boolean = true,
    videoFlowing: Boolean = true,
    audioFlowing: Boolean = true,
  ): List<VideoVerdict> {
    if (videoFlowing) video += 15
    if (audioFlowing) audio += 23
    now = atMs
    return watchdog.tick(publishing, video, audio, "srt")
  }

  /** Every 500 ms from [fromMs] to [toMs] inclusive; all verdicts, in order. */
  private fun ticks(
    fromMs: Long,
    toMs: Long,
    publishing: Boolean = true,
    videoFlowing: Boolean = true,
    audioFlowing: Boolean = true,
  ): List<VideoVerdict> = (fromMs..toMs step 500).flatMap { tick(it, publishing, videoFlowing, audioFlowing) }

  /** Video flows 0–2000 ms, then stops; the stall is reported at 5000 ms. */
  private fun stallAt5s(): List<VideoVerdict> {
    ticks(0, 2_000)
    return ticks(2_500, 5_000, videoFlowing = false)
  }

  @Test
  fun `healthy ticks say nothing, and video is ok`() {
    assertEquals(emptyList<VideoVerdict>(), ticks(0, 60_000))
    assertEquals(VideoState.OK, watchdog.state)
  }

  @Test
  fun `video flat for 3000 ms while publishing is a stall`() {
    ticks(0, 2_000)

    assertEquals(emptyList<VideoVerdict>(), ticks(2_500, 4_500, videoFlowing = false))
    assertEquals(listOf(VideoVerdict.Stalled(3_000, video, audioAdvancing = true, transport = "srt")), tick(5_000, videoFlowing = false))
    assertEquals(VideoState.STALLED, watchdog.state)
  }

  @Test
  fun `a stall says whether audio kept flowing`() {
    ticks(0, 2_000)
    val verdicts = ticks(2_500, 5_000, videoFlowing = false, audioFlowing = false)

    assertEquals(listOf(VideoVerdict.Stalled(3_000, video, audioAdvancing = false, transport = "srt")), verdicts)
  }

  @Test
  fun `a stall is reported once, not every tick after it`() {
    stallAt5s()

    assertEquals(emptyList<VideoVerdict>(), ticks(5_500, 30_000, videoFlowing = false))
  }

  @Test
  fun `video coming back after a recovery is reported with how long there was none`() {
    stallAt5s()
    assertEquals(1, watchdog.recoveryStarted())
    assertEquals(VideoState.RECOVERING, watchdog.state)
    ticks(5_500, 8_000, publishing = false, videoFlowing = false)
    tick(8_500, videoFlowing = false)

    // The last frame was at 2000 ms: 7 s with no picture, the reconnect included.
    assertEquals(listOf(VideoVerdict.Recovered(msStalled = 7_000)), tick(9_000))
    assertEquals(VideoState.OK, watchdog.state)
  }

  @Test
  fun `before the first frame of a publish it waits up to 5000 ms, and says nothing is live yet`() {
    assertEquals(emptyList<VideoVerdict>(), ticks(0, 4_500, videoFlowing = false))
    assertEquals(VideoState.IDLE, watchdog.state)
    assertEquals(listOf(VideoVerdict.Stalled(5_000, video, audioAdvancing = true, transport = "srt")), tick(5_000, videoFlowing = false))
  }

  @Test
  fun `once video has flowed, the startup grace no longer applies`() {
    tick(0, videoFlowing = false)
    tick(500)

    assertEquals(emptyList<VideoVerdict>(), ticks(1_000, 3_000, videoFlowing = false))
    assertEquals(listOf(VideoVerdict.Stalled(3_000, video, audioAdvancing = true, transport = "srt")), tick(3_500, videoFlowing = false))
  }

  @Test
  fun `never fires while not publishing, and time off air does not count toward a stall`() {
    ticks(0, 2_000)

    assertEquals(emptyList<VideoVerdict>(), ticks(2_500, 60_000, publishing = false, videoFlowing = false))
    assertEquals(VideoState.IDLE, watchdog.state)
    // Publishing again at 60 500 with no video: the first-frame grace starts there, not at 2000.
    assertEquals(emptyList<VideoVerdict>(), ticks(60_500, 65_000, videoFlowing = false))
    assertEquals(1, tick(65_500, videoFlowing = false).size)
  }

  @Test
  fun `a recovery gets ten seconds of publishing to bring video back`() {
    stallAt5s()
    watchdog.recoveryStarted()
    ticks(5_500, 7_500, publishing = false, videoFlowing = false)

    assertEquals(emptyList<VideoVerdict>(), ticks(8_000, 17_500, videoFlowing = false))
    val verdicts = tick(18_000, videoFlowing = false)
    assertEquals(listOf(VideoVerdict.Stalled(16_000, video, audioAdvancing = true, transport = "srt")), verdicts)
  }

  @Test
  fun `after three recoveries that bring no video back, it stops recovering until video returns`() {
    stallAt5s()
    var at = 5_000L
    repeat(3) { index ->
      assertEquals(index + 1, watchdog.recoveryStarted())
      ticks(at + 500, at + 2_500, publishing = false, videoFlowing = false)
      ticks(at + 3_000, at + 12_500, videoFlowing = false)
      at += 13_000
      val verdicts = tick(at, videoFlowing = false)
      val expected = if (index < 2) VideoVerdict.Stalled::class else VideoVerdict.RecoveryFailed::class
      assertEquals(expected, verdicts.single()::class)
    }

    assertEquals(VideoState.FAILED, watchdog.state)
    assertNull(watchdog.recoveryStarted())
    assertEquals(emptyList<VideoVerdict>(), ticks(at + 500, at + 60_000, videoFlowing = false))
    assertEquals(VideoState.FAILED, watchdog.state)
    assertEquals(VideoVerdict.Recovered::class, tick(at + 60_500).single()::class)
    assertEquals(VideoState.OK, watchdog.state)
  }

  @Test
  fun `the recovery count restarts once video comes back`() {
    stallAt5s()
    watchdog.recoveryStarted()
    ticks(5_500, 8_000)
    ticks(8_500, 11_500, videoFlowing = false)

    assertEquals(1, watchdog.recoveryStarted())
  }

  @Test
  fun `an operator stop ends the episode and the recovery count`() {
    stallAt5s()
    watchdog.recoveryStarted()
    watchdog.reset()

    assertEquals(VideoState.IDLE, watchdog.state)
    // A fresh publish: the 5000 ms first-frame grace, not a recovery's ten seconds.
    assertEquals(emptyList<VideoVerdict>(), ticks(10_000, 14_500, videoFlowing = false))
    assertEquals(1, tick(15_000, videoFlowing = false).size)
    assertEquals(1, watchdog.recoveryStarted())
  }

  @Test
  fun `no reading of the counters is no verdict`() {
    now = 60_000
    assertEquals(emptyList<VideoVerdict>(), watchdog.tick(true, null, null, "srt"))
  }
}
