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
  }
}
