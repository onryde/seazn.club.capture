package com.seazn.capture.engine.core

/** Test sessions. The secrets are made up and distinctive, so a leak is easy to search for. */
object Configs {
  const val TOKEN = "tok-9f3c2a7e5b1d4680"
  const val PASSPHRASE = "pass+phrase/6d1e8b0c"
  const val STREAM_ID = "a1b2c3d4e5f60718293a4b5c6d7e8f90"
  const val STREAM_KEY = "key-4c7a0e2b9d5f1386"
  const val PLAYBACK_URL = "https://customer-x.cloudflarestream.com/$STREAM_ID/manifest/video.m3u8"

  val srt = SrtTarget("srt://live.stg.seazn.club:778", STREAM_ID, PASSPHRASE, latencyMs = 2_000)
  val rtmps = RtmpsTarget("rtmps://live.stg.seazn.club:443/live/", STREAM_KEY)

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

  /** A made-up session shape's descriptor, both transports, on the staging ingest host. */
  fun descriptor(
    primary: IngestTarget = srt,
    fallback: IngestTarget? = rtmps,
    maxDurationMinutes: Int = 300,
  ) =
    BroadcastDescriptor(
      primary = primary,
      fallback = fallback,
      holdWindowSeconds = mapOf(Transport.SRT to 183, Transport.RTMPS to 180),
      playbackUrl = PLAYBACK_URL,
      overlayUrl = "https://stg.seazn.club/overlay/fixtures/fx-42",
      label = "Example Town v Sample CC",
      maxDurationMinutes = maxDurationMinutes,
      scoreUpdates = "realtime",
      warmingDeadlineEpochS = 1_790_000_600,
    )

  const val PHONE_ID = "phone-7f1e0c2a"
  val PHONE = PhoneFacts(PHONE_ID, appVersion = "1.0.0", model = "Test Phone")

  fun pairRequest(
    code: String = "fx-42",
    slot: Int = 1,
    token: String = TOKEN,
    heartbeatUrl: String = "https://stg.seazn.club/api/capture/codes/fx-42/beat",
    claim: Claim = Claim.NEW,
    automatic: Boolean = true,
  ) =
    PairRequest(
      code = code,
      slot = slot,
      token = token,
      codeUrl = "https://stg.seazn.club/api/capture/codes/fx-42",
      heartbeatUrl = heartbeatUrl,
      startUrl = "https://stg.seazn.club/api/capture/codes/fx-42/start",
      language = "en",
      automatic = automatic,
      claim = claim,
      environment = Environment.STAGING,
    )
}
