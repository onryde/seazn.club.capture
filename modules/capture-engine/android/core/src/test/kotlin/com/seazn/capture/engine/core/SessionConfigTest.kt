package com.seazn.capture.engine.core

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertSame
import kotlin.test.assertTrue

class SessionConfigTest {
  @Test
  fun `a complete config has no problems`() {
    assertEquals(emptyList(), Configs.valid().problems())
  }

  @Test
  fun `an empty descriptor field is a problem, not a crash`() {
    val empty =
      SessionConfig(
        sid = "",
        token = "",
        primary = SrtTarget("", "", "", 0),
        fallback = RtmpsTarget("", ""),
        holdWindowSeconds = emptyMap(),
        playbackUrl = "",
        heartbeatUrl = "",
        appVersion = "",
      )
    assertEquals(
      listOf(
        "sid is blank",
        "token is blank",
        "playbackUrl is not https",
        "heartbeatUrl is not https",
        "no hold window for srt",
        "srt url is blank",
        "srt streamId is blank",
        "srt passphrase is not 10–79 characters",
        "srt latencyMs is not positive",
        "no hold window for rtmps",
        "rtmps url is blank",
        "rtmps streamKey is blank",
      ),
      empty.problems(),
    )
  }

  @Test
  fun `a fallback on the same transport as the primary is a problem`() {
    assertTrue("fallback repeats the primary transport" in Configs.valid(fallback = Configs.srt).problems())
  }

  @Test
  fun `no secret appears in any toString`() {
    val printed = listOf(Configs.valid().toString(), Configs.srt.toString(), Configs.rtmps.toString())
    for (secret in listOf(Configs.TOKEN, Configs.PASSPHRASE, Configs.STREAM_ID, Configs.STREAM_KEY)) {
      assertFalse(printed.any { secret in it }, "leaked $secret")
    }
  }

  @Test
  fun `secrets are the token, the SRT passphrase and stream id, and the RTMPS stream key`() {
    assertEquals(
      setOf(Configs.TOKEN, Configs.PASSPHRASE, Configs.STREAM_ID, Configs.STREAM_KEY),
      Configs.valid().secrets().toSet(),
    )
  }

  // Every string contains "", so a blank secret would mask whatever the record met.
  @Test
  fun `a blank value is not a secret`() {
    val blankKey = Configs.valid(fallback = RtmpsTarget("rtmps://live.cloudflare.com:443/live/", ""))
    assertEquals(setOf(Configs.TOKEN, Configs.PASSPHRASE, Configs.STREAM_ID), blankKey.secrets().toSet())
  }

  // The heartbeat carries the Bearer tok, and playbackUrl is https (spec, "Ask: for the web side").
  @Test
  fun `a plain-http playback or heartbeat URL is a problem`() {
    val plain =
      SessionConfig(
        sid = "sess_42",
        token = Configs.TOKEN,
        primary = Configs.srt,
        fallback = Configs.rtmps,
        holdWindowSeconds = mapOf(Transport.SRT to 183, Transport.RTMPS to 180),
        playbackUrl = "http://customer-x.cloudflarestream.com/${Configs.STREAM_ID}/manifest/video.m3u8",
        heartbeatUrl = "http://stg.seazn.club/api/capture/heartbeat",
        appVersion = "1.0.0",
      )
    assertEquals(listOf("playbackUrl is not https", "heartbeatUrl is not https"), plain.problems())
  }

  @Test
  fun `a hold window that is not positive is a problem`() {
    val windows = mapOf(Transport.SRT to 0, Transport.RTMPS to -1)
    assertEquals(
      listOf("no hold window for srt", "no hold window for rtmps"),
      Configs.valid(holdWindowSeconds = windows).problems(),
    )
  }

  // libsrt takes a passphrase of 10–79 characters (P5 results, F-P5-1's ruled-out list).
  @Test
  fun `an SRT passphrase of 10 or 79 characters is fine, and 9 or 80 is a problem`() {
    fun problemsWith(length: Int) =
      Configs.valid(primary = SrtTarget(Configs.srt.url, Configs.STREAM_ID, "p".repeat(length), 2_000)).problems()
    val outOfRange = listOf("srt passphrase is not 10–79 characters")
    assertEquals(outOfRange, problemsWith(9))
    assertEquals(emptyList(), problemsWith(10))
    assertEquals(emptyList(), problemsWith(79))
    assertEquals(outOfRange, problemsWith(80))
  }

  @Test
  fun `target is the transport's own, and none when there is no fallback`() {
    assertSame(Configs.rtmps, Configs.valid().target(Transport.RTMPS))
    assertSame(Configs.srt, Configs.valid().target(Transport.SRT))
    assertNull(Configs.valid(fallback = null).target(Transport.RTMPS))
  }
}
