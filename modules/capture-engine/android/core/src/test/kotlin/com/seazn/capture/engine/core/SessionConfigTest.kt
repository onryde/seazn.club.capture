package com.seazn.capture.engine.core

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
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
}
