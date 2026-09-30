package com.seazn.capture.engine.core

/** The phase as the snapshot and the heartbeat see it. Pure; runs after every input. */
object Projection {
  fun snapshot(phase: Phase, now: Now): Snapshot {
    val session = phase.session
    val onAir = phase as? Phase.OnAir
    return Snapshot(
      state = state(phase, now),
      reportedAtMs = now.wallMs,
      delivery = onAir?.session?.delivery?.delivery ?: Delivery.UNKNOWN,
      deliveredLagMs = onAir?.session?.delivery?.deliveredLagMs,
      encodedVideoFps = onAir?.watchdog?.videoFps,
      audioPacketsPerSecond = onAir?.watchdog?.audioFps,
      srt = onAir?.srt,
      bitrateKbps = onAir?.egressBps?.let { (it / 1_000).toInt() },
      targetBitrateKbps = onAir?.session?.regulation?.targetBps?.let { it / 1_000 },
      dataUsedBytes = session?.dataUsedBytes ?: 0,
      charging = session?.device?.charging,
      heartbeat = (session?.heartbeat ?: HeartbeatState()).status,
      shed = session?.device?.shed,
      device = session?.device,
      camera = session?.camera,
    )
  }

  fun state(phase: Phase, now: Now): SnapshotState =
    when (phase) {
      is Phase.Idle -> SnapshotState.Idle
      is Phase.Armed -> SnapshotState.Armed
      is Phase.Ended -> SnapshotState.Ended(phase.reason)
      is Phase.Connecting -> phase.outage?.let { reconnecting(phase.session, it, now) } ?: SnapshotState.Connecting(phase.transport)
      is Phase.OnAir -> onAir(phase, now)
    }

  /**
   * The LIVE gate (F-P5-6): publishing or degraded only while encoded video frames advance, or while
   * a live session is held — its camera taken, or our own reopen or switch waiting for the camera's
   * first frame, which the stall watchdog bounds at 3 s plus at most one tick — from the reopen, or
   * from the last frame before a switch: the machine judges it before every input
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
   * The heartbeat body's facts. Only asked for in a phase with a session.
   *
   * `audioOk` is true only on an audio rate measured at or above the floor with the mic not silenced
   * (carry 8). No measurement is not health: it is false while armed, in an attempt's first 3 s, and
   * while the slate's silent audio is on air (the watchdog clears the rates then).
   */
  fun heartbeatFacts(phase: Phase, session: Session, now: Now): HeartbeatFacts {
    val snapshot = snapshot(phase, now)
    val onAir = phase as? Phase.OnAir
    val audioFps = onAir?.watchdog?.audioFps
    return HeartbeatFacts(
      sid = session.config.sid,
      atEpochMs = now.wallMs,
      state = snapshot.state,
      transport = onAir?.transport ?: (phase as? Phase.Connecting)?.transport,
      bitrateKbps = snapshot.bitrateKbps,
      delivery = snapshot.delivery,
      deliveredLagMs = snapshot.deliveredLagMs,
      audioOk = !session.micSilenced && audioFps != null && audioFps >= StallWatchdog.AUDIO_FLOOR_FPS,
      batteryPercent = session.device?.batteryPercent,
      charging = session.device?.charging,
      drainPctPerHour = session.device?.drainPctPerHour,
      thermalStatus = session.device?.thermalStatus,
      dataUsedBytes = session.dataUsedBytes,
      appVersion = session.config.appVersion,
    )
  }
}
