package com.seazn.capture.engine.core

/**
 * Cloudflare Stream's live playback as the web lane read it on stg (cf-playback-shape.md, session 20fd049d,
 * 2026-10-05). The playback URL is a master: one audio `EXT-X-MEDIA` whose URI is an attribute, then four
 * renditions, 720p first, each URI relative to `…/manifest/` and shaped `<token>.m3u8?llhlsHBs=0.9&lps=<16 hex>&rcu=<13 digits>`.
 * The master's text changes on every fetch, in `lps` and `rcu` alone. A rendition is a media playlist with
 * `EXT-X-TARGETDURATION:3` and a `EXT-X-MEDIA-SEQUENCE` that advanced 97 to 106 in 15 s while live.
 *
 * Every token and query value here is made up; only the shapes are Cloudflare's.
 */
object CloudflarePlayback {
  /** The opaque rendition tokens, 720p first as the master lists them, and the audio group's. */
  val RENDITIONS = listOf(720, 480, 360, 240).map { "${token("v$it")}.m3u8" }
  val AUDIO = "${token("a128")}.m3u8"

  /** The renditions' resolutions and bandwidths, 720p down to 240p (the master's order). */
  private val LADDER =
    listOf("1280x720" to 3_128_000, "854x480" to 1_628_000, "640x360" to 928_000, "426x240" to 428_000)

  /** One fetch of the master: the structure fixed, `lps` and `rcu` new on every [fetch]. [renditions] in the master's order. */
  fun master(fetch: Int, renditions: List<String> = RENDITIONS): String {
    val query = query(fetch)
    val listed =
      renditions.zip(LADDER).joinToString("") { (uri, rung) ->
        "#EXT-X-STREAM-INF:RESOLUTION=${rung.first},CODECS=\"avc1.4d401f,mp4a.40.2\",BANDWIDTH=${rung.second},FRAME-RATE=30.000,AUDIO=\"group_audio\"\n" +
          "$uri?$query\n"
      }
    return "#EXTM3U\n#EXT-X-VERSION:6\n#EXT-X-INDEPENDENT-SEGMENTS\n" +
      "#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID=\"group_audio\",NAME=\"original\",LANGUAGE=\"und\",DEFAULT=YES,AUTOSELECT=YES,URI=\"$AUDIO?$query\"\n" +
      listed
  }

  /** A rendition's media playlist: three 2 s segments ending at [head], no `EXT-X-ENDLIST` (none came after the stop either). */
  fun rendition(head: Long): String {
    val first = head - 2
    val segments = (first..head).joinToString("") { "#EXTINF:2.000,\n${token("s")}_$it.m4s\n" }
    return "#EXTM3U\n#EXT-X-VERSION:6\n#EXT-X-TARGETDURATION:3\n#EXT-X-MEDIA-SEQUENCE:$first\n$segments"
  }

  /** [url] without its query: what stays the same from fetch to fetch. */
  fun path(url: String): String = url.substringBefore('?')

  private fun query(fetch: Int): String {
    val lps = "%016x".format(0x5eaf00d000L + fetch * 7_919L)
    val rcu = 1_790_000_000_000L + fetch * 1_700L
    return "llhlsHBs=0.9&lps=$lps&rcu=$rcu"
  }

  /** A made-up opaque token of 104 characters, as long as Cloudflare's. */
  private fun token(seed: String): String = (seed + "-made-up-token-").repeat(12).take(104)
}
