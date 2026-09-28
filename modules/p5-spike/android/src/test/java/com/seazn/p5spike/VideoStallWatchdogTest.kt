package com.seazn.p5spike

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
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
    contended: Boolean = false,
  ): List<VideoVerdict> {
    if (videoFlowing) video += 15
    if (audioFlowing) audio += 23
    now = atMs
    return watchdog.tick(publishing, video, audio, "srt", contended)
  }

  /** Every 500 ms from [fromMs] to [toMs] inclusive; all verdicts, in order. */
  private fun ticks(
    fromMs: Long,
    toMs: Long,
    publishing: Boolean = true,
    videoFlowing: Boolean = true,
    audioFlowing: Boolean = true,
    contended: Boolean = false,
  ): List<VideoVerdict> = (fromMs..toMs step 500).flatMap { tick(it, publishing, videoFlowing, audioFlowing, contended) }

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

  // F-P5-9: starvation. The rates are the per-second counts measured on 2026-09-28 (healthy is 30
  // video fps and ~47 audio frames/s). Each second is two 500 ms ticks carrying half its frames.

  /** A verdict and the tick it came on. */
  private data class Heard(val atMs: Long, val verdict: VideoVerdict)

  /** One second per (video, audio) pair, from [fromMs]: ticks at fromMs, fromMs + 500, fromMs + 1000 … */
  private fun seconds(fromMs: Long, rates: List<Pair<Int, Int>>, publishing: Boolean = true): List<Heard> =
    rates.flatMapIndexed { index, (videoPerS, audioPerS) ->
      val at = fromMs + index * 1_000L
      val first = counted(at, videoPerS / 2, audioPerS / 2, publishing)
      first + counted(at + 500, videoPerS - videoPerS / 2, audioPerS - audioPerS / 2, publishing)
    }

  private fun counted(atMs: Long, videoAdd: Int, audioAdd: Int, publishing: Boolean): List<Heard> {
    video += videoAdd
    audio += audioAdd
    now = atMs
    return watchdog.tick(publishing, video, audio, "rtmps").map { Heard(atMs, it) }
  }

  private fun healthy(n: Int) = List(n) { 30 to 47 }

  /** Call C (15:47:17.7–15:47:48.4Z): video 1–20 fps and audio 1–9 frames/s for about 20 s. */
  private val callC = listOf(
    4 to 6, 1 to 2, 20 to 9, 3 to 1, 12 to 5, 8 to 3, 2 to 7, 15 to 4, 1 to 1, 9 to 8,
    6 to 2, 18 to 9, 2 to 3, 5 to 6, 11 to 1, 1 to 4, 7 to 9, 3 to 2, 14 to 5, 2 to 1,
  )

  @Test
  fun `call C's rates are starvation, reported once, within one window of the onset`() {
    seconds(0, healthy(20))
    val heard = seconds(20_000, callC)

    val starved = heard.single()
    assertEquals(VideoVerdict.Starved::class, starved.verdict::class)
    assertTrue("fired at ${starved.atMs}", starved.atMs in 20_000..23_000)
    val verdict = starved.verdict as VideoVerdict.Starved
    assertTrue(verdict.audioFps!! < 20.0)
    assertEquals("rtmps", verdict.transport)
    assertEquals(VideoState.STARVED, watchdog.state)
  }

  @Test
  fun `audio below 20 frames a second is starvation even with the picture at 30`() {
    seconds(0, healthy(10))
    val heard = seconds(10_000, List(5) { 30 to 10 })

    // The window leaves the last healthy audio behind at 12 000: 49 frames in 3 s.
    assertEquals(Heard(12_000, VideoVerdict.Starved(videoFps = 30.0, audioFps = 16.3, transport = "rtmps")), heard.single())
  }

  @Test
  fun `video below 10 fps is starvation even with audio flowing`() {
    seconds(0, healthy(10))
    val heard = seconds(10_000, List(5) { 8 to 47 })

    assertEquals(Heard(12_500, VideoVerdict.Starved(videoFps = 8.0, audioFps = 47.0, transport = "rtmps")), heard.single())
  }

  @Test
  fun `the browser in front is not starvation - one second at 12 and one at 21, apart or together`() {
    val apart = healthy(10) + listOf(12 to 47) + healthy(5) + listOf(21 to 47) + healthy(10)
    val together = listOf(12 to 47, 21 to 47) + healthy(10)

    assertEquals(emptyList<Heard>(), seconds(0, apart) + seconds(27_000, together))
    assertEquals(VideoState.OK, watchdog.state)
  }

  @Test
  fun `answering a phone call is not starvation - 2 s at 13 fps and 15 audio, and the hang-up dip`() {
    val answer = listOf(13 to 15, 13 to 15)
    val hangUp = listOf(15 to 47)

    assertEquals(emptyList<Heard>(), seconds(0, healthy(10) + answer + healthy(13) + hangUp + healthy(10)))
    assertEquals(VideoState.OK, watchdog.state)
  }

  @Test
  fun `starvation is detected and surfaced, never answered with a recovery`() {
    seconds(0, healthy(10))
    seconds(10_000, callC)

    assertNull(watchdog.recoveryStarted())
    assertEquals(VideoState.STARVED, watchdog.state)
  }

  @Test
  fun `it clears only after a full window above both floors, with how long it lasted`() {
    seconds(0, healthy(10))
    val starvedAt = seconds(10_000, callC).single().atMs

    // Healthy from 30 000. The window ending 30 500 still averages 17.7 audio frames/s: the last
    // judgement below a floor. Every judgement from 31 000 on is above both, and clearing takes 3000 ms
    // of them, so it clears at 33 500 — not at 31 000, the first window above.
    val heard = seconds(30_000, healthy(10))
    assertEquals(Heard(33_500, VideoVerdict.DeliveryRestored(msStarved = 33_500 - starvedAt)), heard.single())
    assertEquals(VideoState.OK, watchdog.state)
  }

  @Test
  fun `one window above the floor inside call C does not end the episode`() {
    // Call C's video with audio healthy. The whole-second windows run 4+1+20 = 8.3 fps, 1+20+3 = 8.0,
    // 20+3+12 = 11.7 (above the floor), 3+12+8 = 7.7, and the rest stay below or rise above only briefly.
    // Without 3000 ms of continuous above-floor judgements, one episode, no restore at 11.7.
    seconds(0, healthy(10))
    val heard = seconds(10_000, callC.map { (videoPerS, _) -> videoPerS to 47 })

    assertEquals(listOf(VideoVerdict.Starved::class), heard.map { it.verdict::class })
    assertEquals(VideoState.STARVED, watchdog.state)
  }

  @Test
  fun `a stall that heals by itself does not go straight to starved`() {
    seconds(0, healthy(10))
    // Video stops at 10 000 with the publish still up; the stall fires at 12 500.
    assertEquals(listOf(VideoVerdict.Stalled::class), seconds(10_000, List(3) { 0 to 47 }).map { it.verdict::class })
    // It comes back before any recovery reconnects. The window across the gap is not the picture now.
    val heard = seconds(13_000, healthy(10))

    assertEquals(listOf(VideoVerdict.Recovered::class), heard.map { it.verdict::class })
    assertEquals(VideoState.OK, watchdog.state)
  }

  @Test
  fun `a window with one floor still breached does not clear it`() {
    seconds(0, healthy(10))
    seconds(10_000, callC)

    assertEquals(emptyList<Heard>(), seconds(30_000, List(10) { 30 to 12 }))
    assertEquals(VideoState.STARVED, watchdog.state)
  }

  @Test
  fun `a publish that starts starved is not judged until a full window after its first frame`() {
    // The first frame is counted at 500 ms, so the first full window ends at 3500 ms.
    val heard = seconds(0, List(10) { 5 to 5 })

    assertEquals(3_500L, heard.single().atMs)
    assertEquals(VideoVerdict.Starved::class, heard.single().verdict::class)
  }

  @Test
  fun `after a reconnect it waits a full window from the first frame before judging again`() {
    seconds(0, healthy(10))
    seconds(10_000, healthy(2), publishing = false)
    // Publishing again at 12 000; its first frame is counted at 12 500.
    val heard = seconds(12_000, List(10) { 5 to 5 })

    assertEquals(15_500L, heard.single().atMs)
  }

  @Test
  fun `the report of the window rate is null until a full window, and while not publishing`() {
    seconds(0, healthy(3))
    assertNull(watchdog.videoFps)
    seconds(3_000, healthy(1))
    assertEquals(30.0, watchdog.videoFps!!, 0.0)
    seconds(4_000, healthy(1), publishing = false)
    assertNull(watchdog.videoFps)
  }

  @Test
  fun `a picture that stops dead is a stall, never starvation first`() {
    seconds(0, healthy(10))
    val heard = seconds(10_000, List(4) { 0 to 47 })

    assertEquals(listOf(VideoVerdict.Stalled::class), heard.map { it.verdict::class })
    assertNull((heard.single().verdict as VideoVerdict.Stalled).msStarved)
    assertEquals(VideoState.STALLED, watchdog.state)
  }

  @Test
  fun `a stall during starvation takes over the episode, and recovery does not claim delivery restored`() {
    seconds(0, healthy(10))
    val starvedAt = seconds(10_000, List(5) { 5 to 5 }).single().atMs
    val stall = seconds(15_000, List(4) { 0 to 5 }).single()

    assertEquals(VideoState.STALLED, watchdog.state)
    assertEquals(stall.atMs - starvedAt, (stall.verdict as VideoVerdict.Stalled).msStarved)
    assertEquals(1, watchdog.recoveryStarted())
    seconds(19_000, healthy(2), publishing = false)
    val after = seconds(21_000, healthy(10))
    assertEquals(listOf(VideoVerdict.Recovered::class), after.map { it.verdict::class })
    assertEquals(VideoState.OK, watchdog.state)
  }

  // F-P5-10 `hold`: after WhatsApp took camera 1, the recovery that rebuilt the stream was followed by
  // noise at 30 fps. Under `hold`, a stall while another app holds a camera is surfaced and waited
  // out, and the recovery runs once the camera is released. Video flows 0–2000 ms in each case.

  @Test
  fun `hold - a stall while a camera is contended is held, asks for no recovery, and counts no attempt`() {
    watchdog.reset(holdWhileContended = true)
    ticks(0, 2_000)

    val verdicts = ticks(2_500, 5_000, videoFlowing = false, contended = true)
    assertEquals(listOf(VideoVerdict.Stalled(3_000, video, audioAdvancing = true, transport = "srt", held = true)), verdicts)
    assertEquals(VideoState.STALLED, watchdog.state)
    assertNull(watchdog.recoveryStarted())
    // Held for a minute, past three resume windows: no second verdict, and never failed.
    assertEquals(emptyList<VideoVerdict>(), ticks(5_500, 65_000, videoFlowing = false, contended = true))
    assertEquals(VideoState.STALLED, watchdog.state)
  }

  @Test
  fun `hold - the camera released with video still stalled asks for the recovery at once, as the first attempt`() {
    watchdog.reset(holdWhileContended = true)
    ticks(0, 2_000)
    ticks(2_500, 20_000, videoFlowing = false, contended = true)
    now = 20_200

    // The last frame was at 2000 ms.
    assertEquals(listOf(VideoVerdict.HoldReleased(msStalled = 18_200)), watchdog.contentionEnded())
    assertEquals(1, watchdog.recoveryStarted())
    assertEquals(VideoState.RECOVERING, watchdog.state)
  }

  @Test
  fun `hold - video resuming by itself while held is recovered, with no attempt and nothing asked on release`() {
    watchdog.reset(holdWhileContended = true)
    ticks(0, 2_000)
    ticks(2_500, 10_000, videoFlowing = false, contended = true)
    assertNull(watchdog.recoveryStarted())

    assertEquals(listOf(VideoVerdict.Recovered(msStalled = 8_500)), tick(10_500, contended = true))
    assertEquals(VideoState.OK, watchdog.state)
    assertEquals(emptyList<VideoVerdict>(), watchdog.contentionEnded())
  }

  @Test
  fun `hold off - a stall while a camera is contended recovers as before`() {
    ticks(0, 2_000)

    val verdicts = ticks(2_500, 5_000, videoFlowing = false, contended = true)
    assertEquals(listOf(VideoVerdict.Stalled(3_000, video, audioAdvancing = true, transport = "srt")), verdicts)
    assertEquals(1, watchdog.recoveryStarted())
    assertEquals(emptyList<VideoVerdict>(), watchdog.contentionEnded())
  }
}
