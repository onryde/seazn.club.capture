package com.seazn.capture.engine.core

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlin.test.assertTrue

class DeliveryWatchTest {
  private val master = "https://customer-x.cloudflarestream.com/abc/manifest/video.m3u8"
  private val polled = "https://customer-x.cloudflarestream.com/abc/manifest/video.m3u8?clientBandwidthHint=0.1"
  private val variant = "https://customer-x.cloudflarestream.com/abc/manifest/stream_720/video.m3u8"

  private fun masterText(path: String = "stream_720/video.m3u8") = "#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=3128000\n$path\n"

  private fun mediaText(head: Long, target: Int = 2, endList: Boolean = false): String {
    val first = head - 2
    val segments = (first..head).joinToString("") { "#EXTINF:2.000,\nseg$it.ts\n" }
    return "#EXTM3U\n#EXT-X-TARGETDURATION:$target\n#EXT-X-MEDIA-SEQUENCE:$first\n$segments" +
      if (endList) "#EXT-X-ENDLIST\n" else ""
  }

  /**
   * An LL-HLS media playlist: completed segments [head] − 2 to [head], each listed with its four
   * 500 ms parts, then [trailingParts] 500 ms parts of the segment in progress and a preload hint.
   */
  private fun llText(head: Long, trailingParts: Long): String {
    val first = head - 2
    val parts = { segment: Long, count: Long -> (0 until count).joinToString("") { "#EXT-X-PART:DURATION=0.5,URI=\"p$segment.$it.mp4\"\n" } }
    val segments = (first..head).joinToString("") { parts(it, 4) + "#EXTINF:2.000,\ns$it.mp4\n" }
    return "#EXTM3U\n#EXT-X-TARGETDURATION:2\n#EXT-X-SERVER-CONTROL:CAN-BLOCK-RELOAD=YES,PART-HOLD-BACK=1.5\n" +
      "#EXT-X-PART-INF:PART-TARGET=0.5\n#EXT-X-MEDIA-SEQUENCE:$first\n$segments${parts(head + 1, trailingParts)}" +
      "#EXT-X-PRELOAD-HINT:TYPE=PART,URI=\"p${head + 1}.$trailingParts.mp4\"\n"
  }

  /**
   * Ticks every 500 ms from [fromMs] to [toMs] and answers every request at once with [answer].
   * Returns the first not-delivered verdict and when it came.
   */
  private class Harness(var watch: DeliveryWatch) {
    val requests = mutableListOf<Pair<Long, PlaylistRequest>>()
    var verdict: Pair<Long, NotDelivered>? = null

    fun run(fromMs: Long, toMs: Long, onAir: (Long) -> Boolean = { true }, answer: (Long, String) -> FetchResult?) {
      var t = fromMs
      while (t <= toMs) {
        val (ticked, issued) = watch.tick(t, onAir(t))
        watch = ticked
        var queue = issued
        while (queue.isNotEmpty()) {
          val request = queue.first()
          requests += t to request
          val result = answer(t, request.url) ?: break
          val (next, more, found) = watch.fetched(request.id, result, t)
          watch = next
          if (found != null && verdict == null) verdict = t to found
          queue = more
        }
        t += 500
      }
    }
  }

  private fun respond(variantText: (Long) -> String): (Long, String) -> FetchResult = { t, url ->
    if (url == polled) FetchResult.Body(masterText()) else FetchResult.Body(variantText(t))
  }

  @Test
  fun `F-P5-13 a head frozen for 20 s of publishing is not-delivered`() {
    // The dark reconnect: the playlist gained one segment and then stalled; the master then 204s.
    val harness = Harness(DeliveryWatch(master))
    harness.run(0, 40_000) { t, url ->
      when {
        t > 10_000 && url == polled -> FetchResult.NoContent
        url == polled -> FetchResult.Body(masterText())
        else -> FetchResult.Body(mediaText(100 + t / 2_000))
      }
    }
    val (at, verdict) = harness.verdict!!
    assertEquals(30_000L, at, "20 s of publishing after the last advance at 10 s")
    assertEquals(NotDeliveredCause.STALLED, verdict.cause)
  }

  @Test
  fun `F-P5-13 a drip that never stalls 20 s is caught by growing lag`() {
    // Final soak: "from 07:16Z it gained about one segment a minute" — here one 2 s segment every 15 s.
    // Lag at a poll is t − 2000 × floor(t / 15000); it first reaches 20 000 at t = 22 000.
    val harness = Harness(DeliveryWatch(master))
    harness.run(0, 60_000, answer = respond { t -> mediaText(100 + t / 15_000) })
    val (at, verdict) = harness.verdict!!
    assertEquals(22_000L, at)
    assertEquals(NotDeliveredCause.LAGGING, verdict.cause)
  }

  @Test
  fun `F-P5-4 the stall threshold is three configured segments, not three target durations`() {
    // Soak: targetDuration grew to 8, so the old rule needed 24 s. P5's own test: a 10 s frozen head is a stall.
    val harness = Harness(DeliveryWatch(master))
    harness.run(0, 10_000, answer = respond { t -> mediaText(100 + t / 2_000, target = 8) })
    harness.run(10_500, 14_000, answer = respond { mediaText(105, target = 8) })
    assertEquals(Delivery.OK, harness.watch.delivery, "4 s frozen is inside the margin")
    harness.run(14_500, 20_000, answer = respond { mediaText(105, target = 8) })
    assertEquals(Delivery.STALLED, harness.watch.delivery)
    assertNull(harness.verdict, "stalled is shown at 6 s; not-delivered waits for 20 s")
  }

  @Test
  fun `H-P5-1 EXT-X-ENDLIST never means ended`() {
    val moving = Harness(DeliveryWatch(master))
    moving.run(0, 30_000, answer = respond { t -> mediaText(100 + t / 2_000, endList = true) })
    assertEquals(Delivery.OK, moving.watch.delivery)
    assertNull(moving.verdict)

    val frozen = Harness(DeliveryWatch(master))
    frozen.run(0, 30_000, answer = respond { mediaText(100, endList = true) })
    assertEquals(NotDeliveredCause.STALLED, frozen.verdict!!.second.cause, "an ENDLIST that stops moving is a stall like any other")
  }

  @Test
  fun `F-P5-2 a variant change is not progress and does not reset the stall clock`() {
    // The Redmi's reconnect storm: almost every poll saw a new variant, and the old watcher called it advancing.
    val harness = Harness(DeliveryWatch(master))
    harness.run(0, 30_000) { t, url ->
      if (url == polled) FetchResult.Body(masterText("stream_$t/video.m3u8")) else FetchResult.Body(mediaText(500 + t))
    }
    assertEquals(20_000L, harness.verdict!!.first)
    assertEquals(NotDeliveredCause.STALLED, harness.verdict!!.second.cause)
  }

  @Test
  fun `only publishing time counts toward a stall`() {
    val harness = Harness(DeliveryWatch(master))
    val onAir = { t: Long -> t <= 10_000 || t >= 70_000 }
    harness.run(0, 100_000, onAir) { t, url ->
      if (url == polled) FetchResult.Body(masterText()) else FetchResult.Body(mediaText(if (t <= 10_000) 100 + t / 2_000 else 105))
    }
    assertEquals(90_000L, harness.verdict!!.first, "10 s on air, 60 s off, then 20 s on air frozen")
  }

  @Test
  fun `no polling while off air, and delivery claims nothing`() {
    val harness = Harness(DeliveryWatch(master))
    harness.run(0, 20_000, onAir = { false }, answer = respond { mediaText(100) })
    assertTrue(harness.requests.isEmpty())
    assertEquals(Delivery.UNKNOWN, harness.watch.delivery)
  }

  @Test
  fun `failed fetches are unknown, never not-delivered`() {
    val harness = Harness(DeliveryWatch(master))
    harness.run(0, 60_000) { _, _ -> FetchResult.Failed("timeout") }
    assertNull(harness.verdict)
    assertEquals(Delivery.UNKNOWN, harness.watch.delivery)
  }

  @Test
  fun `an HTTP error or a garbled body is no evidence`() {
    val errors = Harness(DeliveryWatch(master))
    errors.run(0, 60_000) { _, _ -> FetchResult.HttpError(403) }
    assertNull(errors.verdict)
    val garbled = Harness(DeliveryWatch(master))
    garbled.run(0, 60_000) { _, _ -> FetchResult.Body("") }
    assertNull(garbled.verdict)
  }

  @Test
  fun `the master is re-resolved on every poll`() {
    val harness = Harness(DeliveryWatch(master))
    harness.run(0, 10_000, answer = respond { t -> mediaText(100 + t / 2_000) })
    assertEquals(listOf(0L, 2_000L, 4_000L, 6_000L, 8_000L, 10_000L), harness.requests.filter { it.second.url == polled }.map { it.first })
    assertTrue(harness.requests.any { it.second.url == variant })
  }

  @Test
  fun `a request in flight blocks the next poll until it is abandoned at 10 s`() {
    val harness = Harness(DeliveryWatch(master))
    harness.run(0, 10_000) { _, _ -> null }
    assertEquals(listOf(0L, 10_000L), harness.requests.map { it.first })
  }

  @Test
  fun `a stale answer is ignored`() {
    val (watch, issued) = DeliveryWatch(master).tick(0, onAirNow = true)
    val (abandoned, _) = watch.tick(10_000, onAirNow = true)
    val (after, more, verdict) = abandoned.fetched(issued.single().id, FetchResult.Body(masterText()), 10_500)
    assertEquals(abandoned, after)
    assertTrue(more.isEmpty())
    assertNull(verdict)
  }

  @Test
  fun `a moving playlist is OK with no lag`() {
    val harness = Harness(DeliveryWatch(master))
    harness.run(0, 30_000, answer = respond { t -> mediaText(100 + t / 2_000) })
    assertEquals(Delivery.OK, harness.watch.delivery)
    assertEquals(0L, harness.watch.deliveredLagMs)
    assertNull(harness.verdict)
  }

  @Test
  fun `the master is polled for one rendition, with a low bandwidth hint`() {
    val harness = Harness(DeliveryWatch(master))
    harness.run(0, 0, answer = respond { mediaText(100) })
    assertEquals(listOf(polled, variant), harness.requests.map { it.second.url })
    assertEquals("$master?token=v&clientBandwidthHint=0.1", DeliveryWatch("$master?token=v").pollUrl, "an existing query is kept")
  }

  @Test
  fun `LL-HLS parts that advance while full segments lag are delivery`() {
    // Segment 100 never completes; a part of 500 ms arrives every 500 ms. Parts are playable media.
    val harness = Harness(DeliveryWatch(master))
    harness.run(0, 30_000, answer = respond { t -> llText(100, trailingParts = t / 500) })
    assertNull(harness.verdict)
    assertEquals(Delivery.OK, harness.watch.delivery)
    assertEquals(30_000L, harness.watch.mediaMs, "0 to 60 parts of 500 ms between the first poll and the last")
    assertEquals(0L, harness.watch.deliveredLagMs)
  }

  @Test
  fun `LL-HLS parts that roll into a completed segment are counted once`() {
    // Delivered media is t + 1 s: at every 2 s poll one more 2 s segment completes, and the two
    // 500 ms parts of the next are always out. Polls at 0 … 20 s: 20 s of media, not 30 s.
    val harness = Harness(DeliveryWatch(master))
    harness.run(0, 20_000, answer = respond { t -> llText(100 + t / 2_000, trailingParts = 2) })
    assertEquals(20_000L, harness.watch.mediaMs)
    assertEquals(Delivery.OK, harness.watch.delivery)
  }

  @Test
  fun `F-P5-4 LL-HLS parts that stop are a stall on the configured segment, not the part target`() {
    val harness = Harness(DeliveryWatch(master))
    harness.run(0, 10_000, answer = respond { t -> llText(100, trailingParts = t / 500) })
    harness.run(10_500, 14_000, answer = respond { llText(100, trailingParts = 20) })
    assertEquals(Delivery.OK, harness.watch.delivery, "4 s without a part is inside the margin")
    harness.run(14_500, 40_000, answer = respond { llText(100, trailingParts = 20) })
    assertEquals(Delivery.STALLED, harness.watch.delivery)
    assertEquals(30_000L, harness.verdict!!.first, "20 s of publishing after the last part at 10 s")
  }

  @Test
  fun `a new session proves itself from zero`() {
    val harness = Harness(DeliveryWatch(master))
    harness.run(0, 30_000, answer = respond { mediaText(100) })
    val fresh = harness.watch.newSession()
    assertEquals(0L, fresh.sinceAdvanceMs)
    assertEquals(Delivery.UNKNOWN, fresh.delivery)
    assertNull(fresh.pending)
    assertNull(fresh.variantUrl, "the old session's variant is no baseline")
    assertNull(fresh.head, "nor is its head")
  }

  // Below: added in B4's mutation pass, each killing a mutant the tests above left alive.

  /** A plain media playlist listing every 2 s segment from [first] to [head]. */
  private fun windowText(first: Long, head: Long): String =
    "#EXTM3U\n#EXT-X-TARGETDURATION:2\n#EXT-X-MEDIA-SEQUENCE:$first\n" +
      (first..head).joinToString("") { "#EXTINF:2.000,\nseg$it.ts\n" }

  @Test
  fun `going off air withdraws a delivery claim and its lag`() {
    val harness = Harness(DeliveryWatch(master))
    harness.run(0, 10_000, answer = respond { t -> mediaText(100 + t / 2_000) })
    assertEquals(Delivery.OK, harness.watch.delivery)
    harness.run(10_500, 10_500, onAir = { false }, answer = respond { mediaText(105) })
    assertEquals(Delivery.UNKNOWN, harness.watch.delivery)
    assertNull(harness.watch.deliveredLagMs)
  }

  @Test
  fun `a poll that brings no evidence withdraws an OK and its lag`() {
    val noEvidence =
      listOf<(Long, String) -> FetchResult>(
        { _, _ -> FetchResult.Failed("timeout") },
        { _, _ -> FetchResult.HttpError(503) },
        { _, _ -> FetchResult.Body("<html>502</html>") },
        { _, url -> if (url == polled) FetchResult.Body(masterText("has space.m3u8")) else FetchResult.Body(mediaText(106)) },
      )
    for (answer in noEvidence) {
      val harness = Harness(DeliveryWatch(master))
      harness.run(0, 10_000, answer = respond { t -> mediaText(100 + t / 2_000) })
      assertEquals(Delivery.OK, harness.watch.delivery)
      harness.run(10_500, 12_000, answer = answer)
      assertEquals(Delivery.UNKNOWN, harness.watch.delivery, "2 s since the last advance: no evidence, and not yet a stall")
      assertNull(harness.watch.deliveredLagMs)
    }
  }

  @Test
  fun `a 204 on the variant is no evidence - only the master's 204 means nothing is live`() {
    val harness = Harness(DeliveryWatch(master))
    harness.run(0, 60_000) { _, url -> if (url == polled) FetchResult.Body(masterText()) else FetchResult.NoContent }
    assertNull(harness.verdict)
    assertEquals(Delivery.UNKNOWN, harness.watch.delivery)
  }

  @Test
  fun `a variant that answers with a master is no evidence and is not followed`() {
    val harness = Harness(DeliveryWatch(master))
    harness.run(0, 4_000) { t, url ->
      when (url) {
        polled -> FetchResult.Body(masterText())
        variant -> FetchResult.Body(masterText("nested.m3u8"))
        else -> FetchResult.Body(mediaText(100 + t / 2_000))
      }
    }
    assertEquals(listOf(polled, variant, polled, variant, polled, variant), harness.requests.map { it.second.url })
    assertEquals(Delivery.UNKNOWN, harness.watch.delivery)
  }

  @Test
  fun `F-P5-13 a master that 204s 6 s after the last advance shows stalled, with no lag`() {
    val harness = Harness(DeliveryWatch(master))
    harness.run(0, 16_000) { t, url ->
      when {
        t > 10_000 && url == polled -> FetchResult.NoContent
        url == polled -> FetchResult.Body(masterText())
        else -> FetchResult.Body(mediaText(100 + t / 2_000))
      }
    }
    assertEquals(Delivery.STALLED, harness.watch.delivery, "6 s = 3 × 2 s since the last advance at 10 s")
    assertNull(harness.watch.deliveredLagMs)
  }

  @Test
  fun `F-P5-4 stalled shows at exactly three configured segments without an advance`() {
    val harness = Harness(DeliveryWatch(master))
    harness.run(0, 10_000, answer = respond { t -> mediaText(100 + t / 2_000, target = 8) })
    harness.run(10_500, 16_000, answer = respond { mediaText(105, target = 8) })
    assertEquals(Delivery.STALLED, harness.watch.delivery, "6 s = 3 × 2 s since the last advance at 10 s")
  }

  @Test
  fun `two short freezes a minute apart are not lagging - growth is judged within one minute`() {
    // Freezes of 12 s (from 10 s) and 10 s (from 90 s), each resumed without catching up, so the lag at a
    // poll steps 0 → 12 s → 22 s. Neither freeze reaches 20 s, and inside any minute the lag grows at most
    // 12 s; only measured from the session's start has it grown 22 s.
    val head = { t: Long ->
      when {
        t <= 10_000 -> 100 + t / 2_000
        t < 22_000 -> 105L
        t <= 90_000 -> 105 + (t - 22_000) / 2_000
        t < 100_000 -> 139L
        else -> 139 + (t - 100_000) / 2_000
      }
    }
    val harness = Harness(DeliveryWatch(master))
    harness.run(0, 200_000, answer = respond { t -> mediaText(head(t)) })
    assertNull(harness.verdict)
    assertEquals(22_000L, harness.watch.deliveredLagMs, "200 s published, 89 segments of 2 s delivered after the first")
  }

  @Test
  fun `delivered lag is measured from the best the session has shown`() {
    // The head holds at 100 for one poll, then is 103 at 4 s and moves on. Lag at a poll (published minus
    // delivered): 0 at 0 s, 2 s at 2 s, then 4 − 6 = −2 s from 4 s on. The best is −2 s, so the lag shown is 0.
    val harness = Harness(DeliveryWatch(master))
    harness.run(0, 2_000, answer = respond { mediaText(100) })
    assertEquals(2_000L, harness.watch.deliveredLagMs)
    harness.run(2_500, 10_000, answer = respond { t -> mediaText(101 + t / 2_000) })
    assertEquals(0L, harness.watch.deliveredLagMs)
  }

  @Test
  fun `a playlist that has not moved since the first poll is never OK`() {
    val harness = Harness(DeliveryWatch(master))
    harness.run(0, 4_000, answer = respond { mediaText(100) })
    assertEquals(Delivery.UNKNOWN, harness.watch.delivery, "one position proves nothing, and 4 s is not yet a stall")
  }

  @Test
  fun `F-P5-2 a variant change carries nothing over from the old variant`() {
    // The 720 variant's head jumps 11 segments at 2 s: 22 s delivered in 2 s published, a lag of −20 s, then
    // steady. At 10 s the master names the 360 variant, which starts at 505 and moves 2 s every 2 s.
    val v360 = "https://customer-x.cloudflarestream.com/abc/manifest/stream_360/video.m3u8"
    val answer = { t: Long, url: String ->
      when {
        url == polled -> FetchResult.Body(masterText(if (t < 10_000) "stream_720/video.m3u8" else "stream_360/video.m3u8"))
        url == variant -> FetchResult.Body(windowText(90, if (t == 0L) 100 else 110 + t / 2_000))
        else -> FetchResult.Body(mediaText(500 + t / 2_000))
      }
    }
    val harness = Harness(DeliveryWatch(master))
    harness.run(0, 10_000, answer = answer)
    assertEquals(v360, harness.requests.last().second.url)
    assertEquals(Delivery.UNKNOWN, harness.watch.delivery, "the first position on a new variant proves nothing")
    harness.run(10_500, 20_000, answer = answer)
    assertNull(harness.verdict)
    assertEquals(Delivery.OK, harness.watch.delivery)
    assertEquals(10_000L, harness.watch.mediaMs, "five 2 s segments on the 360 variant, 10 s to 20 s")
    assertEquals(0L, harness.watch.deliveredLagMs)
  }

  @Test
  fun `a head that goes backwards is a new baseline, not progress`() {
    // The variant restarts its numbering at 50 after 10 s. The last real advance was at 10 s, so
    // not-delivered still comes 20 s of publishing later.
    val harness = Harness(DeliveryWatch(master))
    harness.run(0, 40_000, answer = respond { t -> mediaText(if (t <= 10_000) 100 + t / 2_000 else 50) })
    assertEquals(30_000L, harness.verdict!!.first)
    assertEquals(NotDeliveredCause.STALLED, harness.verdict!!.second.cause, "the frozen head, not growing lag")
  }

  @Test
  fun `a playlist that slid past the last head seen is progress, never a crash`() {
    // Answered at 0 s, failing until 18 s, then at 20 s it lists 108 to 110: every segment listed is new, and
    // 101 to 107 came and went unlisted.
    val harness = Harness(DeliveryWatch(master))
    harness.run(0, 0, answer = respond { mediaText(100) })
    harness.run(500, 18_000) { _, _ -> FetchResult.Failed("timeout") }
    harness.run(18_500, 20_000, answer = respond { mediaText(110) })
    assertEquals(Delivery.OK, harness.watch.delivery)
    assertEquals(0L, harness.watch.sinceAdvanceMs)
    assertEquals(20_000L, harness.watch.mediaMs, "ten 2 s segments since 100: seven unlisted, three listed")
    assertEquals(0L, harness.watch.deliveredLagMs)
  }

  @Test
  fun `LL-HLS delivered media never runs backwards when rounded parts overrun their segment`() {
    // Four parts of 0.5006 s round to 501 ms each, 2 004 ms in all; the segment they complete says 2.002 s.
    val parts = (0 until 4).joinToString("") { "#EXT-X-PART:DURATION=0.5006,URI=\"p101.$it.mp4\"\n" }
    val head = "#EXTM3U\n#EXT-X-TARGETDURATION:2\n#EXT-X-PART-INF:PART-TARGET=0.5\n#EXT-X-MEDIA-SEQUENCE:100\n#EXTINF:2.000,\ns100.mp4\n"
    val harness = Harness(DeliveryWatch(master))
    harness.run(0, 0, answer = respond { head + parts })
    harness.run(500, 2_000, answer = respond { head + parts + "#EXTINF:2.002,\ns101.mp4\n" })
    assertEquals(0L, harness.watch.mediaMs)
    assertEquals(0L, harness.watch.sinceAdvanceMs, "a completed segment is still an advance")
  }

  @Test
  fun `a new session shows no lag and does not take the old session's head as its own`() {
    val harness = Harness(DeliveryWatch(master))
    harness.run(0, 10_000, answer = respond { t -> mediaText(100 + t / 2_000) })
    harness.watch = harness.watch.newSession()
    assertNull(harness.watch.deliveredLagMs)
    harness.run(10_500, 12_000, answer = respond { mediaText(106) })
    assertEquals(Delivery.UNKNOWN, harness.watch.delivery, "one position of the new session proves nothing")
  }

  @Test
  fun `an answer delivered twice is used once`() {
    val (watch, issued) = DeliveryWatch(master).tick(0, onAirNow = true)
    val (once, variantRequests, _) = watch.fetched(issued.single().id, FetchResult.Body(masterText()), 100)
    val (twice, more, verdict) = once.fetched(issued.single().id, FetchResult.Body(masterText()), 200)
    assertEquals(listOf(PlaylistRequest(2, variant)), variantRequests)
    assertEquals(once, twice)
    assertTrue(more.isEmpty())
    assertNull(verdict)
  }

  @Test
  fun `a new session ignores the answer to a request the old one sent`() {
    val (watch, issued) = DeliveryWatch(master).tick(0, onAirNow = true)
    val fresh = watch.newSession()
    val (after, more, verdict) = fresh.fetched(issued.single().id, FetchResult.Body(masterText()), 100)
    assertEquals(fresh, after)
    assertTrue(more.isEmpty())
    assertNull(verdict)
  }

  // Below: fix round 1. Segments that came and went unlisted are credited; an answer that lands off
  // air, a request given up and a poll with no evidence all claim nothing; the lag window is pinned.

  @Test
  fun `F-P5-13 a fetch outage longer than the listed window is not lag`() {
    // Healthy throughout; every fetch from 20.5 s to 79.5 s is a 503. At 80 s the playlist lists 138 to 140,
    // so 111 to 137 were never listed at a poll. They are credited at the configured 2 s.
    val harness = Harness(DeliveryWatch(master))
    val healthy = respond { t -> mediaText(100 + t / 2_000) }
    harness.run(0, 20_000, answer = healthy)
    harness.run(20_500, 79_500) { _, _ -> FetchResult.HttpError(503) }
    harness.run(80_000, 120_000, answer = healthy)
    assertNull(harness.verdict)
    assertEquals(Delivery.OK, harness.watch.delivery)
    assertEquals(120_000L, harness.watch.mediaMs, "heads 100 to 160: 60 segments of 2 s, 27 never listed at a poll")
    assertEquals(0L, harness.watch.deliveredLagMs)
  }

  @Test
  fun `F-P5-13 a drip hidden behind a fetch outage is lagging once fetches return`() {
    // One 2 s segment every 15 s, and every fetch fails from 0.5 s to 59.5 s. At 60 s the playlist lists 102 to
    // 104, so 101 went unlisted: 4 segments, 8 s, delivered in 60 s published. Lag growth: 60 − 8 = 52 s.
    val harness = Harness(DeliveryWatch(master))
    harness.run(0, 0, answer = respond { mediaText(100) })
    harness.run(500, 59_500) { _, _ -> FetchResult.Failed("timeout") }
    harness.run(60_000, 60_000, answer = respond { t -> mediaText(100 + t / 15_000) })
    val (at, verdict) = harness.verdict!!
    assertEquals(60_000L, at)
    assertEquals(NotDeliveredCause.LAGGING, verdict.cause)
    assertEquals(52_000L, verdict.lagGrowthMs)
  }

  @Test
  fun `a tick that comes 30 s late on a healthy stream is not lag`() {
    val harness = Harness(DeliveryWatch(master))
    val healthy = respond { t -> mediaText(100 + t / 2_000) }
    harness.run(0, 20_000, answer = healthy)
    harness.run(50_000, 60_000, answer = healthy)
    assertNull(harness.verdict)
    assertEquals(0L, harness.watch.deliveredLagMs)
  }

  @Test
  fun `F-P5-13 unlisted segments are credited no faster than publishing time`() {
    // Moving to 102 by 4 s; at 6 s the sequence has jumped and the playlist lists 120 to 122. 103 to 119 were
    // never listed, but only 2 s was published since the look at 4 s: they are credited 2 s, and the three
    // listed segments 6 s. Delivered: 4 + 2 + 6 = 12 s.
    val harness = Harness(DeliveryWatch(master))
    harness.run(0, 4_000, answer = respond { t -> mediaText(100 + t / 2_000) })
    harness.run(4_500, 6_000, answer = respond { mediaText(122) })
    assertEquals(12_000L, harness.watch.mediaMs)
  }

  @Test
  fun `a master answer that lands after going off air is dropped`() {
    val (watch, issued) = DeliveryWatch(master).tick(0, onAirNow = true)
    val (offAir, _) = watch.tick(500, onAirNow = false)
    val (after, more, verdict) = offAir.fetched(issued.single().id, FetchResult.Body(masterText()), 600)
    assertEquals(offAir, after)
    assertTrue(more.isEmpty(), "no variant fetch while off air")
    assertNull(verdict)
  }

  @Test
  fun `a variant answer that lands after going off air gives no verdict and claims nothing`() {
    // Frozen at 105 since 10 s. The 30 s poll's variant answer lands at 30.6 s, after going off air at 30.5 s,
    // by when 20.5 s of publishing had passed without an advance.
    val harness = Harness(DeliveryWatch(master))
    harness.run(0, 10_000, answer = respond { t -> mediaText(100 + t / 2_000) })
    harness.run(10_500, 28_000, answer = respond { mediaText(105) })
    val (polling, masterRequest) = harness.watch.tick(30_000, onAirNow = true)
    val (following, variantRequest, _) = polling.fetched(masterRequest.single().id, FetchResult.Body(masterText()), 30_000)
    val (offAir, _) = following.tick(30_500, onAirNow = false)
    val (after, _, verdict) = offAir.fetched(variantRequest.single().id, FetchResult.Body(mediaText(105)), 30_600)
    assertNull(verdict)
    assertEquals(Delivery.UNKNOWN, after.delivery)
  }

  @Test
  fun `a request given up unanswered withdraws an OK and its lag`() {
    val harness = Harness(DeliveryWatch(master))
    harness.run(0, 10_000, answer = respond { t -> mediaText(100 + t / 2_000) })
    harness.run(10_500, 22_000) { _, _ -> null }
    assertEquals(Delivery.UNKNOWN, harness.watch.delivery, "the 12 s poll was given up at 22 s")
    assertNull(harness.watch.deliveredLagMs)
  }

  @Test
  fun `delivery at two thirds of real time is lagging within the minute`() {
    // One 2 s segment every 3 s. Lag at a poll is t − 2000 × floor(t / 3000); its growth over the last 60 s
    // first reaches 20 000 at t = 56 000.
    val harness = Harness(DeliveryWatch(master))
    harness.run(0, 120_000, answer = respond { t -> mediaText(100 + t / 3_000) })
    val (at, verdict) = harness.verdict!!
    assertEquals(56_000L, at)
    assertEquals(NotDeliveredCause.LAGGING, verdict.cause)
  }

  @Test
  fun `delivery at 70 percent of real time never gains 20 s in a minute`() {
    // Seven 2 s segments per 20 s: over any 60 s the lag grows 18 s, plus at most 1.8 s of poll phase.
    val harness = Harness(DeliveryWatch(master))
    harness.run(0, 300_000, answer = respond { t -> mediaText(100 + t * 7 / 20_000) })
    assertNull(harness.verdict)
  }
}
