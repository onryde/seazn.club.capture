package com.seazn.capture.engine.core

/** Test sessions. The secrets are made up and distinctive, so a leak is easy to search for. */
object Configs {
  const val TOKEN = "tok-9f3c2a7e5b1d4680"
  const val PASSPHRASE = "pass+phrase/6d1e8b0c"
  const val STREAM_ID = "a1b2c3d4e5f60718293a4b5c6d7e8f90"
  const val STREAM_KEY = "key-4c7a0e2b9d5f1386"
  const val PLAYBACK_URL = "https://customer-x.cloudflarestream.com/$STREAM_ID/manifest/video.m3u8"

  val srt = SrtTarget("srt://live.cloudflare.com:778", STREAM_ID, PASSPHRASE, latencyMs = 2_000)
  val rtmps = RtmpsTarget("rtmps://live.cloudflare.com:443/live/", STREAM_KEY)

  fun valid(
    primary: IngestTarget = srt,
    fallback: IngestTarget? = rtmps,
    holdWindowSeconds: Map<Transport, Int> = mapOf(Transport.SRT to 183, Transport.RTMPS to 180),
  ) =
    SessionConfig(
      sid = "sess_42",
      token = TOKEN,
      primary = primary,
      fallback = fallback,
      holdWindowSeconds = holdWindowSeconds,
      playbackUrl = PLAYBACK_URL,
      heartbeatUrl = "https://stg.seazn.club/api/capture/heartbeat",
      appVersion = "1.0.0",
    )
}
