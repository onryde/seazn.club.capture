package com.seazn.capture.engine.core

/** What the platform's HTTP client got for one playlist request. */
sealed interface FetchResult {
  data class Body(val text: String) : FetchResult

  /** 204: Cloudflare serves this when no variant is live (P5, F-P5-3's 11:05:55Z). */
  data object NoContent : FetchResult

  data class HttpError(val status: Int) : FetchResult

  data class Failed(val message: String) : FetchResult
}

data class PlaylistRequest(val id: Int, val url: String)

enum class NotDeliveredCause(override val wire: String) : Wire {
  /** The head has not moved for [DeliveryWatch.NOT_DELIVERED_MS] of publishing. */
  STALLED("stalled"),

  /** It moves, but delivered media falls behind publishing time (the final soak's drip). */
  LAGGING("lagging"),
}

data class NotDelivered(val cause: NotDeliveredCause, val stalledMs: Long, val lagGrowthMs: Long?)

data class LagPoint(val onAirMs: Long, val lagMs: Long)

/**
 * F-P5-13: an ingest session Cloudflare accepts can stop being delivered at any time, and neither
 * the phone's transport nor Cloudflare's status API sees it. This watches the delivered playlist,
 * polling the master every [POLL_MS] and re-resolving it on every poll, and compares delivered media
 * time with publishing time.
 *
 * - Manifests are dynamic: Cloudflare says never to cache, proxy or store them. Every poll is a fresh
 *   fetch of the master (plan C's HTTP client runs with its cache off), and a variant URL is only
 *   ever the one the latest master named.
 * - The master is asked for one rendition with a low `clientBandwidthHint`, so the watch follows
 *   the same rendition from poll to poll. It never downloads a segment, so the rendition's size
 *   costs nothing.
 * - Plain HLS and LL-HLS are both read. Delivered media time is completed segments plus the parts
 *   published after them; a part that rolls into a completed segment is counted once. Segments that came
 *   and went unlisted between two polls (a fetch outage, a late tick) are credited at the configured segment.
 *
 * - Only publishing time counts: an outage is the hold clock's, not a delivery stall.
 * - A variant change is not progress, and does not reset the stall clock (F-P5-2).
 * - The thresholds come from the segment we configure, never the playlist's `targetDuration`,
 *   which only grows as a stream goes wrong (F-P5-4).
 * - `EXT-X-ENDLIST` never means ended (H-P5-1).
 * - A failed, abandoned or unreadable fetch is no evidence either way: it never means not-delivered, and it
 *   withdraws any claim. An answer that lands after going off air is dropped.
 */
data class DeliveryWatch(
  /** The session's playback URL: the master, as Cloudflare hands it to every viewer. */
  val playbackUrl: String,
  val nextPollAtMs: Long = 0,
  val pending: PlaylistRequest? = null,
  val pendingIsMaster: Boolean = true,
  val pendingSinceMs: Long = 0,
  val nextRequestId: Int = 1,
  val lastTickMs: Long? = null,
  val onAir: Boolean = false,
  /** Publishing time accumulated over the session. */
  val onAirMs: Long = 0,
  /** Publishing time since the head last moved. */
  val sinceAdvanceMs: Long = 0,
  val variantUrl: String? = null,
  val head: Long? = null,
  /** LL-HLS parts past [head] at the last observation; 0 for plain HLS. */
  val partsMs: Long = 0,
  val advancedInVariant: Boolean = false,
  val mediaMs: Long = 0,
  val baselineOnAirMs: Long = 0,
  val lags: List<LagPoint> = emptyList(),
  val minLagMs: Long? = null,
  val delivery: Delivery = Delivery.UNKNOWN,
  val deliveredLagMs: Long? = null,
) {
  /** What is polled: the master, restricted to one rendition. */
  val pollUrl: String = hinted(playbackUrl)

  fun tick(nowMs: Long, onAirNow: Boolean): Pair<DeliveryWatch, List<PlaylistRequest>> {
    val elapsed = lastTickMs?.let { if (onAir) nowMs - it else 0 } ?: 0
    var next =
      copy(lastTickMs = nowMs, onAir = onAirNow, onAirMs = onAirMs + elapsed, sinceAdvanceMs = sinceAdvanceMs + elapsed)
    if (!onAirNow) return next.copy(pending = null).withoutEvidence() to emptyList()
    if (next.pending != null && nowMs - next.pendingSinceMs >= REQUEST_TIMEOUT_MS) {
      next = next.copy(pending = null).withoutEvidence()
    }
    if (next.pending != null || nowMs < next.nextPollAtMs) return next to emptyList()
    val request = PlaylistRequest(next.nextRequestId, pollUrl)
    return next.copy(
      pending = request,
      pendingIsMaster = true,
      pendingSinceMs = nowMs,
      nextRequestId = next.nextRequestId + 1,
      nextPollAtMs = nowMs + POLL_MS,
    ) to listOf(request)
  }

  /** The answer to a request. A stale id is ignored. The request list is the variant fetch, when there is one. */
  fun fetched(requestId: Int, result: FetchResult, nowMs: Long): Triple<DeliveryWatch, List<PlaylistRequest>, NotDelivered?> {
    if (pending?.id != requestId) return Triple(this, emptyList(), null)
    val cleared = copy(pending = null)
    val playlist = (result as? FetchResult.Body)?.let { PlaylistParser.parse(it.text) }
    return when {
      result == FetchResult.NoContent && pendingIsMaster -> cleared.nothingLive()
      playlist is Playlist.Master && pendingIsMaster -> cleared.fetchVariant(playlist, nowMs)
      playlist is Playlist.Media -> cleared.observed(pending.url, playlist)
      else -> Triple(cleared.withoutEvidence(), emptyList(), null)
    }
  }

  /** After a forced new session: the new session proves itself from zero. */
  fun newSession(): DeliveryWatch =
    copy(
      pending = null,
      sinceAdvanceMs = 0,
      variantUrl = null,
      head = null,
      partsMs = 0,
      advancedInVariant = false,
      mediaMs = 0,
      lags = emptyList(),
      minLagMs = null,
      delivery = Delivery.UNKNOWN,
      deliveredLagMs = null,
    )

  private fun fetchVariant(master: Playlist.Master, nowMs: Long): Triple<DeliveryWatch, List<PlaylistRequest>, NotDelivered?> {
    val url = PlaylistParser.resolve(pollUrl, master.variants.first())
      ?: return Triple(withoutEvidence(), emptyList(), null)
    val request = PlaylistRequest(nextRequestId, url)
    val next = copy(pending = request, pendingIsMaster = false, pendingSinceMs = nowMs, nextRequestId = nextRequestId + 1)
    return Triple(next, listOf(request), null)
  }

  private fun nothingLive(): Triple<DeliveryWatch, List<PlaylistRequest>, NotDelivered?> {
    val next = copy(delivery = stalledOr(Delivery.UNKNOWN), deliveredLagMs = null)
    val verdict = if (sinceAdvanceMs >= NOT_DELIVERED_MS) NotDelivered(NotDeliveredCause.STALLED, sinceAdvanceMs, null) else null
    return Triple(next, emptyList(), verdict)
  }

  private fun observed(url: String, media: Playlist.Media): Triple<DeliveryWatch, List<PlaylistRequest>, NotDelivered?> {
    val moved = advancedBy(url, media)
    val lagMs = moved.onAirMs - moved.baselineOnAirMs - moved.mediaMs
    val lags = (moved.lags + LagPoint(moved.onAirMs, lagMs)).filter { it.onAirMs >= moved.onAirMs - LAG_WINDOW_MS }
    val minLag = minOf(moved.minLagMs ?: lagMs, lagMs)
    val growth = lagMs - lags.minOf { it.lagMs }
    val delivery = if (moved.advancedInVariant) moved.stalledOr(Delivery.OK) else moved.stalledOr(Delivery.UNKNOWN)
    val next = moved.copy(lags = lags, minLagMs = minLag, delivery = delivery, deliveredLagMs = lagMs - minLag)
    val verdict =
      when {
        next.sinceAdvanceMs >= NOT_DELIVERED_MS -> NotDelivered(NotDeliveredCause.STALLED, next.sinceAdvanceMs, growth)
        growth >= LAG_GROWTH_LIMIT_MS -> NotDelivered(NotDeliveredCause.LAGGING, next.sinceAdvanceMs, growth)
        else -> null
      }
    return Triple(next, emptyList(), verdict)
  }

  /**
   * Positions compare only within one variant. A new variant is a new baseline and not progress.
   * The position is the head plus its trailing parts: a new part is progress, and when parts roll
   * into a completed segment, the parts already counted are taken off that segment's duration. Segments
   * that came and went unlisted are credited by [unlistedMs].
   */
  private fun advancedBy(url: String, media: Playlist.Media): DeliveryWatch {
    val previous = head
    if (url != variantUrl || previous == null || media.head < previous) {
      return copy(
        variantUrl = url,
        head = media.head,
        partsMs = media.partsMs,
        advancedInVariant = false,
        mediaMs = 0,
        baselineOnAirMs = onAirMs,
        lags = emptyList(),
        minLagMs = null,
      )
    }
    if (media.head == previous && media.partsMs <= partsMs) return this
    val firstNew = (previous + 1 - media.mediaSequence).coerceAtLeast(0).toInt()
    val listedMs = media.segmentDurationsMs.drop(firstNew).sum()
    val added = (unlistedMs(previous, media.mediaSequence) + listedMs - partsMs + media.partsMs).coerceAtLeast(0)
    return copy(head = media.head, partsMs = media.partsMs, mediaMs = mediaMs + added, sinceAdvanceMs = 0, advancedInVariant = true)
  }

  /**
   * The segments after [previous] and before [firstListed]: they came and went between two looks without
   * ever being listed, in a fetch outage longer than the playlist's window or behind a late tick (F-P5-13).
   * Each is credited at the configured segment, and all of them together never at more than the publishing
   * time since the last look, so a sequence that jumps is not media. [lags] ends with that look: every
   * observation adds one, and what empties it (a rebaseline, a new session) makes the next look a rebaseline.
   */
  private fun unlistedMs(previous: Long, firstListed: Long): Long {
    val count = (firstListed - previous - 1).coerceAtLeast(0)
    return minOf(count * CONFIGURED_SEGMENT_MS, onAirMs - lags.last().onAirMs)
  }

  /** No evidence either way: delivery claims nothing, and shows no lag. */
  private fun withoutEvidence(): DeliveryWatch = copy(delivery = Delivery.UNKNOWN, deliveredLagMs = null)

  private fun stalledOr(otherwise: Delivery): Delivery = if (sinceAdvanceMs >= STALLED_AFTER_MS) Delivery.STALLED else otherwise

  companion object {
    /** "Polls the variant playlist every ~2 s" (spec §3). */
    const val POLL_MS = 2_000L

    /** The segment we configure: Cloudflare's ~2 s segments (P5 Run A: 996 of 998 at ~2 s). */
    const val CONFIGURED_SEGMENT_MS = 2_000L

    /**
     * Three configured segments (F-P5-4's fix, 6 s). Healthy cells never went 4.63 s between advances.
     * The same for LL-HLS: a part target (~0.3 s) would call every hiccup a stall.
     */
    const val STALLED_AFTER_MS = 3 * CONFIGURED_SEGMENT_MS

    /** "A stall of about 20 s … means not-delivered" (spec §3; F-P5-13's "~20 s"). */
    const val NOT_DELIVERED_MS = 10 * CONFIGURED_SEGMENT_MS

    /** Delivered media falling 20 s further behind publishing within one minute. */
    const val LAG_GROWTH_LIMIT_MS = 20_000L
    const val LAG_WINDOW_MS = 60_000L

    /** A request unanswered this long is abandoned, so a hung fetch never stops the watch. */
    const val REQUEST_TIMEOUT_MS = 10_000L

    /** Mbps. Low, so Cloudflare answers with its lowest rendition, the one every ladder has. */
    const val BANDWIDTH_HINT_MBPS = "0.1"

    /** [url] with `clientBandwidthHint` added to whatever query it already has. */
    fun hinted(url: String): String {
      val separator = if ('?' in url) '&' else '?'
      return "$url${separator}clientBandwidthHint=$BANDWIDTH_HINT_MBPS"
    }
  }
}
