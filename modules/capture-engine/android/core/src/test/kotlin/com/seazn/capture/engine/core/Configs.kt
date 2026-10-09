package com.seazn.capture.engine.core

/** Test sessions. The secrets are made up and distinctive, so a leak is easy to search for. */
object Configs {
  // 22 characters of base64url, inside capture-qr.v2's `tok` (T11 gap 3). Its tag is b24bb97b
  // (token-tag-vectors.json).
  const val TOKEN = "tok-9f3c2a7e5b1d4680ab"
  const val PASSPHRASE = "pass+phrase/6d1e8b0c"
  const val STREAM_ID = "a1b2c3d4e5f60718293a4b5c6d7e8f90"
  const val STREAM_KEY = "key-4c7a0e2b9d5f1386"
  const val PLAYBACK_URL = "https://customer-x.cloudflarestream.com/$STREAM_ID/manifest/video.m3u8"

  /**
   * The ingest host Cloudflare issues, for both transports and both environments (owner ruling A, 2026-10-05:
   * stg dropped its custom host, prd never had one). The tests' own literal, never `Hosts.INGEST`: it stands for
   * the server's answer, so a wrong pin cannot carry the fixtures with it. Every fixture cred URL is built here.
   */
  const val INGEST_HOST = "live.cloudflare.com"

  val srt = SrtTarget("srt://$INGEST_HOST:778", STREAM_ID, PASSPHRASE, latencyMs = 2_000)
  val rtmps = RtmpsTarget("rtmps://$INGEST_HOST:443/live/", STREAM_KEY)

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
      heartbeatUrl = "https://stg.seazn.club/api/v1/capture/codes/fx42hmnp7k2q/beats",
      appVersion = "1.0.0",
    )

  /** A made-up session shape's descriptor, both transports, on the staging ingest host. */
  fun descriptor(
    primary: IngestTarget = srt,
    fallback: IngestTarget? = rtmps,
    maxDurationMinutes: Int = 300,
    holdWindowSeconds: Map<Transport, Int> = mapOf(Transport.SRT to 183, Transport.RTMPS to 180),
  ) =
    BroadcastDescriptor(
      primary = primary,
      fallback = fallback,
      holdWindowSeconds = holdWindowSeconds,
      playbackUrl = PLAYBACK_URL,
      overlayUrl = "https://stg.seazn.club/overlay/fixtures/fx-42",
      label = "Example Town v Sample CC",
      maxDurationMinutes = maxDurationMinutes,
      scoreUpdates = "realtime",
      warmingDeadlineEpochS = 1_790_000_600,
    )

  // Made up, within capture-beat.v1's 16 to 64 characters.
  const val PHONE_ID = "phone-7f1e0c2a9b3d"
  val PHONE = PhoneFacts(PHONE_ID, appVersion = "1.0.0", model = "Test Phone")

  fun pairRequest(
    code: String = "fx42hmnp7k2q",
    slot: Int = 1,
    token: String = TOKEN,
    heartbeatUrl: String = "https://stg.seazn.club/api/v1/capture/codes/fx42hmnp7k2q/beats",
    claim: Claim = Claim.NEW,
    automatic: Boolean = true,
    // The code's own URL on the staging host (D3), as JS builds it: native refuses any other (T16 m1).
    codeUrl: String = "https://stg.seazn.club/api/v1/capture/codes/$code",
  ) =
    PairRequest(
      code = code,
      slot = slot,
      token = token,
      codeUrl = codeUrl,
      heartbeatUrl = heartbeatUrl,
      startUrl = "https://stg.seazn.club/api/v1/capture/codes/fx42hmnp7k2q/start",
      language = "en",
      automatic = automatic,
      claim = claim,
      environment = Environment.STAGING,
    )

  /** Every check passes, held with the top to the operator's left. */
  val READY = Readiness(cameraFrames = true, micAvailable = true, pose = Pose.Held(Side.LEFT))

  fun waiting(pollSeconds: Int = 10, destinationName: String? = "YouTube · Example Town CC", autoAllowed: Boolean = true) =
    WaitingFields(
      label = "Example Town v Sample CC",
      venueTimezone = "Europe/London",
      scheduledStartEpochS = 1_790_003_600,
      autoAllowed = autoAllowed,
      destinationName = destinationName,
      overlayUrl = "https://stg.seazn.club/overlay/fixtures/fx-42",
      pollSeconds = pollSeconds,
    )

  fun open(sid: String = "sess_42", descriptor: BroadcastDescriptor = descriptor()) = CodeAnswer.Open(sid, "warming", descriptor, waiting())

  fun body(beat: Command.PostHeartbeat) = org.json.JSONObject(beat.body)

  /**
   * A fresh engine's way to a broadcast, as the platform would send it (PV6): pair, permissions
   * granted, a validated network, the organiser's Go live on the claim beat (beat 1), the code's open
   * shape (fetch 1) and, when [ready], every readiness check passing. Ready, Armed connects on its own.
   * A later pairing on the same engine names its own [beat] and [fetch] ids: ids carry across pairings.
   */
  fun pairInputs(descriptor: BroadcastDescriptor = descriptor(), ready: Boolean = true, beat: Int = 1, fetch: Int = 1): List<Input> =
    listOfNotNull(
      Input.Pair(pairRequest(), PHONE, stopped = null),
      Input.PermissionsAnswered(granted = true),
      Input.Network(true),
      Input.HeartbeatAnswered(beat, HeartbeatResponse.Answered(200, BeatReply("go-live", "sess_42", "organiser", null, waiting()))),
      Input.CodeAnswered(fetch, open(descriptor = descriptor)),
      if (ready) Input.ReadinessChanged(READY) else null,
    )
}
