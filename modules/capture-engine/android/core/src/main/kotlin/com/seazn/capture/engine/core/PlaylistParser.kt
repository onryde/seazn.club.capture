package com.seazn.capture.engine.core

import java.net.URI

sealed interface Playlist {
  /** A master playlist: its variant URIs as written, in order. */
  data class Master(val variants: List<String>) : Playlist

  /**
   * A media playlist, plain HLS or LL-HLS. Which one is read from the playlist itself, never
   * assumed: LL-HLS exists only on inputs created with low latency enabled, which S1 does not know.
   *
   * [segmentDurationsMs] are the completed segments. [trailingPartsMs] are the LL-HLS parts
   * published after the last completed segment: media a player can already fetch, of a segment not
   * yet complete. Parts listed before a segment belong to it and are counted once, in its `EXTINF`.
   *
   * [endList] is parsed and reported, and means nothing about the session: Cloudflare never served
   * `EXT-X-ENDLIST` at a 180 s timeout (H-P5-1, P5 Run A).
   */
  data class Media(
    val targetDurationS: Int?,
    val mediaSequence: Long,
    val segmentDurationsMs: List<Long>,
    val endList: Boolean,
    val lowLatency: Boolean = false,
    val partTargetMs: Long? = null,
    val trailingPartsMs: List<Long> = emptyList(),
  ) : Playlist {
    /** The newest completed segment's sequence number; one before [mediaSequence] when there is none. */
    val head: Long
      get() = mediaSequence + segmentDurationsMs.size - 1

    /** Media past [head]: the trailing parts. Always 0 for plain HLS. */
    val partsMs: Long
      get() = trailingPartsMs.sum()
  }

  data class Invalid(val reason: String) : Playlist
}

/**
 * The HLS text the delivery watch reads (F-P5-13). Pure: the platform fetches, this only reads.
 * Handles plain HLS and LL-HLS (`EXT-X-PART`, `EXT-X-PART-INF`, `EXT-X-SERVER-CONTROL`); a preload
 * hint is a promise of a part, not a part, and is not delivered media.
 */
object PlaylistParser {
  private const val STREAM_INF = "#EXT-X-STREAM-INF"
  private const val TARGET_DURATION = "#EXT-X-TARGETDURATION:"
  private const val MEDIA_SEQUENCE = "#EXT-X-MEDIA-SEQUENCE:"
  private const val EXTINF = "#EXTINF:"
  private const val ENDLIST = "#EXT-X-ENDLIST"
  private const val PART = "#EXT-X-PART:"
  private const val PART_INF = "#EXT-X-PART-INF:"

  /** The longest duration read, in seconds. No live segment or part is an hour long; past that it is garbage. */
  private const val MAX_DURATION_S = 3_600.0
  private val ATTRIBUTE = Regex("""([A-Z0-9-]+)=("[^"]*"|[^,]*)""")

  fun parse(text: String): Playlist {
    val lines = text.lines().map { it.trim() }.filter { it.isNotEmpty() }
    if (lines.isEmpty()) return Playlist.Invalid("empty")
    if (lines.first() != "#EXTM3U") return Playlist.Invalid("no #EXTM3U")
    return if (lines.any { it.startsWith(STREAM_INF) }) master(lines) else media(lines)
  }

  /** A variant URI against the master's URL. Null when either cannot be read as a URI. */
  fun resolve(baseUrl: String, reference: String): String? =
    runCatching { URI(baseUrl).resolve(URI(reference)).toString() }.getOrNull()

  /** Each `EXT-X-STREAM-INF` takes the next line that is not a tag or comment; a URI line nothing announced is ignored. */
  private fun master(lines: List<String>): Playlist {
    val uris = mutableListOf<String>()
    var announced = false
    for (line in lines) {
      when {
        line.startsWith(STREAM_INF) -> announced = true
        announced && !line.startsWith("#") -> {
          uris += line
          announced = false
        }
      }
    }
    return if (uris.isEmpty()) Playlist.Invalid("master without variants") else Playlist.Master(uris)
  }

  /**
   * A segment is its tags, then its URI (RFC 8216 §4.3.2): an `EXTINF` waits for the next line that is not a
   * tag or comment. Exactly one `EXTINF` per URI, and parts listed before a URI are that segment's.
   */
  private fun media(lines: List<String>): Playlist {
    val target = lines.firstOrNull { it.startsWith(TARGET_DURATION) }?.removePrefix(TARGET_DURATION)?.toIntOrNull()
      ?: return Playlist.Invalid("neither a master nor a media playlist")
    val sequence = lines.firstOrNull { it.startsWith(MEDIA_SEQUENCE) }?.removePrefix(MEDIA_SEQUENCE)?.toLongOrNull() ?: 0
    val partTarget = lines.firstOrNull { it.startsWith(PART_INF) }?.let { seconds(attributes(it.removePrefix(PART_INF))["PART-TARGET"]) }
    val durations = mutableListOf<Long>()
    val parts = mutableListOf<Long>()
    var extinf: Long? = null
    for (line in lines) {
      when {
        line.startsWith(PART) -> parts += part(line) ?: return Playlist.Invalid("bad EXT-X-PART")
        line.startsWith(EXTINF) -> {
          if (extinf != null) return Playlist.Invalid("bad EXTINF")
          extinf = seconds(line.removePrefix(EXTINF).substringBefore(',')) ?: return Playlist.Invalid("bad EXTINF")
        }
        !line.startsWith("#") -> {
          durations += extinf ?: return Playlist.Invalid("bad EXTINF")
          extinf = null
          parts.clear()
        }
      }
    }
    if (extinf != null) return Playlist.Invalid("bad EXTINF")
    val lowLatency = partTarget != null || lines.any { it.startsWith(PART) }
    return Playlist.Media(target, sequence, durations, lines.any { it == ENDLIST }, lowLatency, partTarget, parts.filter { it >= 0 })
  }

  /** A part's duration; -1 for a gap, which is listed but carries no media. Null when malformed. */
  private fun part(line: String): Long? {
    val attributes = attributes(line.removePrefix(PART))
    val duration = seconds(attributes["DURATION"]) ?: return null
    if (attributes["URI"] == null) return null
    return if (attributes["GAP"] == "YES") -1 else duration
  }

  /** Milliseconds, for a number of seconds from 0 to [MAX_DURATION_S]. NaN and the infinities are outside it. */
  private fun seconds(value: String?): Long? =
    value?.toDoubleOrNull()?.takeIf { it in 0.0..MAX_DURATION_S }?.let { Math.round(it * 1_000) }

  private fun attributes(list: String): Map<String, String> =
    ATTRIBUTE.findAll(list).associate { it.groupValues[1] to it.groupValues[2] }
}
