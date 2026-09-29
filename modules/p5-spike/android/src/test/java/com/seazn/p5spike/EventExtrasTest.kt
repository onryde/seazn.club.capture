package com.seazn.p5spike

import org.junit.Assert.assertEquals
import org.junit.Test

/** The output check's 404: the peek must get the real playback URL while the CSV keeps its mask. */
class EventExtrasTest {
  private val secret = "0123456789abcdef0123456789abcdef"
  private val scrub: (Any?) -> Any? = { value ->
    if (value == null || value is Number || value is Boolean) value else value.toString().replace(secret, "***")
  }

  @Test
  fun `a playback URL carrying the input id reaches JS verbatim and the CSV masked`() {
    val url = "https://customer-x.cloudflarestream.com/$secret/manifest/video.m3u8"

    val (csv, js) = EventExtras.split(listOf("playbackUrl" to url), scrub)

    assertEquals(listOf("playbackUrl" to "https://customer-x.cloudflarestream.com/***/manifest/video.m3u8"), csv)
    assertEquals(listOf("playbackUrl" to url), js)
  }

  @Test
  fun `an overlay URL reaches JS verbatim and the CSV masked`() {
    val url = "https://stg.seazn.club/overlay/fixtures/$secret"

    val (csv, js) = EventExtras.split(listOf("overlayUrl" to url), scrub)

    assertEquals(listOf("overlayUrl" to "https://stg.seazn.club/overlay/fixtures/***"), csv)
    assertEquals(listOf("overlayUrl" to url), js)
  }

  @Test
  fun `any other key carrying the secret is masked in both sinks`() {
    val extras = listOf("url" to "srt://h:1?streamid=$secret", "label" to "peek-default-error-$secret")

    val (csv, js) = EventExtras.split(extras, scrub)

    val masked = listOf("url" to "srt://h:1?streamid=***", "label" to "peek-default-error-***")
    assertEquals(masked, csv)
    assertEquals(masked, js)
  }

  @Test
  fun `a secret-free value is unchanged in both sinks`() {
    val extras = listOf("playbackUrl" to "https://example.test/a.m3u8", "reason" to "timeout")

    val (csv, js) = EventExtras.split(extras, scrub)

    assertEquals(extras, csv)
    assertEquals(extras, js)
  }

  @Test
  fun `null, numbers and booleans pass through in both sinks`() {
    val extras = listOf("error" to null, "count" to 3, "bitrate" to 2.5, "available" to true, "playbackUrl" to null)

    val (csv, js) = EventExtras.split(extras, scrub)

    assertEquals(extras, csv)
    assertEquals(extras, js)
  }

  @Test
  fun `the allow-list is exactly the two public URLs`() {
    assertEquals(setOf("playbackUrl", "overlayUrl"), EventExtras.PUBLIC_URL_KEYS)
  }

  @Test
  fun `order and keys are kept in both sinks`() {
    val extras = listOf("b" to "1", "playbackUrl" to "p", "a" to "2", "overlayUrl" to "o")

    val (csv, js) = EventExtras.split(extras, scrub)

    assertEquals(extras.map { it.first }, csv.map { it.first })
    assertEquals(extras.map { it.first }, js.map { it.first })
  }
}
