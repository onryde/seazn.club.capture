package com.seazn.capture.engine.core

/**
 * One step of the machine: the next phase and what to ask of the platform. [leftLog] is the beat log of a pairing the
 * step left for Idle, as the step last held it ([Pairings.unpaired]), so the answer that unpaired the phone is in the
 * minute [BeatLogs.closed] writes (plan D §3.4).
 */
data class Step(val phase: Phase, val commands: List<Command> = emptyList(), val leftLog: BeatLog? = null)

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

  /**
   * The tick runs every time-based rule in its own order. Any other input is applied only after the
   * phase as it stands has been judged the way the tick would (B6 ruling C2): a hold that has run out
   * ends the session first (B7 N1), and then the stall watchdog judges it, so nothing lands between
   * the LIVE gate closing and the rebuild, no snapshot reads connecting there, and a switch in that
   * gap cannot re-open LIVE. A stop is not judged (B6 fix 2): it ends the session whatever the
   * picture does, so a rebuild first would only be torn down by the end. A permanent platform failure
   * is judged for the hold only (final review M-5, N-4): the watchdog is skipped for the stop's reason.
   *
   * So once the hold has run out, any input but a stop that lands before the tick ends the session
   * hold-window-expired, a picture that comes back, an organiser stop and a platform failure included
   * (B7 ruling m2, final review N-4): the hold is the published limit, and the tick at that instant
   * would end it the same way. A stop in that gap reads operator-stopped.
   *
   * Plan D §3.4: whatever the input, a pairing that stops beating writes its open minute of beats ([BeatLogs.closed]).
   */
  fun reduce(phase: Phase, input: Input, now: Now): Step = BeatLogs.closed(phase, reduced(phase, input, now))

  private fun reduced(phase: Phase, input: Input, now: Now): Step {
    if (input == Input.Tick || input == Input.Stop) return apply(phase, input, now)
    val judged = if (input is Input.PlatformFailed) Timers.holdRanOut(phase, now) ?: Step(phase) else Timers.judged(phase, now)
    val step = apply(judged.phase, input, now)
    val merged = if (judged.commands.isEmpty()) step else step.copy(commands = judged.commands + step.commands)
    // A11: whatever the input, an Armed phase that is ready connects now.
    return Pairings.gate(merged, now)
  }

  private fun apply(phase: Phase, input: Input, now: Now): Step {
    if (phase is Phase.Ended && phase.finalBeatId != null) finalBeat(phase, input, now)?.let { return it }
    return when (input) {
      is Input.Pair -> Pairings.pair(phase, input, now)
      is Input.PermissionsAnswered -> Pairings.permissions(phase, input.granted, now)
      Input.Unpair -> Pairings.unpair(phase)
      is Input.SetAutomatic -> Pairings.automatic(phase, input.on)
      is Input.SetLanguage -> Pairings.language(phase, input.language)
      is Input.ReadinessChanged -> Pairings.readiness(phase, input.readiness)
      Input.Start -> Verdicts.postStart(phase, now)
      Input.Stop -> stop(phase, now)
      Input.Reset -> if (phase is Phase.Ended) reset(phase) else ignored(phase, "reset")
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
      is Input.HeartbeatAnswered -> Heartbeats.answered(phase, input, now)
      is Input.CodeAnswered -> Verdicts.code(phase, input, now)
      is Input.StartAnswered -> Verdicts.started(phase, input, now)
      is Input.PlatformFailed -> platformFailed(phase, input, now)
    }
  }

  /** A8: the final beat's answer, or its timeout, releases the service. Null for any other input. */
  private fun finalBeat(ended: Phase.Ended, input: Input, now: Now): Step? {
    val result =
      when {
        input is Input.HeartbeatAnswered && input.beatId == ended.finalBeatId ->
          record("final-beat", "result" to "answered", "status" to (input.response as? HeartbeatResponse.Answered)?.status)
        input == Input.Tick && now.monoMs >= ended.finalBeatAtMs + Heartbeat.TIMEOUT_MS -> record("final-beat", "result" to "timeout", "status" to null)
        else -> return null
      }
    return Step(ended.copy(finalBeatId = null), listOf(Command.Release, result))
  }

  /** Back to Idle; a final beat still pending is let go, and the service with it. */
  private fun reset(ended: Phase.Ended): Step {
    val release = if (ended.finalBeatId != null) listOf(Command.Release) else emptyList()
    return Step(Phase.Idle(ended.ids, ended.networkValidated, ended.micSilenced), release + record("reset"))
  }

  internal fun ignored(phase: Phase, intent: String): Step =
    Step(phase, listOf(record("intent-ignored", "intent" to intent, "phase" to phase.name)))

  /**
   * The operator's Stop (A3), only while a broadcast is held. From a broadcast that went live it ends the pairing
   * ([end], A8's final beat). Owner decision 1 (2026-10-05) supersedes A8's silence for one that never went live
   * (Arming, Armed, or Connecting before its first frame): the broadcast ends and the pairing stays Paired, so Go
   * live can be tried again, and A17's record goes out on a beat at once ([neverLive]). A 401 heard while it was
   * held ends the pairing with it, as before (the 401 deferral): its code is dead, so no beat could deliver.
   */
  private fun stop(phase: Phase, now: Now): Step {
    val pairing = phase.pairing
    val sid = phase.heldSid
    if (pairing == null || sid == null) return ignored(phase, "stop")
    if (wentLive(phase) || pairing.codeEndedPending) return end(phase, EndReason.OPERATOR_STOPPED, now)
    return neverLive(phase, pairing, sid, now)
  }

  /**
   * The held broadcast went live: its first frame came, or it is a rejoin of a lapsed one (N29). P3 (controller's): a
   * rejoin was live, so its Stop ends the pairing as Stop from live does (A3), A8's final beat included.
   */
  private fun wentLive(phase: Phase): Boolean {
    val sid = phase.heldSid ?: return false
    return phase.session?.liveSinceEpochMs != null || phase.pairing?.lapsed?.sid == sid
  }

  /**
   * Owner decision 1: A17's record is written, as [end] writes it, and the Paired pairing holds it and refuses its
   * sid, so a late start answer or a server word naming it never starts it again. The beat that goes now, not at
   * the cadence, holds no sid, so it carries `stopped: <sid>` (RR3), which the server takes as the operator's stop
   * of a session not yet live, ending it `operator_stopped` and keeping the pairing (web lane, stg da3297a33).
   * Never `state: ended` with the sid (T21): that ends the server's pairing. It is the late path's beat, early:
   * its 2xx delivers the record (`stopped-delivered`, and no later beat carries it), and one that fails leaves it
   * for the next beat, or the next pair. A beat already in flight, or a 429's wait, goes first.
   */
  private fun neverLive(phase: Phase, pairing: PairingState, sid: String, now: Now): Step {
    val stopped = StoppedRecord.of(pairing.name, sid, now.wallMs, phase.session?.broadcast?.maxDurationMinutes)
    val over = Verdicts.over(phase, LastEnd.STOPPED, now)
    val paired = over.phase as? Phase.Paired ?: return over
    val held = paired.pairing.copy(stopped = stopped, refused = paired.pairing.refused + sid, heartbeat = paired.pairing.heartbeat.copy(lastSentAtMonoMs = null))
    val step = Step(paired.copy(pairing = held), over.commands + Command.WriteStopped(stopped))
    return Heartbeats.tick(step, now)
  }

  /**
   * The pairing is over: the operator's Stop from a broadcast that went live (A3), or a fatal error. A Stop writes
   * A17's record before End, sends A8's one final beat, and holds the service for it.
   */
  internal fun end(phase: Phase, reason: EndReason, now: Now, vararg fields: Pair<String, Any?>): Step {
    val pairing = phase.pairing
    val sid = phase.heldSid
    val wasLive = wentLive(phase)
    val ended = phase.ended(reason, now)
    val commands = mutableListOf<Command>(record("ended", "reason" to reason, "wasLive" to wasLive, *fields))
    if (reason == EndReason.OPERATOR_STOPPED && pairing != null && sid != null) {
      commands += Command.WriteStopped(StoppedRecord.of(pairing.name, sid, now.wallMs, phase.session?.broadcast?.maxDurationMinutes))
    }
    commands += Command.End(reason)
    if (reason == EndReason.OPERATOR_STOPPED && wasLive && pairing != null) {
      val (beat, id) = finalBeat(phase, pairing, now)
      // Plan D §3.4: the final beat is a beat sent too, off the cadence: counted, with no interval line.
      val (beatLog, lines) = pairing.beatLog.send(id, intervalMs = null, held = true, now)
      commands += lines.map { Command.Record(it) }
      commands += beat
      // The final beat's id is spent: the next pairing's beats start after it (plan B: ids never repeat).
      val beating = pairing.copy(heartbeat = pairing.heartbeat.copy(nextId = id + 1, inFlightId = null), beatLog = beatLog)
      return Step(ended.copy(ids = ended.ids.copy(beat = id + 1), pairing = beating, finalBeatId = id, finalBeatAtMs = now.monoMs), commands)
    }
    if (phase.holdsService) commands += Command.Release
    return Step(ended, commands)
  }

  /** A8: `{sid, state:"ended", endReason:"operator-stopped"}`, once, never retried. */
  private fun finalBeat(phase: Phase, pairing: PairingState, now: Now): Pair<Command, Int> {
    val id = pairing.heartbeat.nextId
    // State ended: nothing publishes, so audioOk is null (D14), and with no claim device is null (D1).
    val facts = Projection.beatFacts(phase, pairing, now).copy(state = "ended", claim = null, deviceModel = null, audioOk = null, endReason = EndReason.OPERATOR_STOPPED)
    return Command.PostHeartbeat(id, pairing.request.heartbeatUrl, pairing.token, Beats.payload(facts)) to id
  }

  /** Recorded when it changes, in any phase: with no session it is kept for the next (final review I-1). */
  private fun network(phase: Phase, validated: Boolean): Step {
    if (phase.networkValidated == validated) return Step(phase)
    return Step(phase.withNetwork(validated), listOf(record("network", "validated" to validated)))
  }

  /**
   * A failure the platform knows is permanent (amendment, _Permanent failures_; final review M-5) ends
   * the pairing fatal-error, from Pairing on, when it comes from the attempt in hand. In Idle there is
   * no pairing to end: the amendment's diagram says "from any phase but Idle" and its section "from any
   * phase", and the ruling (review C0b M3) is the diagram's. One from an older attempt is stale (final
   * review N-4), and one after the end comes too late. All three are only recorded.
   */
  private fun platformFailed(phase: Phase, input: Input.PlatformFailed, now: Now): Step {
    val fields = arrayOf("attempt" to input.attemptId, "message" to input.message)
    if (phase is Phase.Idle || phase is Phase.Ended || input.attemptId < phase.attemptInHand) return Step(phase, listOf(record("platform-failed", *fields)))
    return end(phase, EndReason.FATAL_ERROR, now, *fields)
  }
}

/** Connects, drops, frames and link readings: the attempt's life. */
internal object Transports {
  /** What the platform's counters read at a connect: they restart at zero on every one ([LinkCounters]). */
  private val CONNECT_COUNTERS = LinkCounters(0, 0, 0, 0, 0, null, null, null)

  fun connect(session: Session, transport: Transport, outage: Outage?, now: Now): Step {
    val (next, connect) = connectCommand(session, transport) ?: return missingTarget(session, transport, now)
    val phase = Phase.Connecting(next, transport, ConnectStep.Requested(connect.attemptId, now.monoMs), outage)
    return Step(phase, listOf(connect, record("connecting", "transport" to transport, "attempt" to connect.attemptId)))
  }

  /**
   * A new attempt that replaces a live one: a [Command.Rebuild] or a [Command.StartNewSession]. Both
   * reconnect the link, so both ask the descriptor again (spec §1: on every reconnect), spaced as a
   * refusal's asks are (B6 ruling C1, B7).
   */
  fun replace(onAir: Phase.OnAir, session: Session, outage: Outage?, now: Now, wrap: (Command.Connect) -> Command): Step {
    val (connected, connect) = connectCommand(session, onAir.transport) ?: return missingTarget(session, onAir.transport, now)
    val (next, fetch) = if (connected.descriptor.mayAsk(now.monoMs)) askDescriptor(connected, now) else connected to null
    val phase = Phase.Connecting(next, onAir.transport, ConnectStep.Requested(connect.attemptId, now.monoMs), outage)
    val connecting = record("connecting", "transport" to onAir.transport, "attempt" to connect.attemptId)
    return Step(phase, listOfNotNull(wrap(connect), connecting, fetch))
  }

  private fun connectCommand(session: Session, transport: Transport): Pair<Session, Command.Connect>? {
    val target = session.config.target(transport) ?: return null
    val bps = session.regulation.targetBps
    val maxBw = if (transport == Transport.SRT) SrtBandwidth.maxBwBytesPerSecond(bps) else null
    val id = session.nextAttemptId
    return session.copy(nextAttemptId = id + 1) to Command.Connect(id, target, bps, maxBw)
  }

  /** Unreachable after arm's checks; kept total so a bug ends the session visibly rather than throwing. */
  private fun missingTarget(session: Session, transport: Transport, now: Now): Step =
    SessionMachine.end(Phase.Armed(session), EndReason.FATAL_ERROR, now, "transport" to transport)

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
    // G4: ignored, but recorded: a connect failure no one hears is a failure the record never shows.
    if (phase !is Phase.Connecting || step !is ConnectStep.Requested || step.attemptId != input.attemptId) {
      val fields = arrayOf("attempt" to input.attemptId, "failure" to input.failure, "phase" to phase.name, "message" to input.message)
      return Step(phase, listOf(record("connect-failed-ignored", *fields)))
    }
    return failed(phase, input.failure, input.message, now)
  }

  /**
   * A failed connect: counted or not by the fallback policy, then a retry [SessionMachine.RETRY_MS]
   * later. A [drop] before the connect answered is judged by the policy's drop rule with nothing
   * published: the far end closing counts (F-P5-2's collapse), a local stop does not (B6 review m5).
   */
  fun failed(phase: Phase.Connecting, failure: ConnectFailure, message: String?, now: Now, drop: DropReason? = null): Step {
    val session = phase.session
    val validated = session.networkValidated
    val decision = if (drop == null) session.fallback.connectFailed(failure, validated) else session.fallback.dropped(drop, validated, publishedMs = 0)
    val commands = mutableListOf(failedRecord(phase.transport, failure, drop, validated, decision.counted, message))
    if (decision.fellBack) commands += record("fell-back", "from" to phase.transport, "to" to decision.policy.current)
    var next = session.copy(fallback = decision.policy)
    // Ruling 15: refused ingest may mean the organiser stopped the session. B6 ruling C1 spaces them.
    if (failure == ConnectFailure.REFUSED && next.descriptor.mayAsk(now.monoMs)) {
      val (asked, fetch) = askDescriptor(next, now)
      next = asked
      commands += fetch
    }
    val (spaced, retryMs, line) = retryAfterFailure(next)
    line?.let(commands::add)
    val waiting = ConnectStep.Waiting(now.monoMs + retryMs)
    return Step(phase.copy(session = spaced, transport = decision.policy.current, step = waiting), commands)
  }

  /** N29, R10: a rejoin's connects back off ([Rejoin.delayAfter]); every other retry waits [SessionMachine.RETRY_MS]. */
  private fun retryAfterFailure(session: Session): Triple<Session, Long, Command?> {
    val rejoin = session.rejoin ?: return Triple(session, SessionMachine.RETRY_MS, null)
    val failures = rejoin.failures + 1
    val retryMs = Rejoin.delayAfter(failures)
    return Triple(session.copy(rejoin = rejoin.copy(failures = failures)), retryMs, record("rejoin-retry", "retryMs" to retryMs, "failures" to failures))
  }

  private fun failedRecord(transport: Transport, failure: ConnectFailure, drop: DropReason?, validated: Boolean, counted: Boolean, message: String?): Command {
    val fields =
      listOfNotNull(
        "transport" to transport,
        "failure" to failure,
        drop?.let { "reason" to it },
        "validated" to validated,
        "counted" to counted,
        "message" to message,
      )
    return record("connect-failed", *fields.toTypedArray())
  }

  /** The code asked again on a reconnect (spec §1), spaced as plan B's descriptor asks were. */
  private fun askDescriptor(session: Session, now: Now): Pair<Session, Command> {
    val (asks, id) = session.descriptor.asked(now.monoMs)
    return session.copy(descriptor = asks) to Starts.fetchCode(session.pairing, id)
  }

  fun dropped(phase: Phase, input: Input.Dropped, now: Now): Step {
    val step = (phase as? Phase.Connecting)?.step
    if (phase is Phase.Connecting && step is ConnectStep.Requested && step.attemptId == input.attemptId) {
      return failed(phase, ConnectFailure.OTHER, input.message, now, drop = input.reason)
    }
    if (phase !is Phase.OnAir || phase.attemptId != input.attemptId) return Step(phase)
    val (session, fetch) = askDescriptor(phase.session, now)
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
        fetch,
      )
    if (decision.fellBack) commands += record("fell-back", "from" to phase.transport, "to" to decision.policy.current)
    val (next, retryMs, line) = retryAfterFailure(session.copy(fallback = decision.policy, regulation = BitrateRegulator.afterDrop(session.regulation, now.monoMs)))
    line?.let(commands::add)
    val waiting = ConnectStep.Waiting(now.monoMs + retryMs)
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
    val (watchdog, verdict) =
      phase.watchdog.frames(input.videoFrames, input.audioFrames, now.monoMs, session.camera.slateOnAir, session.micSilenced, session.device?.shed)
    var next = phase.copy(watchdog = watchdog)
    val commands = mutableListOf<Command>()
    if (watchdog.advancing(now.monoMs)) {
      if (next.session.liveSinceEpochMs == null) {
        // N29: a rejoin goes live again on its first live time, so the HUD's clock carries on; the lapse is spent.
        val session = next.session
        val since = session.rejoin?.liveSinceEpochMs ?: now.wallMs
        next = next.copy(session = session.copy(liveSinceEpochMs = since, rejoin = null, pairing = session.pairing.copy(lapsed = null)))
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
      is Phase.Arming -> Starts.tick(phase, now)
      is Phase.Idle, is Phase.Pairing, is Phase.Paired, is Phase.Armed, is Phase.Ended -> Step(phase)
    }

  private fun connecting(connecting: Phase.Connecting, now: Now): Step {
    if (connecting.outage?.hold?.expired(now.monoMs) == true) return expired(connecting, connecting.outage, now)
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

  /**
   * What the tick would judge first, before an input other than the tick or a stop (B6 ruling C2), in
   * the tick's own order: a hold that has run out ends the session (B7 N1), so nothing is sent into a
   * hold that is already over, and the input lands on the ended session, where it can reopen nothing
   * (B7 ruling m2); then the no-video judgement. A platform failure is judged by [holdRanOut] alone.
   */
  fun judged(phase: Phase, now: Now): Step {
    holdRanOut(phase, now)?.let { return it }
    if (phase !is Phase.OnAir) return Step(phase)
    val verdict = phase.watchdog.tick(now.monoMs, phase.session.camera.slateOnAir).second
    return if (verdict is StallVerdict.Rebuild) rebuild(phase, verdict, now) else Step(phase)
  }

  /** The session ended by a hold that has run out (B7 N1), or null while none has. */
  fun holdRanOut(phase: Phase, now: Now): Step? {
    val outage = (phase as? Phase.OnAir)?.outage ?: (phase as? Phase.Connecting)?.outage
    if (outage != null && outage.hold.expired(now.monoMs)) return expired(phase, outage, now)
    return null
  }

  private fun onAir(phase: Phase.OnAir, now: Now): Step {
    val outage = phase.outage
    if (outage != null && outage.hold.expired(now.monoMs)) return expired(phase, outage, now)
    val (watchdog, verdict) = phase.watchdog.tick(now.monoMs, phase.session.camera.slateOnAir)
    val watched = phase.copy(watchdog = watchdog)
    if (verdict is StallVerdict.Rebuild) return rebuild(watched, verdict, now)
    // Publishing time counts only while frames advance: our own reopen or switch pauses it until the
    // camera's first frame, so a pause of ours never reads as Cloudflare falling behind.
    val (delivery, requests) = watched.session.delivery.tick(now.monoMs, watchdog.advancing(now.monoMs))
    val polled = watched.copy(session = watched.session.copy(delivery = delivery))
    return Step(polled, requests.map { Command.FetchPlaylist(it.id, it.url) })
  }

  /**
   * The hold ran out: the broadcast is over for this phone, back to Paired. The server may keep it open, and a `live`
   * for the same sid rejoins it (A10; N29, R10): the pairing remembers the sid and when it first went live.
   */
  private fun expired(phase: Phase, outage: Outage, now: Now): Step {
    val over = Verdicts.over(phase, LastEnd.HOLD_WINDOW_EXPIRED, now)
    val lapsed = phase.session?.let { session -> session.liveSinceEpochMs?.let { Lapsed(session.sid, it) } }
    val paired = over.phase as? Phase.Paired
    val marked = if (paired != null && lapsed != null) paired.copy(pairing = paired.pairing.copy(lapsed = lapsed)) else over.phase
    return over.copy(phase = marked, commands = listOf(record("hold-expired", "transport" to outage.hold.transport, "cause" to outage.cause)) + over.commands)
  }

  /**
   * The stall watchdog asked for a rebuild (F-P5-6, F-P5-9). The record's `msSinceAdvance` counts
   * from the last frame; for `no-first-frame`, from the connect; and when `rebaselined` is true, from
   * our own camera reopen, which is not a frame (carry 7), or for a switch from the tap or the last
   * frame before it ([Devices.switched]).
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
  /** I2: the slate is a picture sent in our camera's place, so it goes up only while sending. Armed sends nothing. */
  private fun sending(phase: Phase) = phase is Phase.Connecting || phase is Phase.OnAir

  fun contended(phase: Phase): Step {
    val session = phase.session ?: return onPairing(phase, CameraState.TAKEN, record("camera-taken")) { it != CameraState.TAKEN }
    if (session.camera == CameraState.TAKEN) return Step(phase)
    val next = phase.withSession(session.copy(camera = CameraState.TAKEN))
    // Taken again mid-reopen: the slate never came down, so it is not put up twice.
    val slate = if (!sending(phase) || session.camera.slateOnAir) emptyList() else listOf(Command.Slate(on = true))
    return Step(next, slate + record("camera-taken"))
  }

  fun released(phase: Phase): Step {
    val session = phase.session ?: return onPairing(phase, CameraState.REOPENING, Command.ReopenCamera, record("camera-released")) { it == CameraState.TAKEN }
    if (session.camera != CameraState.TAKEN) return Step(phase)
    return Step(phase.withSession(session.copy(camera = CameraState.REOPENING)), listOf(Command.ReopenCamera, record("camera-released")))
  }

  fun reopened(phase: Phase, ok: Boolean, now: Now): Step {
    val session = phase.session ?: return onPairing(phase, CameraState.OWN, record("camera-reopened", "ok" to ok)) { it == CameraState.REOPENING }
    if (session.camera != CameraState.REOPENING) return Step(phase)
    val own = phase.withSession(session.copy(camera = CameraState.OWN))
    val commands = (if (sending(phase)) listOf(Command.Slate(on = false)) else emptyList()) + record("camera-reopened", "ok" to ok)
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

  /** I3: no broadcast held, so the pairing keeps the camera. No slate: nothing is sent. Ended keeps nothing. */
  private fun onPairing(phase: Phase, to: CameraState, vararg commands: Command, from: (CameraState) -> Boolean): Step {
    val pairing = phase.pairing?.takeIf { phase !is Phase.Ended && from(it.camera) } ?: return Step(phase)
    return Step(phase.withPairing(pairing.copy(camera = to)), commands.toList())
  }

  /**
   * The operator's switch (ruling 14). On air, the stall watchdog starts a fresh rate window, so the
   * switch's frame pause is not a rate-floor rebuild, and the session's LIVE state holds until the
   * new camera's first frame. Only while frames advance is a switch handled that way (B6 review
   * I1): before the first frame, F-P5-6's 5 s grace already covers the pause, and a picture already
   * past its stall window was judged a rebuild before this input (B6 ruling C2). A re-baseline
   * clears the last frame, and the camera is ours again in the step that brings the next one, so a
   * second switch before the new camera's first frame keeps the first one's window.
   *
   * The owner-visible bound (B6 review m4, B6 fix 2, B7 N3): a healthy switch, one taken within
   * [StallWatchdog.FRAME_SAMPLE_MS] of a frame, has its full 3 s from the tap. Any other counts from
   * the last frame before the first switch, so a switch in the middle of a stall cannot stretch LIVE.
   * The next input at or after those 3 s rebuilds, and the tick is an input every [Engine.TICK_MS]. So
   * LIVE outlasts the last real frame by at most 3.5 s while Frames readings come every tick, and by
   * under 4 s when no reading follows the tap and the ticks fall off the frame grid (B7 ruling m1,
   * amended).
   * Plan C keeps the readings coming through a switch, flat or not.
   */
  fun switched(phase: Phase, now: Now): Step {
    val session = phase.session ?: return SessionMachine.ignored(phase, "switch-camera")
    if (session.camera.slateOnAir) return SessionMachine.ignored(phase, "switch-camera")
    val commands = listOf(Command.SwitchCamera, record("camera-switched"))
    if (phase !is Phase.OnAir || !phase.watchdog.advancing(now.monoMs)) return Step(phase, commands)
    // Advancing means a frame has arrived, so the fallback to now never applies.
    val lastFrameMs = phase.watchdog.lastAdvanceAtMs ?: now.monoMs
    val fromMs = if (now.monoMs - lastFrameMs < StallWatchdog.FRAME_SAMPLE_MS) now.monoMs else lastFrameMs
    val switching = phase.copy(session = session.copy(camera = CameraState.SWITCHING), watchdog = phase.watchdog.rebaselined(fromMs))
    return Step(switching, commands)
  }

  /** Recorded when it changes, in any phase: with no session it is kept for the next (review 18 I1). */
  fun mic(phase: Phase, silenced: Boolean): Step {
    if (phase.micSilenced == silenced) return Step(phase)
    val kind = if (silenced) "mic-silenced" else "mic-restored"
    return Step(phase.withMic(silenced), listOf(record(kind)))
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
    // Re-review 6: a rendition refused off the playback host leaves delivery unknown; the record says why, once.
    if (watch.refusedOffHost && !session.delivery.refusedOffHost) commands += record("rendition-refused", "reason" to DeliveryWatch.OFF_HOST)
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

/** The pairing's beats (amendment, _Contract shapes_): Paired to On air, never gating anything. */
internal object Heartbeats {
  fun tick(step: Step, now: Now): Step {
    val phase = step.phase
    val pairing = phase.beating ?: return step
    val held = phase.heldSid
    val interval = BeatCadence.intervalMs(pairing.waiting.pollSeconds, held = held != null)
    val (heartbeat, id) = Heartbeat.due(pairing.heartbeat, now.monoMs, now.wallMs, interval)
    val commands = step.commands.toMutableList()
    val timedOut = heartbeat.failures > pairing.heartbeat.failures
    if (timedOut) commands += record("heartbeat", "result" to HeartbeatResult.FAILED, "message" to "no answer")
    // Plan D §3.4: a beat given up is a failed one in the minute's count.
    val counted = if (timedOut) pairing.beatLog.heard(word = null, ok = false) else pairing.beatLog
    if (id == null) return Step(phase.withPairing(pairing.copy(heartbeat = heartbeat, beatLog = counted)), commands)
    // RR3: the stopped sid rides only a beat that holds none.
    val carried = if (held == null) pairing.stopped?.sid else null
    val (beatLog, lines) = counted.send(id, interval, held = held != null, now)
    val next = pairing.copy(heartbeat = heartbeat, stoppedInFlight = carried, beatLog = beatLog)
    val nextPhase = phase.withPairing(next)
    val body = Beats.payload(Projection.beatFacts(nextPhase, next, now))
    commands += lines.map { Command.Record(it) }
    commands += Command.PostHeartbeat(id, pairing.request.heartbeatUrl, pairing.token, body)
    return Step(nextPhase, commands)
  }

  fun answered(phase: Phase, input: Input.HeartbeatAnswered, now: Now): Step {
    val pairing = phase.beating ?: return Step(phase)
    val heartbeat = Heartbeat.answered(pairing.heartbeat, input.beatId, input.response, now.monoMs)
    if (heartbeat == pairing.heartbeat) return Step(phase)
    val response = input.response as? HeartbeatResponse.Answered
    val word = ServerWord.ofBeat(input.response, named = phase.heldSid ?: pairing.stoppedInFlight)
    val ok = response != null && response.status in 200..299
    // Final review I-2b: a 2xx whose waiting fields cannot be read leaves the pairing's as they were, and says so.
    val unreadable = WaitingUnread.line(pairing, response?.reply?.waitingUnreadable?.takeIf { ok }, "beat")
    val refreshed =
      pairing.copy(
        heartbeat = heartbeat,
        claim = if (ok) null else pairing.claim,
        waiting = response?.reply?.waiting?.takeIf { ok }?.overBeat(pairing.waiting) ?: pairing.waiting,
        stoppedInFlight = null,
        waitingUnreadableSaid = pairing.waitingUnreadableSaid || unreadable != null,
        beatLog = pairing.beatLog.heard(word::class.simpleName, ok),
      )
    // The beat line. Its claim is the one the answered beat carried, before this answer cleared it
    // (PV11). Paired or held, it is written only when it changes, message aside (N25, owner
    // 2026-10-09: count beats, don't list them): the minute's `beats` line counts every beat, so
    // hours of waiting or of air cost a few lines.
    val fields =
      listOf(
        "result" to heartbeat.lastResult,
        "status" to response?.status,
        "word" to word::class.simpleName,
        "claim" to pairing.claim,
        "message" to (input.response as? HeartbeatResponse.Failed)?.message,
      )
    val compared = fields.filter { it.first != "message" }
    val changed = compared != pairing.lastBeatLine
    val noted = if (changed) listOf(Command.Record(RecordEntry("heartbeat", fields))) else emptyList()
    // A17: a beat that carried the stopped record and was heard delivers it (G0-g); a 401 ends its code.
    val status = response?.status
    val delivered = pairing.stoppedInFlight != null && StoppedRecord.delivered(status)
    val codeDead = word == ServerWord.CodeEnded && pairing.stopped != null
    val deletes = if (delivered || codeDead) listOf(Command.DeleteStopped(pairing.name.code, pairing.name.slot), record("stopped-delivered", "status" to status)) else emptyList()
    // The refused set keeps the sid for the pairing's life (A17): a server that names it later is still ignored.
    val kept = (if (delivered || codeDead) refreshed.copy(stopped = null) else refreshed).copy(lastBeatLine = compared)
    val decided = Verdicts.beat(phase.withPairing(kept), word, now)
    return decided.copy(commands = noted + listOfNotNull(unreadable) + deletes + decided.commands)
  }
}
