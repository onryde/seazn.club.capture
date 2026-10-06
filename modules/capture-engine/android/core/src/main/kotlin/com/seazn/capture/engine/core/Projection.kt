package com.seazn.capture.engine.core

/** The phase as the snapshot and the heartbeat see it. Pure; runs after every input. */
object Projection {
  /**
   * F-S9-1: a session found not delivered reads stalled until delivery is seen again (the `delivered` line clears
   * it in the step the watch reads ok), through its new ingest session and its reconnect; otherwise the watch's
   * word while on air, and unknown off air.
   */
  private fun delivery(session: Session?, onAir: Phase.OnAir?): Delivery =
    if (session?.notDelivered == true) Delivery.STALLED else onAir?.session?.delivery?.delivery ?: Delivery.UNKNOWN

  fun snapshot(phase: Phase, now: Now): Snapshot {
    val session = phase.session
    val onAir = phase as? Phase.OnAir
    return Snapshot(
      state = state(phase, now),
      reportedAtMs = now.wallMs,
      delivery = delivery(session, onAir),
      deliveredLagMs = onAir?.session?.delivery?.deliveredLagMs,
      encodedVideoFps = onAir?.watchdog?.videoFps,
      audioPacketsPerSecond = onAir?.watchdog?.audioFps,
      srt = onAir?.srt,
      bitrateKbps = onAir?.egressBps?.let { (it / 1_000).toInt() },
      targetBitrateKbps = onAir?.session?.regulation?.targetBps?.let { it / 1_000 },
      dataUsedBytes = session?.dataUsedBytes ?: 0,
      charging = session?.device?.charging,
      heartbeat = (phase.pairing?.heartbeat ?: HeartbeatState()).status,
      shed = session?.device?.shed,
      device = session?.device,
      camera = phase.camera,
      pairing = phase.pairing?.let { PairingView(it.name, it.automatic, it.waiting) },
      broadcast = session?.let { broadcastView(it) },
      ready = ready(phase),
      refusal = phase.pairing?.refusal,
      lastEnd = phase.pairing?.lastEnd,
      unpaired = (phase as? Phase.Idle)?.unpaired,
      codeEndedPending = phase.pairing?.codeEndedPending ?: false,
      language = phase.pairing?.language,
    )
  }

  private fun broadcastView(session: Session): BroadcastView {
    val broadcast = session.broadcast
    return BroadcastView(
      sid = session.sid,
      cause = session.cause,
      playbackUrl = session.config.playbackUrl,
      overlayUrl = broadcast.overlayUrl,
      label = broadcast.label,
      holdWindowSeconds = broadcast.holdWindowSeconds,
      maxDurationMinutes = broadcast.maxDurationMinutes,
      scoreUpdates = broadcast.scoreUpdates,
      srtOffered = broadcast.srtOffered,
    )
  }

  /** A11's checks; the camera is ours and showing frames (I3). All false with no pairing. */
  private fun ready(phase: Phase): ReadyView {
    val readiness = phase.pairing?.readiness ?: return ReadyView.NONE
    val camera = readiness.cameraFrames && phase.camera == CameraState.OWN
    return ReadyView(camera = camera, sound = readiness.sound, network = phase.networkValidated, held = readiness.held)
  }

  fun state(phase: Phase, now: Now): SnapshotState =
    when (phase) {
      is Phase.Idle -> SnapshotState.Idle
      is Phase.Pairing -> SnapshotState.Pairing
      is Phase.Paired -> SnapshotState.Paired
      is Phase.Arming -> SnapshotState.Arming(phase.cause, phase.retrying)
      is Phase.Armed -> SnapshotState.Armed(phase.session.cause, phase.session.pairing.readiness.notReady(phase.session.camera, phase.session.networkValidated))
      is Phase.Ended -> SnapshotState.Ended(phase.reason, phase.durationMs)
      is Phase.Connecting -> phase.outage?.let { reconnecting(phase.session, it, now) } ?: SnapshotState.Connecting(phase.transport)
      is Phase.OnAir -> onAir(phase, now)
    }

  /**
   * The LIVE gate (F-P5-6): publishing or degraded only while encoded video frames advance, or while
   * a live session is held — its camera taken, or our own reopen or switch waiting for the camera's
   * first frame, which the stall watchdog bounds at 3 s plus at most one tick — from the reopen, or
   * for a switch from the tap or the last frame before it: the machine judges it before every input
   * ([SessionMachine.reduce]), and the tick is one ([CameraState]). A held session
   * with the camera shown taken reads degraded camera-taken, never connecting (carry 6).
   */
  private fun onAir(phase: Phase.OnAir, now: Now): SnapshotState {
    val session = phase.session
    val since = session.liveSinceEpochMs
    val held = session.camera != CameraState.OWN && phase.outage == null
    return when {
      since != null && (phase.watchdog.advancing(now.monoMs) || held) -> live(phase.transport, reasons(session, now), since)
      phase.outage != null -> reconnecting(session, phase.outage, now)
      else -> SnapshotState.Connecting(phase.transport)
    }
  }

  private fun live(transport: Transport, reasons: List<DegradeReason>, since: Long): SnapshotState =
    if (reasons.isEmpty()) SnapshotState.Publishing(transport, since) else SnapshotState.Degraded(transport, reasons, since)

  private fun reconnecting(session: Session, outage: Outage, now: Now): SnapshotState =
    SnapshotState.Reconnecting(
      cause = outage.cause,
      holdRemainingSeconds = outage.hold.remainingSeconds(now.monoMs),
      holdWindowSeconds = outage.hold.windowSeconds,
      sinceEpochMs = session.liveSinceEpochMs ?: now.wallMs,
    )

  /**
   * In [DegradeReason]'s declared order. Thermal is never one (AGENTS §8).
   *
   * Poor uplink is a cut in the last [SessionMachine.POOR_UPLINK_MS] that still stands (carry 16).
   * Every cut records the rate it failed; a clean far-end restart that undoes a cut of its own
   * episode forgets that rate ([BitrateRegulator.afterDrop]) and restarts at the healthy target, so
   * the link it judged healthy is not shown as poor.
   */
  fun reasons(session: Session, now: Now): List<DegradeReason> {
    val regulation = session.regulation
    val cutAt = regulation.lastCutAtMs
    return DegradeReason.entries.filter { reason ->
      when (reason) {
        DegradeReason.NOT_DELIVERED -> session.notDelivered
        DegradeReason.CAMERA_TAKEN -> session.camera.shownTaken
        DegradeReason.MIC_SILENCED -> session.micSilenced
        DegradeReason.POOR_UPLINK -> cutAt != null && now.monoMs - cutAt < SessionMachine.POOR_UPLINK_MS && regulation.failed != null
        DegradeReason.FELL_BACK_TO_RTMPS -> session.fallback.fellBack && session.fallback.current == Transport.RTMPS
      }
    }
  }

  /**
   * One beat's facts (amendment, _Contract shapes_), in any beating phase.
   *
   * `audioOk` is null whenever nothing is publishing (D14): paired, Arming, Armed, connecting and
   * reconnecting. Publishing, it is true only on an audio rate measured at or above the floor with the
   * mic not silenced (carry 8). No measurement is not health: it is false in an attempt's first 3 s,
   * and while the slate's silent audio is on air (the watchdog clears the rates then).
   */
  private fun publishing(state: SnapshotState): Boolean = state is SnapshotState.Publishing || state is SnapshotState.Degraded

  fun beatFacts(phase: Phase, pairing: PairingState, now: Now): BeatFacts {
    val session = phase.session
    val onAir = phase as? Phase.OnAir
    val snapshot = snapshot(phase, now)
    val audioFps = onAir?.watchdog?.audioFps
    return BeatFacts(
      code = pairing.name.code,
      slot = pairing.name.slot,
      phoneId = pairing.phone.phoneId,
      claim = pairing.claim,
      deviceModel = pairing.phone.model,
      sid = phase.heldSid,
      atEpochMs = now.wallMs,
      state = snapshot.state.wire,
      cause = session?.cause ?: (phase as? Phase.Arming)?.cause,
      notReady = pairing.readiness.notReady(phase.camera ?: CameraState.OWN, phase.networkValidated),
      startFailed = pairing.startFailed,
      stopped = pairing.stoppedInFlight,
      automatic = pairing.automatic,
      transport = onAir?.transport ?: (phase as? Phase.Connecting)?.transport,
      bitrateKbps = snapshot.bitrateKbps,
      delivery = snapshot.delivery,
      deliveredLagMs = snapshot.deliveredLagMs,
      audioOk = session?.takeIf { publishing(snapshot.state) }?.let { !it.micSilenced && audioFps != null && audioFps >= StallWatchdog.AUDIO_FLOOR_FPS },
      battery = session?.device?.let(BeatBattery::of),
      thermalStatus = session?.device?.thermalStatus,
      dataUsedBytes = session?.dataUsedBytes ?: 0,
      appVersion = pairing.phone.appVersion,
    )
  }
}
