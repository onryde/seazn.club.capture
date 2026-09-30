package com.seazn.capture.engine.core

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertIs
import kotlin.test.assertNull
import kotlin.test.assertTrue

class PlaylistParserTest {
  @Test
  fun `a master lists its variants in order`() {
    val text =
      """
      #EXTM3U
      #EXT-X-VERSION:6
      #EXT-X-STREAM-INF:BANDWIDTH=3128000,RESOLUTION=1280x720,CODECS="avc1.64001f,mp4a.40.2"
      stream_720/video.m3u8?p=1
      #EXT-X-STREAM-INF:BANDWIDTH=928000,RESOLUTION=640x360
      stream_360/video.m3u8?p=1
      """.trimIndent()
    assertEquals(Playlist.Master(listOf("stream_720/video.m3u8?p=1", "stream_360/video.m3u8?p=1")), PlaylistParser.parse(text))
  }

  @Test
  fun `a media playlist gives its sequence, segment durations and head`() {
    val text =
      """
      #EXTM3U
      #EXT-X-TARGETDURATION:2
      #EXT-X-MEDIA-SEQUENCE:150
      #EXTINF:2.000,
      seg150.ts
      #EXTINF:2.000,
      seg151.ts
      #EXTINF:1.750,
      seg152.ts
      """.trimIndent()
    val media = assertIs<Playlist.Media>(PlaylistParser.parse(text))
    assertEquals(2, media.targetDurationS)
    assertEquals(listOf(2_000L, 2_000L, 1_750L), media.segmentDurationsMs)
    assertEquals(152L, media.head)
    assertEquals(false, media.endList)
  }

  @Test
  fun `H-P5-1 EXT-X-ENDLIST is read and is still just a media playlist`() {
    val text = "#EXTM3U\n#EXT-X-TARGETDURATION:2\n#EXT-X-MEDIA-SEQUENCE:7\n#EXTINF:2.0,\na.ts\n#EXT-X-ENDLIST\n"
    val media = assertIs<Playlist.Media>(PlaylistParser.parse(text))
    assertEquals(true, media.endList)
    assertEquals(7L, media.head)
  }

  @Test
  fun `a plain HLS playlist is not low-latency, even with a server-control tag`() {
    val text = "#EXTM3U\n#EXT-X-TARGETDURATION:2\n#EXT-X-SERVER-CONTROL:CAN-SKIP-UNTIL=12.0\n#EXTINF:2.0,\na.ts\n"
    val media = assertIs<Playlist.Media>(PlaylistParser.parse(text))
    assertFalse(media.lowLatency)
    assertNull(media.partTargetMs)
    assertEquals(0L, media.partsMs)
  }

  @Test
  fun `an LL-HLS playlist counts parts before a segment in its EXTINF, and parts after it as trailing`() {
    val text =
      """
      #EXTM3U
      #EXT-X-TARGETDURATION:4
      #EXT-X-SERVER-CONTROL:CAN-BLOCK-RELOAD=YES,PART-HOLD-BACK=1.0
      #EXT-X-PART-INF:PART-TARGET=0.5
      #EXT-X-MEDIA-SEQUENCE:3
      #EXT-X-PROGRAM-DATE-TIME:2026-09-30T14:32:05.123Z
      #EXT-X-PART:DURATION=0.5,URI="p3.0.mp4",INDEPENDENT=YES
      #EXT-X-PART:DURATION=0.5,URI="p3.1.mp4"
      #EXTINF:2.002,
      s3.mp4
      #EXT-X-PART:DURATION=0.5006,URI="p4.0.mp4",INDEPENDENT=YES
      #EXT-X-PART:DURATION=0.4,URI="p4.1.mp4"
      #EXT-X-PART:DURATION=0.5,URI="p4.2.mp4",GAP=YES
      #EXT-X-PRELOAD-HINT:TYPE=PART,URI="p4.3.mp4"
      #EXT-X-RENDITION-REPORT:URI="../360/video.m3u8",LAST-MSN=4,LAST-PART=2
      """.trimIndent()
    val media = assertIs<Playlist.Media>(PlaylistParser.parse(text))
    assertTrue(media.lowLatency)
    assertEquals(500L, media.partTargetMs)
    assertEquals(listOf(2_002L), media.segmentDurationsMs)
    assertEquals(3L, media.head)
    assertEquals(listOf(501L, 400L), media.trailingPartsMs, "a gap part carries no media; a preload hint is not a part")
    assertEquals(901L, media.partsMs)
  }

  @Test
  fun `parts with no part-info tag still make it LL-HLS`() {
    val text = "#EXTM3U\n#EXT-X-TARGETDURATION:2\n#EXT-X-PART:DURATION=0.333,URI=\"a.mp4\"\n"
    val media = assertIs<Playlist.Media>(PlaylistParser.parse(text))
    assertTrue(media.lowLatency)
    assertEquals(listOf(333L), media.trailingPartsMs)
  }

  @Test
  fun `a malformed part is invalid, never a crash`() {
    assertEquals(Playlist.Invalid("bad EXT-X-PART"), PlaylistParser.parse("#EXTM3U\n#EXT-X-TARGETDURATION:2\n#EXT-X-PART:DURATION=x,URI=\"a\"\n"))
    assertEquals(Playlist.Invalid("bad EXT-X-PART"), PlaylistParser.parse("#EXTM3U\n#EXT-X-TARGETDURATION:2\n#EXT-X-PART:DURATION=0.5\n"))
  }

  @Test
  fun `a media playlist with no segments yet has its head before the sequence`() {
    val media = assertIs<Playlist.Media>(PlaylistParser.parse("#EXTM3U\n#EXT-X-TARGETDURATION:2\n#EXT-X-MEDIA-SEQUENCE:40\n"))
    assertEquals(39L, media.head)
  }

  @Test
  fun `CRLF line endings parse`() {
    val media = PlaylistParser.parse("#EXTM3U\r\n#EXT-X-TARGETDURATION:2\r\n#EXTINF:2.0,\r\na.ts\r\n")
    assertEquals(listOf(2_000L), assertIs<Playlist.Media>(media).segmentDurationsMs)
  }

  @Test
  fun `empty, blank, foreign and malformed text is invalid, never a crash`() {
    assertEquals(Playlist.Invalid("empty"), PlaylistParser.parse(""))
    assertEquals(Playlist.Invalid("empty"), PlaylistParser.parse("  \n\t\n"))
    assertEquals(Playlist.Invalid("no #EXTM3U"), PlaylistParser.parse("<html>403 error code: 1010</html>"))
    assertEquals(Playlist.Invalid("neither a master nor a media playlist"), PlaylistParser.parse("#EXTM3U\n"))
    assertEquals(Playlist.Invalid("bad EXTINF"), PlaylistParser.parse("#EXTM3U\n#EXT-X-TARGETDURATION:2\n#EXTINF:abc,\na.ts\n"))
    assertEquals(Playlist.Invalid("bad EXTINF"), PlaylistParser.parse("#EXTM3U\n#EXT-X-TARGETDURATION:2\n#EXTINF:2.0,\n"))
    assertEquals(Playlist.Invalid("master without variants"), PlaylistParser.parse("#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1\n"))
  }

  @Test
  fun `variant URIs resolve against the master URL`() {
    val master = "https://customer-x.cloudflarestream.com/abc/manifest/video.m3u8"
    assertEquals(
      "https://customer-x.cloudflarestream.com/abc/manifest/stream_720/video.m3u8?p=1",
      PlaylistParser.resolve(master, "stream_720/video.m3u8?p=1"),
    )
    assertEquals("https://other.example/v.m3u8", PlaylistParser.resolve(master, "https://other.example/v.m3u8"))
    assertEquals("https://customer-x.cloudflarestream.com/root.m3u8", PlaylistParser.resolve(master, "/root.m3u8"))
    assertNull(PlaylistParser.resolve(master, "has space.m3u8"))
  }

  // Below: added in B4's mutation pass, each killing a mutant the tests above left alive.

  @Test
  fun `a tag after a stream-inf is never taken for a variant URI`() {
    val text = "#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=928000\n#EXT-X-STREAM-INF:BANDWIDTH=3128000\nstream_720/video.m3u8\n"
    assertEquals(Playlist.Master(listOf("stream_720/video.m3u8")), PlaylistParser.parse(text))
  }

  @Test
  fun `a media playlist with no sequence tag starts at 0`() {
    // RFC 8216 §4.3.3.2: with no EXT-X-MEDIA-SEQUENCE, the first segment's number "SHALL be considered to be 0".
    val media = assertIs<Playlist.Media>(PlaylistParser.parse("#EXTM3U\n#EXT-X-TARGETDURATION:2\n#EXTINF:2.0,\na.ts\n"))
    assertEquals(0L, media.mediaSequence)
    assertEquals(0L, media.head)
  }

  @Test
  fun `a part-info tag with no part listed yet is still LL-HLS`() {
    val text = "#EXTM3U\n#EXT-X-TARGETDURATION:2\n#EXT-X-PART-INF:PART-TARGET=0.5\n#EXTINF:2.0,\na.mp4\n"
    val media = assertIs<Playlist.Media>(PlaylistParser.parse(text))
    assertTrue(media.lowLatency)
    assertEquals(0L, media.partsMs)
  }

  @Test
  fun `a negative segment, and a negative or infinite part, is invalid`() {
    assertEquals(Playlist.Invalid("bad EXTINF"), PlaylistParser.parse("#EXTM3U\n#EXT-X-TARGETDURATION:2\n#EXTINF:-2.0,\na.ts\n"))
    assertEquals(
      Playlist.Invalid("bad EXT-X-PART"),
      PlaylistParser.parse("#EXTM3U\n#EXT-X-TARGETDURATION:2\n#EXT-X-PART:DURATION=-0.5,URI=\"a.mp4\"\n"),
    )
    assertEquals(
      Playlist.Invalid("bad EXT-X-PART"),
      PlaylistParser.parse("#EXTM3U\n#EXT-X-TARGETDURATION:2\n#EXT-X-PART:DURATION=Infinity,URI=\"a.mp4\"\n"),
    )
  }
}
