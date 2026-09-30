package com.seazn.capture.engine.core

/** One step of the machine: the next phase and what to ask of the platform. */
data class Step(val phase: Phase, val commands: List<Command> = emptyList())

private fun record(kind: String, vararg fields: Pair<String, Any?>): Command = Command.Record(RecordEntry(kind, fields.toList()))

/**
 * The aggregate (spec §3, `SessionMachine`), as a pure reducer: `(phase, input, now) → (phase,
 * commands)`. Native owns the session (AGENTS §2); this is that ownership, with every rule runnable
 * on the JVM. It holds no clock, thread or I/O — [Engine] drives it.
 */
object SessionMachine {
  /** Between attempts (P5 spike: every 2 s). */
  const val RETRY_MS = 2_000L

  /** A connect that answers nothing in this long has failed (the spike's half-open guard). */
  const val CONNECT_TIMEOUT_MS = 15_000L

  /** A regulator cut this recent shows as `poor-uplink`, the same span a raise waits after a cut. */
  const val POOR_UPLINK_MS = BitrateRegulator.RAISE_AFTER_CUT_MS

  fun reduce(phase: Phase, input: Input, now: Now): Step =
    when (input) {
      is Input.Arm -> arm(phase, input.config, now)
      Input.Start -> start(phase, now)
      Input.Stop -> if (phase.session == null) ignored(phase, "stop") else end(phase, EndReason.OPERATOR_STOPPED)
      Input.Reset -> if (phase is Phase.Ended) Step(Phase.Idle, listOf(record("reset"))) else ignored(phase, "reset")
      Input.SwitchCamera -> Devices.switched(phase, now)
      Input.Tick -> Heartbeats.tick(Timers.tick(phase, now), now)
      is Input.Connected -> Transports.connected(phase, input.attemptId, now)
      is Input.ConnectFailed -> Transports.connectFailed(phase, input, now)
      is Input.Dropped -> Transports.dropped(phase, input, now)
      is Input.Frames -> Transports.frames(phase, input, now)
      is Input.Link -> Transports.link(phase, input, now)
      is Input.Network -> network(phase, input.validated)
      Input.CameraContended -> Devices.contended(phase)
      Input.CameraReleased -> Devices.released(phase)
      is Input.CameraReopened -> Devices.reopened(phase, input.ok, now)
      is Input.MicSilenced -> Devices.mic(phase, input.silenced)
      is Input.Device -> Devices.sampled(phase, input.sample)
      is Input.PlaylistFetched -> Deliveries.fetched(phase, input, now)
      is Input.HeartbeatAnswered -> Heartbeats.answered(phase, input)
      is Input.DescriptorChecked -> descriptor(phase, input.result)
    }

  internal fun ignored(phase: Phase, intent: String): Step =
    Step(phase, listOf(record("intent-ignored", "intent" to intent, "phase" to phase.name)))

  internal fun end(phase: Phase, reason: EndReason, vararg fields: Pair<String, Any?>): Step {
    val liveMs = phase.session?.liveSinceEpochMs
    return Step(Phase.Ended(reason), listOf(record("ended", "reason" to reason, "wasLive" to (liveMs != null), *fields), Command.End(reason)))
  }

  private fun arm(phase: Phase, config: SessionConfig, now: Now): Step {
    if (phase !is Phase.Idle) return ignored(phase, "arm")
    val problems = config.problems()
    if (problems.isNotEmpty()) {
      val refused = record("arm-refused", "problems" to problems.joinToString("; "))
      return Step(Phase.Ended(EndReason.FATAL_ERROR), listOf(refused, Command.End(EndReason.FATAL_ERROR)))
    }
    val session =
      Session(
        config = config,
        fallback = FallbackPolicy(config.primary.transport, config.fallback?.transport),
        regulation = BitrateRegulator.sessionStarted(),
        heartbeat = HeartbeatState(nextDueAtMs = now.monoMs),
        delivery = DeliveryWatch(config.playbackUrl),
      )
    val armed = record("armed", "sid" to config.sid, "transport" to config.primary.transport, "playbackUrl" to config.playbackUrl)
    return Step(Phase.Armed(session), listOf(armed))
  }

  private fun start(phase: Phase, now: Now): Step {
    if (phase !is Phase.Armed) return ignored(phase, "start")
    return Transports.connect(phase.session, phase.session.fallback.current, outage = null, now = now)
  }

  private fun network(phase: Phase, validated: Boolean): Step {
    val session = phase.session ?: return Step(phase)
    if (session.networkValidated == validated) return Step(phase)
    return Step(phase.withSession(session.copy(networkValidated = validated)), listOf(record("network", "validated" to validated)))
  }

  /** A 410 or a finished state on a reconnect's descriptor fetch is an organiser stop (spec §1). */
  private fun descriptor(phase: Phase, result: DescriptorCheck): Step {
    if (phase.session == null) return Step(phase)
    return when (result) {
      is DescriptorCheck.Over -> end(phase, EndReason.STOPPED_BY_ORGANISER, "endReason" to result.endReason)
      DescriptorCheck.Live -> Step(phase, listOf(record("descriptor", "result" to "live")))
      is DescriptorCheck.Unreachable -> Step(phase, listOf(record("descriptor", "result" to "unreachable", "message" to result.message)))
    }
  }
}

/** Connects, drops, frames and link readings: the attempt's life. */
internal object Transports {
  /** What the platform's counters read at a connect: they restart at zero on every one ([LinkCounters]). */
  private val CONNECT_COUNTERS = LinkCounters(0, 0, 0, 0, 0, null, null, null)

  fun connect(session: Session, transport: Transport, outage: Outage?, now: Now): Step {
    val (next, connect) = connectCommand(session, transport) ?: return missingTarget(session, transport)
    val phase = Phase.Connecting(next, transport, ConnectStep.Requested(connect.attemptId, now.monoMs), outage)
    return Step(phase, listOf(connect, record("connecting", "transport" to transport, "attempt" to connect.attemptId)))
  }

  /** A new attempt that replaces a live one: a [Command.Rebuild] or a [Command.StartNewSession]. */
  fun replace(onAir: Phase.OnAir, session: Session, outage: Outage?, now: Now, wrap: (Command.Connect) -> Command): Step {
    val (next, connect) = connectCommand(session, onAir.transport) ?: return missingTarget(session, onAir.transport)
    val phase = Phase.Connecting(next, onAir.transport, ConnectStep.Requested(connect.attemptId, now.monoMs), outage)
    return Step(phase, listOf(wrap(connect), record("connecting", "transport" to onAir.transport, "attempt" to connect.attemptId)))
  }

  private fun connectCommand(session: Session, transport: Transport): Pair<Session, Command.Connect>? {
    val target = session.config.target(transport) ?: return null
    val bps = session.regulation.targetBps
    val maxBw = if (transport == Transport.SRT) SrtBandwidth.maxBwBytesPerSecond(bps) else null
    val id = session.nextAttemptId
    return session.copy(nextAttemptId = id + 1) to Command.Connect(id, target, bps, maxBw)
  }

  /** Unreachable after arm's checks; kept total so a bug ends the session visibly rather than throwing. */
  private fun missingTarget(session: Session, transport: Transport): Step =
    SessionMachine.end(Phase.Armed(session), EndReason.FATAL_ERROR, "transport" to transport)

  fun connected(phase: Phase, attemptId: Int, now: Now): Step {
    val step = (phase as? Phase.Connecting)?.step
    if (phase is Phase.Connecting && step is ConnectStep.Requested && step.attemptId == attemptId) {
      val session = phase.session.copy(regulation = BitrateRegulator.attemptStarted(phase.session.regulation))
      // Seeded at the connect (carry 13): the first reading's bytes, drops and egress count from here.
      val meter = LinkMeter(CONNECT_COUNTERS, now.monoMs)
      val onAir = Phase.OnAir(session, attemptId, phase.transport, now.monoMs, StallWatchdog(now.monoMs), meter, outage = phase.outage)
      return Step(onAir, listOf(record("connected", "transport" to phase.transport, "attempt" to attemptId)))
    }
    if (phase is Phase.OnAir && phase.attemptId == attemptId) return Step(phase)
    // A stream this machine no longer wants: close it, so nothing publishes behind the session's back.
    return Step(phase, listOf(Command.Disconnect(attemptId), record("stale-connected", "attempt" to attemptId)))
  }

  fun connectFailed(phase: Phase, input: Input.ConnectFailed, now: Now): Step {
    val step = (phase as? Phase.Connecting)?.step
    if (phase !is Phase.Connecting || step !is ConnectStep.Requested || step.attemptId != input.attemptId) return Step(phase)
    return failed(phase, input.failure, input.message, now)
  }

  /** A failed connect: counted or not by the fallback policy, then a retry [SessionMachine.RETRY_MS] later. */
  fun failed(phase: Phase.Connecting, failure: ConnectFailure, message: String?, now: Now): Step {
    val session = phase.session
    val decision = session.fallback.connectFailed(failure, session.networkValidated)
    val commands =
      mutableListOf(
        record(
          "connect-failed",
          "transport" to phase.transport,
          "failure" to failure,
          "validated" to session.networkValidated,
          "counted" to decision.counted,
          "message" to message,
        )
      )
    if (decision.fellBack) commands += record("fell-back", "from" to phase.transport, "to" to decision.policy.current)
    if (failure == ConnectFailure.REFUSED) commands += Command.FetchDescriptor
    val waiting = ConnectStep.Waiting(now.monoMs + SessionMachine.RETRY_MS)
    return Step(phase.copy(session = session.copy(fallback = decision.policy), transport = decision.policy.current, step = waiting), commands)
  }

  fun dropped(phase: Phase, input: Input.Dropped, now: Now): Step {
    val step = (phase as? Phase.Connecting)?.step
    if (phase is Phase.Connecting && step is ConnectStep.Requested && step.attemptId == input.attemptId) {
      return failed(phase, ConnectFailure.OTHER, input.message, now)
    }
    if (phase !is Phase.OnAir || phase.attemptId != input.attemptId) return Step(phase)
    val session = phase.session
    val publishedMs = now.monoMs - phase.connectedAtMs
    val decision = session.fallback.dropped(input.reason, session.networkValidated, publishedMs)
    val outage = phase.outage ?: outageFor(session, phase.transport, now, ReconnectCause.UPLINK_LOST)
    val commands =
      mutableListOf(
        record(
          "dropped",
          "transport" to phase.transport,
          "reason" to input.reason,
          "validated" to session.networkValidated,
          "counted" to decision.counted,
          "publishedMs" to publishedMs,
          "message" to input.message,
        ),
        Command.FetchDescriptor,
      )
    if (decision.fellBack) commands += record("fell-back", "from" to phase.transport, "to" to decision.policy.current)
    val next = session.copy(fallback = decision.policy, regulation = BitrateRegulator.afterDrop(session.regulation, now.monoMs))
    val waiting = ConnectStep.Waiting(now.monoMs + SessionMachine.RETRY_MS)
    return Step(Phase.Connecting(next, decision.policy.current, waiting, outage), commands)
  }

  /** An outage only exists for a session that has been live: before that, there is nothing to hold. */
  fun outageFor(session: Session, transport: Transport, now: Now, cause: ReconnectCause): Outage? {
    if (session.liveSinceEpochMs == null) return null
    val hold = HoldClock.started(session.config.holdWindowSeconds, transport, now.monoMs) ?: Hold(transport, 0, now.monoMs)
    return Outage(hold, cause)
  }

  fun frames(phase: Phase, input: Input.Frames, now: Now): Step {
    if (phase !is Phase.OnAir || phase.attemptId != input.attemptId) return Step(phase)
    val session = phase.session
    val (watchdog, verdict) = phase.watchdog.frames(input.videoFrames, input.audioFrames, now.monoMs, session.camera.slateOnAir, session.micSilenced)
    var next = phase.copy(watchdog = watchdog)
    val commands = mutableListOf<Command>()
    if (watchdog.advancing(now.monoMs)) {
      if (next.session.liveSinceEpochMs == null) {
        next = next.copy(session = next.session.copy(liveSinceEpochMs = now.wallMs))
        commands += record("live", "transport" to phase.transport)
      }
      // A reopened or switched camera is ours again once it delivers a frame.
      if (next.session.camera == CameraState.RESUMING || next.session.camera == CameraState.SWITCHING) {
        next = next.copy(session = next.session.copy(camera = CameraState.OWN))
        commands += record("camera-resumed")
      }
      next.outage?.let { outage ->
        commands += record("resumed", "transport" to phase.transport, "cause" to outage.cause, "outageMs" to now.monoMs - outage.hold.startedAtMs)
        next = next.copy(outage = null)
      }
    }
    if (verdict !is StallVerdict.Rebuild) return Step(next, commands)
    val rebuilt = Timers.rebuild(next, verdict, now)
    return rebuilt.copy(commands = commands + rebuilt.commands)
  }

  fun link(phase: Phase, input: Input.Link, now: Now): Step {
    if (phase !is Phase.OnAir || phase.attemptId != input.attemptId) return Step(phase)
    val session = phase.session
    val (meter, sample) = phase.meter.read(input.counters, now.monoMs)
    val latency = (session.config.target(Transport.SRT) as? SrtTarget)?.latencyMs ?: 0
    val regulation = BitrateRegulator.next(session.regulation, sample, now.monoMs, phase.transport, latency)
    val counters = input.counters
    val srt = if (phase.transport == Transport.SRT) SrtTelemetry(counters.packetsSent, counters.packetsRetransmitted, counters.packetsDropped, counters.rttMs) else null
    val next =
      phase.copy(
        session = session.copy(regulation = regulation, dataUsedBytes = session.dataUsedBytes + sample.bytes),
        meter = meter,
        srt = srt,
        egressBps = sample.egressBps ?: phase.egressBps,
      )
    val before = session.regulation.targetBps
    if (regulation.targetBps == before) return Step(next)
    val commands = mutableListOf<Command>(Command.SetBitrate(phase.attemptId, regulation.targetBps))
    if (phase.transport == Transport.SRT) commands += Command.SetMaxBw(phase.attemptId, SrtBandwidth.maxBwBytesPerSecond(regulation.targetBps))
    commands += record("bitrate", "from" to before, "to" to regulation.targetBps)
    return Step(next, commands)
  }
}

/** Everything the tick decides: retries, connect timeouts, hold expiry, the stall watchdog, playlist polls. */
internal object Timers {
  fun tick(phase: Phase, now: Now): Step =
    when (phase) {
      is Phase.Connecting -> connecting(phase, now)
      is Phase.OnAir -> onAir(phase, now)
      Phase.Idle, is Phase.Armed, is Phase.Ended -> Step(phase)
    }

  private fun connecting(connecting: Phase.Connecting, now: Now): Step {
    if (connecting.outage?.hold?.expired(now.monoMs) == true) return expired(connecting, connecting.outage)
    // Off air: the delivery watch must see it, or the gap would count as a delivery stall.
    val offAir = connecting.session.delivery.tick(now.monoMs, onAirNow = false).first
    val phase = connecting.copy(session = connecting.session.copy(delivery = offAir))
    return when (val step = phase.step) {
      is ConnectStep.Waiting ->
        if (now.monoMs >= step.connectAtMs) Transports.connect(phase.session, phase.transport, phase.outage, now) else Step(phase)
      is ConnectStep.Requested ->
        if (now.monoMs - step.atMs < SessionMachine.CONNECT_TIMEOUT_MS) Step(phase)
        else {
          val failed = Transports.failed(phase, ConnectFailure.TIMEOUT, "no answer in ${SessionMachine.CONNECT_TIMEOUT_MS} ms", now)
          failed.copy(commands = listOf(Command.Disconnect(step.attemptId)) + failed.commands)
        }
    }
  }

  private fun onAir(phase: Phase.OnAir, now: Now): Step {
    val outage = phase.outage
    if (outage != null && outage.hold.expired(now.monoMs)) return expired(phase, outage)
    val (watchdog, verdict) = phase.watchdog.tick(now.monoMs, phase.session.camera.slateOnAir)
    val watched = phase.copy(watchdog = watchdog)
    if (verdict is StallVerdict.Rebuild) return rebuild(watched, verdict, now)
    // Publishing time counts only while frames advance: our own reopen or switch pauses it until the
    // camera's first frame, so a pause of ours never reads as Cloudflare falling behind.
    val (delivery, requests) = watched.session.delivery.tick(now.monoMs, watchdog.advancing(now.monoMs))
    val polled = watched.copy(session = watched.session.copy(delivery = delivery))
    return Step(polled, requests.map { Command.FetchPlaylist(it.id, it.url) })
  }

  private fun expired(phase: Phase, outage: Outage): Step =
    SessionMachine.end(phase, EndReason.HOLD_WINDOW_EXPIRED, "transport" to outage.hold.transport, "cause" to outage.cause)

  /**
   * The stall watchdog asked for a rebuild (F-P5-6, F-P5-9). The record's `msSinceAdvance` counts
   * from the last frame; for `no-first-frame`, from the connect; and when `rebaselined` is true, from
   * our own camera reopen or switch, which is not a frame (carry 7).
   */
  fun rebuild(onAir: Phase.OnAir, verdict: StallVerdict.Rebuild, now: Now): Step {
    val outage = onAir.outage ?: Transports.outageFor(onAir.session, onAir.transport, now, ReconnectCause.VIDEO_STALLED)
    val watchdog = onAir.watchdog
    val stalled =
      record(
        "video-stalled",
        "cause" to verdict.cause,
        "msSinceAdvance" to verdict.msSinceAdvance,
        "rebaselined" to (watchdog.lastAdvanceAtMs == null && watchdog.stallFromMs != null),
        "videoFps" to verdict.videoFps,
        "audioFps" to verdict.audioFps,
      )
    val step = Transports.replace(onAir, onAir.session, outage, now) { Command.Rebuild(onAir.attemptId, it) }
    return step.copy(commands = listOf(stalled) + step.commands)
  }
}

/** Camera, microphone and device conditions. */
internal object Devices {
  fun contended(phase: Phase): Step {
    val session = phase.session ?: return Step(phase)
    if (session.camera == CameraState.TAKEN) return Step(phase)
    val next = phase.withSession(session.copy(camera = CameraState.TAKEN))
    // Taken again mid-reopen: the slate never came down, so it is not put up twice.
    val slate = if (session.camera.slateOnAir) emptyList() else listOf(Command.Slate(on = true))
    return Step(next, slate + record("camera-taken"))
  }

  fun released(phase: Phase): Step {
    val session = phase.session ?: return Step(phase)
    if (session.camera != CameraState.TAKEN) return Step(phase)
    return Step(phase.withSession(session.copy(camera = CameraState.REOPENING)), listOf(Command.ReopenCamera, record("camera-released")))
  }

  fun reopened(phase: Phase, ok: Boolean, now: Now): Step {
    val session = phase.session ?: return Step(phase)
    if (session.camera != CameraState.REOPENING) return Step(phase)
    val own = phase.withSession(session.copy(camera = CameraState.OWN))
    val commands = listOf(Command.Slate(on = false), record("camera-reopened", "ok" to ok))
    if (own !is Phase.OnAir) return Step(own, commands)
    if (ok) {
      // A fresh stall window from now, and camera-taken until the camera's first frame (carry 6).
      val resuming = own.copy(session = own.session.copy(camera = CameraState.RESUMING), watchdog = own.watchdog.rebaselined(now.monoMs))
      return Step(resuming, commands)
    }
    // The spike's forced rebuild: a reopen that failed leaves the stream's own restart as the recovery.
    val rebuilt = Timers.rebuild(own, StallVerdict.Rebuild(StallCause.NO_VIDEO, 0, null, null), now)
    return rebuilt.copy(commands = commands + rebuilt.commands)
  }

  /**
   * The operator's switch (ruling 14). On air, the stall watchdog starts a fresh window, so the
   * switch's frame pause is neither a no-video nor a rate-floor rebuild, and the session's LIVE state
   * holds until the new camera's first frame. Only a camera that has delivered a frame is switched
   * that way: before the first frame, F-P5-6's 5 s grace already covers the pause. A re-baseline
   * clears the last frame, and the camera is ours again in the step that brings the next one, so a
   * second switch before the new camera's first frame finds no frame and keeps the first one's
   * window: LIVE with no new frame is bounded by 3 s from the first switch.
   */
  fun switched(phase: Phase, now: Now): Step {
    val session = phase.session ?: return SessionMachine.ignored(phase, "switch-camera")
    if (session.camera.slateOnAir) return SessionMachine.ignored(phase, "switch-camera")
    val commands = listOf(Command.SwitchCamera, record("camera-switched"))
    if (phase !is Phase.OnAir || phase.watchdog.lastAdvanceAtMs == null) return Step(phase, commands)
    val switching = phase.copy(session = session.copy(camera = CameraState.SWITCHING), watchdog = phase.watchdog.rebaselined(now.monoMs))
    return Step(switching, commands)
  }

  fun mic(phase: Phase, silenced: Boolean): Step {
    val session = phase.session ?: return Step(phase)
    if (session.micSilenced == silenced) return Step(phase)
    val kind = if (silenced) "mic-silenced" else "mic-restored"
    return Step(phase.withSession(session.copy(micSilenced = silenced)), listOf(record(kind)))
  }

  /** Relayed, and recorded when it changes (AGENTS §11). Never a session state (AGENTS §8). */
  fun sampled(phase: Phase, sample: DeviceSample): Step {
    val session = phase.session ?: return Step(phase)
    val previous = session.device
    val commands = mutableListOf<Command>()
    if (previous?.thermalStatus != sample.thermalStatus) {
      commands += record("thermal", "status" to sample.thermalStatus, "headroom" to sample.thermalHeadroom)
    }
    if (previous?.shed != sample.shed) commands += record("shed", "shed" to sample.shed)
    return Step(phase.withSession(session.copy(device = sample)), commands)
  }
}

/** The delivered-playlist watch (F-P5-13) wired to the session. */
internal object Deliveries {
  /**
   * An answer is evidence only while publishing (carry 11): one that lands off air — after a drop,
   * or while frames do not advance — is dropped here, before the watch, so it can neither clear
   * not-delivered nor set a delivery. The watch's own off-air tick then abandons the request.
   */
  fun fetched(phase: Phase, input: Input.PlaylistFetched, now: Now): Step {
    if (phase !is Phase.OnAir || !phase.watchdog.advancing(now.monoMs)) return Step(phase)
    val session = phase.session
    val (watch, requests, verdict) = session.delivery.fetched(input.requestId, input.result, now.monoMs)
    val commands = requests.map<PlaylistRequest, Command> { Command.FetchPlaylist(it.id, it.url) }.toMutableList()
    var next = session.copy(delivery = watch)
    if (next.notDelivered && watch.delivery == Delivery.OK) {
      next = next.copy(notDelivered = false)
      commands += record("delivered")
    }
    val updated = phase.copy(session = next)
    if (verdict == null) return Step(updated, commands)
    val restarted = newSession(updated, verdict, now)
    return restarted.copy(commands = commands + restarted.commands)
  }

  /** Not delivered: force a new ingest session, and say so until the playlist moves again. */
  private fun newSession(onAir: Phase.OnAir, verdict: NotDelivered, now: Now): Step {
    val session = onAir.session.copy(notDelivered = true, delivery = onAir.session.delivery.newSession())
    val outage = onAir.outage ?: Transports.outageFor(session, onAir.transport, now, ReconnectCause.NOT_DELIVERED)
    val noted = record("not-delivered", "cause" to verdict.cause, "stalledMs" to verdict.stalledMs, "lagGrowthMs" to verdict.lagGrowthMs)
    val step = Transports.replace(onAir, session, outage, now) { Command.StartNewSession(onAir.attemptId, it) }
    return step.copy(commands = listOf(noted) + step.commands)
  }
}

/** The console heartbeat (ruling 5): due on the tick while armed or live, never gating anything. */
internal object Heartbeats {
  fun tick(step: Step, now: Now): Step {
    val phase = step.phase
    val session = phase.session ?: return step
    val (heartbeat, id) = Heartbeat.due(session.heartbeat, now.monoMs, now.wallMs)
    val commands = step.commands.toMutableList()
    if (heartbeat.failures > session.heartbeat.failures) commands += record("heartbeat", "result" to HeartbeatResult.FAILED, "message" to "no answer")
    val next = phase.withSession(session.copy(heartbeat = heartbeat))
    if (id == null) return Step(next, commands)
    val body = Heartbeat.payload(Projection.heartbeatFacts(next, session.copy(heartbeat = heartbeat), now))
    commands += Command.PostHeartbeat(id, session.config.heartbeatUrl, session.config.token, body)
    return Step(next, commands)
  }

  fun answered(phase: Phase, input: Input.HeartbeatAnswered): Step {
    val session = phase.session ?: return Step(phase)
    val (heartbeat, over) = Heartbeat.answered(session.heartbeat, input.beatId, input.response)
    if (heartbeat == session.heartbeat) return Step(phase)
    val status = (input.response as? HeartbeatResponse.Answered)?.status
    if (over) {
      val answered = (input.response as? HeartbeatResponse.Answered)?.endReason
      return SessionMachine.end(phase, EndReason.STOPPED_BY_ORGANISER, "status" to status, "endReason" to answered)
    }
    val noted = record("heartbeat", "result" to heartbeat.lastResult, "status" to status, "message" to (input.response as? HeartbeatResponse.Failed)?.message)
    return Step(phase.withSession(session.copy(heartbeat = heartbeat)), listOf(noted))
  }
}
