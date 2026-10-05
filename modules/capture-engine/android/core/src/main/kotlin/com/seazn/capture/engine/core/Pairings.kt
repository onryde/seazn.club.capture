package com.seazn.capture.engine.core

private fun line(kind: String, vararg fields: Pair<String, Any?>): Command = Command.Record(RecordEntry(kind, fields.toList()))

/** Pairing, the settings, readiness and the start gate (amendment, _The engine port_ and A11). */
internal object Pairings {
  fun pair(phase: Phase, input: Input.Pair, now: Now): Step {
    // The request is read only once the pair can act: one the machine ignores never runs (B7 E1).
    if (phase.holdsBroadcast || phase is Phase.Ended) return SessionMachine.ignored(phase, "pair")
    val name = input.request.name
    if ((phase is Phase.Pairing || phase is Phase.Paired) && phase.pairing?.name == name) return SessionMachine.ignored(phase, "pair")
    val problems = input.request.problems() + input.phone.problems()
    if (problems.isNotEmpty()) {
      val refused = line("pair-refused", "problems" to problems.joinToString("; "))
      val release = if (phase.holdsService) listOf(Command.Release) else emptyList()
      return Step(phase.ended(EndReason.FATAL_ERROR, now), listOf(refused, Command.End(EndReason.FATAL_ERROR)) + release)
    }
    // Leaving a pairing: Release only from Paired, where the Hold went; Pairing has not held the service yet.
    val left =
      when (phase) {
        is Phase.Paired -> listOf(Command.Release, line("unpaired", "reason" to "re-pair"))
        is Phase.Pairing -> listOf(line("unpaired", "reason" to "re-pair"))
        else -> emptyList()
      }
    val ids = phase.ids
    val stopped = input.stopped?.takeIf { it.isFor(name) && it.current(now.wallMs) }
    val pairing =
      PairingState(
        request = input.request,
        phone = input.phone,
        claim = input.request.claim,
        // The zone the scan's GET gave: the engine holds it from here (D4: a beat carries none).
        waiting = WaitingFields.UNKNOWN.copy(venueTimezone = input.request.venueTimezone),
        automatic = input.request.automatic,
        language = input.request.language,
        heartbeat = HeartbeatState(nextId = ids.beat),
        stopped = stopped,
        refused = setOfNotNull(stopped?.sid),
        starts = StartAsks(nextId = ids.start),
      )
    val asked = line("pair", "claim" to input.request.claim, "slot" to name.slot, "tokenTag" to name.tokenTag, "stopped" to (stopped != null))
    return Step(Phase.Pairing(pairing, ids, phase.networkValidated, phase.micSilenced), left + asked + Command.AskPermissions)
  }

  fun permissions(phase: Phase, granted: Boolean, now: Now): Step {
    if (phase !is Phase.Pairing) return Step(phase, listOf(line("permissions-late", "granted" to granted)))
    if (!granted) {
      val idle = Phase.Idle(phase.ids, phase.networkValidated, phase.micSilenced, Unpaired(UnpairReason.PERMISSIONS, phase.pairing.name))
      return Step(idle, listOf(line("unpaired", "reason" to UnpairReason.PERMISSIONS)))
    }
    val paired = Phase.Paired(phase.pairing.copy(heartbeat = phase.pairing.heartbeat.soon(now.monoMs)), phase.ids, phase.networkValidated, phase.micSilenced)
    // The claim goes at once (A9): the first beat is due now.
    return Heartbeats.tick(Step(paired, listOf(Command.Hold, line("paired"))), now)
  }

  fun unpair(phase: Phase): Step =
    when (phase) {
      is Phase.Paired -> Step(Phase.Idle(phase.ids, phase.networkValidated, phase.micSilenced), listOf(Command.Release, line("unpaired", "reason" to "operator")))
      is Phase.Pairing -> Step(Phase.Idle(phase.ids, phase.networkValidated, phase.micSilenced), listOf(line("unpaired", "reason" to "operator")))
      else -> SessionMachine.ignored(phase, "unpair")
    }

  /** The engine leaves the pairing without the operator asking: the code is forgotten by JS (A9, the 401 rule). */
  fun unpaired(phase: Phase, reason: UnpairReason, now: Now): Step {
    val pairing = phase.pairing ?: return Step(phase)
    val commands = mutableListOf<Command>()
    if (phase is Phase.Connecting || phase is Phase.OnAir) commands += Command.StopBroadcast
    commands += Command.Release
    if (reason == UnpairReason.CODE_ENDED && pairing.stopped != null) commands += Command.DeleteStopped(pairing.name.code, pairing.name.slot)
    commands += line("unpaired", "reason" to reason, "wasLive" to (phase.session?.liveSinceEpochMs != null))
    return Step(Phase.Idle(phase.ids, phase.networkValidated, phase.micSilenced, Unpaired(reason, pairing.name)), commands)
  }

  fun automatic(phase: Phase, on: Boolean): Step {
    val pairing = phase.pairing?.takeIf { phase !is Phase.Ended } ?: return SessionMachine.ignored(phase, "set-automatic")
    return Step(phase.withPairing(pairing.copy(automatic = on)), listOf(line("automatic", "on" to on)))
  }

  fun language(phase: Phase, language: String): Step {
    val pairing = phase.pairing?.takeIf { phase !is Phase.Ended } ?: return SessionMachine.ignored(phase, "set-language")
    return Step(phase.withPairing(pairing.copy(language = language)))
  }

  /** A fact, not an intent: kept in any paired phase, dropped otherwise (the bridge replays it at pair). */
  fun readiness(phase: Phase, readiness: Readiness): Step {
    val pairing = phase.pairing?.takeIf { phase !is Phase.Ended } ?: return Step(phase)
    return Step(phase.withPairing(pairing.copy(readiness = readiness)))
  }

  /**
   * A11: Armed connects on its own once native judges the phone ready, held or remote, one gate. The
   * side held becomes the broadcast's encoded rotation, read once, here. Run after every input.
   */
  fun gate(step: Step, now: Now): Step {
    val armed = step.phase as? Phase.Armed ?: return step
    val session = armed.session
    if (session.pairing.readiness.notReady(session.camera, session.networkValidated) != null) return step
    val side = session.pairing.readiness.side
    val connected = Transports.connect(session.copy(side = side), session.fallback.current, outage = null, now = now)
    return connected.copy(commands = step.commands + Command.Orient(side) + line("ready", "side" to side) + connected.commands)
  }
}

/** Arming: the code fetched for one broadcast's credentials (A5, _Who reads what_). */
internal object Starts {
  /** Arming for [sid]: the line the operator saw is cleared, and the code is fetched at once. */
  fun arm(phase: Phase, pairing: PairingState, sid: String, cause: Cause, now: Now): Step {
    val ids = phase.ids
    // I1: whatever arms the broadcast retires the hold's POST start, so its answer, arriving after, is late.
    val cleared = pairing.copy(refusal = null, startFailed = null, lastEnd = null, starts = pairing.starts.copy(inFlightId = null))
    val (asks, id) = DescriptorAsks(nextId = ids.descriptor).asked(now.monoMs)
    val arming = Phase.Arming(cleared, sid, cause, ids, phase.networkValidated, phase.micSilenced, asks)
    return Step(arming, listOf(line("broadcast-start", "sid" to sid, "cause" to cause), fetchCode(pairing, id)))
  }

  /** An open session shape for the sid in hand: the broadcast's plan, then Armed. */
  fun opened(arming: Phase.Arming, answer: CodeAnswer.Open): Step {
    // Final review I-2b: unreadable waiting fields keep the pairing's, and are said once a pairing; the broadcast opens.
    val unreadable = WaitingUnread.line(arming.pairing, answer.waitingUnreadable, "descriptor")
    val landed = answer.waiting?.let { arming.pairing.copy(waiting = it.over(arming.pairing.waiting)) } ?: arming.pairing
    val pairing = if (unreadable != null) landed.copy(waitingUnreadableSaid = true) else landed
    val descriptor = answer.descriptor
    val config = descriptor.config(arming.sid, pairing)
    val ids = arming.ids
    val session =
      Session(
        pairing = pairing,
        sid = arming.sid,
        cause = arming.cause,
        broadcast = descriptor,
        config = config,
        fallback = FallbackPolicy(config.primary.transport, config.fallback?.transport),
        regulation = BitrateRegulator.sessionStarted(),
        delivery = DeliveryWatch(config.playbackUrl, nextRequestId = ids.playlist),
        camera = pairing.camera,
        nextAttemptId = ids.attempt,
        descriptor = arming.asks,
        networkValidated = arming.networkValidated,
        micSilenced = arming.micSilenced,
      )
    val armed = line("armed", "sid" to arming.sid, "transport" to config.primary.transport, "srtOffered" to descriptor.srtOffered, "playbackUrl" to config.playbackUrl)
    return Step(Phase.Armed(session), listOfNotNull(unreadable, armed))
  }

  /** The tick in Arming: fetch again once the asks' spacing and any Retry-After allow, unless a claim is awaited. */
  fun tick(arming: Phase.Arming, now: Now): Step {
    if (arming.notCurrent || now.monoMs < arming.notBeforeMs || !arming.asks.mayAsk(now.monoMs)) return Step(arming)
    val (asks, id) = arming.asks.asked(now.monoMs)
    return Step(arming.copy(asks = asks), listOf(fetchCode(arming.pairing, id)))
  }

  /** The code's answer at Arming: every row of the amendment's _Start failures_, and the over verdicts. */
  fun answered(arming: Phase.Arming, input: Input.CodeAnswered, now: Now): Step {
    val asks = arming.asks.answered(input.requestId) ?: return Step(arming)
    val answered = arming.copy(asks = asks, retrying = false)
    val sid = arming.sid
    return when (val answer = input.answer) {
      is CodeAnswer.Open ->
        if (answer.sid != sid) Verdicts.over(answered, LastEnd.STOPPED, now)
        else if (answer.descriptor.config(sid, arming.pairing).problems().isNotEmpty()) failed(answered, StartFailure.CONFIG, now)
        else opened(answered, answer)
      is CodeAnswer.Over -> if (answer.sid == sid) Verdicts.over(answered, LastEnd.of(answer.endReason), now) else Step(answered)
      is CodeAnswer.Waiting -> Verdicts.over(answered, LastEnd.STOPPED, now)
      is CodeAnswer.NotCurrent -> if (answer.sid != sid) Verdicts.over(answered, LastEnd.STOPPED, now) else notCurrent(answered, now)
      is CodeAnswer.ForeignIngest -> failed(answered, StartFailure.CRED_HOST, now, line("cred-host-refused", "sid" to sid))
      is CodeAnswer.Unreadable -> failed(answered, StartFailure.CONFIG, now, line("code-unreadable", "problem" to answer.problem))
      is CodeAnswer.Status ->
        when (answer.status) {
          401 -> Pairings.unpaired(answered, UnpairReason.CODE_ENDED, now)
          404 -> failed(answered, StartFailure.NOT_FOUND, now)
          410 -> Verdicts.over(answered, LastEnd.of(answer.endReason), now)
          429 -> Step(answered.copy(notBeforeMs = now.monoMs + BeatCadence.retryAfterMs(answer.retryAfterS ?: 0), retrying = true), listOf(line("code", "status" to 429)))
          else -> Step(answered.copy(retrying = true), listOf(line("code", "status" to answer.status)))
        }
      is CodeAnswer.Unreachable -> Step(answered.copy(retrying = true), listOf(line("code", "answer" to "unreachable", "message" to answer.message)))
    }
  }

  /**
   * A start that failed for S: back to Paired, S refused for this pairing, the line until the next start.
   *
   * Item 4 ruling (2026-10-05, server facts at stg da3297a33): the server only records a beat's `startFailed`, so S
   * stayed warming and every Go live was answered 409 already_live with it. S is now stopped as a never-live Stop
   * is (owner decision 1): its record written, and one beat at once carrying `startFailed` and `stopped: S`, with sid
   * and cause null (capture-beat.v1 allows it: `stopped` only while sid is null, `cause` null while sid is null). The
   * server ends S as operator_stopped (T23) and keeps the pairing. The record's own path delivers it: carried until a
   * 2xx deletes it, never twice. The store holds one record a pairing: one undelivered from before is replaced, and
   * the server, which answered S since, ended it.
   */
  fun failed(arming: Phase.Arming, failure: StartFailure, now: Now, vararg extra: Command): Step {
    val stopped = StoppedRecord.of(arming.pairing.name, arming.sid, now.wallMs, null)
    val pairing =
      arming.pairing.copy(
        refused = arming.pairing.refused + arming.sid,
        startFailed = failure,
        refusal = Refusal.START_FAILED,
        stopped = stopped,
        heartbeat = arming.pairing.heartbeat.copy(lastSentAtMonoMs = null),
      )
    val noted = line("start-failed", "sid" to arming.sid, "failure" to failure)
    val step = Step(Phase.Paired(pairing, arming.ids, arming.networkValidated, arming.micSilenced), extra.toList() + noted + Command.WriteStopped(stopped))
    return Heartbeats.tick(step, now)
  }

  /** G0-d: not the current phone yet. A `resume` claim at once, so it can never take the slot. */
  private fun notCurrent(arming: Phase.Arming, now: Now): Step {
    val pairing = arming.pairing.copy(claim = Claim.RESUME, heartbeat = arming.pairing.heartbeat.soon(now.monoMs))
    // At once, as the claim at a pairing goes: the beat is due now, so it goes in this step.
    return Heartbeats.tick(Step(arming.copy(pairing = pairing, notCurrent = true), listOf(line("not-current", "sid" to arming.sid))), now)
  }

  /** The claim was answered naming S: fetch the code again, spaced as the asks are. */
  fun claimed(arming: Phase.Arming, now: Now): Step {
    val cleared = arming.copy(notCurrent = false, notBeforeMs = 0)
    val (asks, id) = cleared.asks.asked(now.monoMs)
    return Step(cleared.copy(asks = asks), listOf(fetchCode(arming.pairing, id)))
  }

  /** The code's `GET` for [pairing], as ask [id] (G0-d): on arming, on the Arming tick, and on every reconnect. */
  fun fetchCode(pairing: PairingState, id: Int): Command.FetchCode =
    Command.FetchCode(id, pairing.request.codeUrl, pairing.token, pairing.phone.phoneId, pairing.name.slot, pairing.request.environment)
}

/** The answer table (amendment, _The answer table_), by phase, and the operator's start. */
internal object Verdicts {
  /** The server's word on a beat, after the pairing's own bookkeeping ([Heartbeats.answered]). */
  fun beat(phase: Phase, word: ServerWord, now: Now): Step {
    val pairing = phase.pairing ?: return Step(phase)
    if (word is ServerWord.Open && word.sid in pairing.refused) return Step(phase, listOf(line("open-ignored", "sid" to word.sid)))
    return when (phase) {
      is Phase.Paired -> paired(phase, pairing, word, now)
      is Phase.Arming, is Phase.Armed, is Phase.Connecting, is Phase.OnAir -> held(phase, pairing, word, now)
      else -> Step(phase)
    }
  }

  private fun paired(phase: Phase.Paired, pairing: PairingState, word: ServerWord, now: Now): Step =
    when (word) {
      is ServerWord.Open -> Starts.arm(phase, pairing, word.sid, word.cause ?: Cause.ORGANISER, now)
      ServerWord.Replaced -> Pairings.unpaired(phase, UnpairReason.REPLACED, now)
      ServerWord.Taken -> Pairings.unpaired(phase, UnpairReason.TAKEN, now)
      ServerWord.CodeEnded -> Pairings.unpaired(phase, UnpairReason.CODE_ENDED, now)
      else -> Step(phase)
    }

  private fun held(phase: Phase, pairing: PairingState, word: ServerWord, now: Now): Step {
    val held = phase.heldSid!!
    return when {
      word == ServerWord.Replaced -> Pairings.unpaired(phase, UnpairReason.REPLACED, now)
      word == ServerWord.CodeEnded && phase is Phase.Arming -> Pairings.unpaired(phase, UnpairReason.CODE_ENDED, now)
      word == ServerWord.CodeEnded -> codeEndedPending(phase, pairing)
      word == ServerWord.NotFound && phase is Phase.Arming -> Starts.failed(phase, StartFailure.NOT_FOUND, now)
      word is ServerWord.Open && word.sid == held -> if (phase is Phase.Arming && phase.notCurrent) Starts.claimed(phase, now) else Step(phase)
      word is ServerWord.Open -> {
        val over = over(phase, LastEnd.STOPPED, now)
        val next = over.phase as? Phase.Paired ?: return over
        val armed = Starts.arm(next, next.pairing, word.sid, word.cause ?: Cause.ORGANISER, now)
        armed.copy(commands = over.commands + armed.commands)
      }
      word.ends(held) -> over(phase, LastEnd.of((word as? ServerWord.Over)?.endReason), now)
      else -> Step(phase)
    }
  }

  /** A 401 while S is held from Armed on: S runs on, and the pairing ends with it (the 401 deferral). */
  private fun codeEndedPending(phase: Phase, pairing: PairingState): Step =
    Step(phase.withPairing(pairing.copy(codeEndedPending = true)), listOf(line("code-ended-pending")))

  /**
   * The held broadcast is over without the operator: back to Paired with [lastEnd], or, after a 401
   * heard while it was held, to Idle with code-ended (the 401 deferral).
   */
  fun over(phase: Phase, lastEnd: LastEnd, now: Now): Step {
    val pairing = phase.pairing ?: return Step(phase)
    if (pairing.codeEndedPending) return Pairings.unpaired(phase, UnpairReason.CODE_ENDED, now)
    val publishing = phase is Phase.Connecting || phase is Phase.OnAir
    val ended = line("broadcast-ended", "sid" to phase.heldSid, "lastEnd" to lastEnd, "wasLive" to (phase.session?.liveSinceEpochMs != null))
    val paired = Phase.Paired(pairing.copy(lastEnd = lastEnd, camera = phase.camera ?: CameraState.OWN), phase.ids, phase.networkValidated, phase.micSilenced)
    return Step(paired, listOfNotNull(if (publishing) Command.StopBroadcast else null, ended))
  }

  /** The code's answer: at Arming it decides the start; on a reconnect only the over verdicts act. */
  fun code(phase: Phase, input: Input.CodeAnswered, now: Now): Step {
    val held = phase.heldSid ?: return Step(phase)
    return if (phase is Phase.Arming) Starts.answered(phase, input, now) else reconnectAnswer(phase, held, input, now)
  }

  /**
   * A reconnect's fetch (plan B: on every reconnect): the over verdicts end S; a 401 is the 401 deferral,
   * as on a beat (either source's 401 is `CodeEnded`); anything else is recorded.
   */
  private fun reconnectAnswer(phase: Phase, held: String, input: Input.CodeAnswered, now: Now): Step {
    val session = phase.session ?: return Step(phase)
    val asks = session.descriptor.answered(input.requestId) ?: return Step(phase)
    val answered = phase.withSession(session.copy(descriptor = asks))
    val word = ServerWord.ofCode(input.answer, held)
    // One rule for the server's word: Over(S), NoBroadcast and another sid (with or without cred, M8) end S.
    if (word.ends(held)) return over(answered, LastEnd.of((word as? ServerWord.Over)?.endReason), now)
    if (word == ServerWord.CodeEnded) return codeEndedPending(answered, answered.pairing!!)
    // Plan B's descriptor line kept why the server could not be reached; so does this one (carry 12 masks it).
    val message = (input.answer as? CodeAnswer.Unreachable)?.message
    return Step(answered, listOf(line("code", "answer" to input.answer::class.simpleName, "message" to message)))
  }

  /** The operator's hold: `POST start` from Paired when ready (A11); one in flight at a time. */
  fun postStart(phase: Phase, now: Now): Step {
    if (phase !is Phase.Paired) return SessionMachine.ignored(phase, "start")
    val pairing = phase.pairing
    val notReady = pairing.readiness.notReady(pairing.camera, phase.networkValidated)
    if (notReady != null || pairing.starts.inFlightId != null) return SessionMachine.ignored(phase, "start")
    val id = pairing.starts.nextId
    val asked = pairing.copy(starts = StartAsks(id + 1, id), refusal = null, startFailed = null, lastEnd = null)
    val post = Command.PostStart(id, pairing.request.startUrl, pairing.token, Beats.startBody(pairing.phone.phoneId))
    return Step(phase.withPairing(asked), listOf(post, line("start-asked")))
  }

  /**
   * `POST start`'s answer. The one in flight decides in Paired. Any other is late: a broadcast armed
   * first and retired it (I1), so it never moves the engine and never shows a refusal; it is recorded.
   */
  fun started(phase: Phase, input: Input.StartAnswered, now: Now): Step {
    val pairing = phase.pairing ?: return Step(phase)
    if (input.answer == StartAnswer.CodeEnded) return codeEnded(phase, input.requestId, now)
    if (pairing.starts.inFlightId != input.requestId) {
      return Step(phase, listOf(line("start-answered", "answer" to input.answer::class.simpleName, "late" to true)))
    }
    val answered = phase.withPairing(pairing.copy(starts = pairing.starts.copy(inFlightId = null)))
    val noted = line("start-answered", "answer" to input.answer::class.simpleName)
    if (answered !is Phase.Paired) return Step(answered, listOf(noted))
    val p = answered.pairing
    val named = (input.answer as? StartAnswer.Started)?.sid ?: (input.answer as? StartAnswer.AlreadyLive)?.sid
    if (named != null && named in p.refused) return refusedSid(answered, input.answer)
    val step =
      when (val answer = input.answer) {
        is StartAnswer.Started -> Starts.arm(answered, p, answer.sid, Cause.OPERATOR, now)
        is StartAnswer.AlreadyLive -> Starts.arm(answered, p, answer.sid, Cause.startedBy(answer.startedBy), now)
        StartAnswer.Replaced -> Pairings.unpaired(answered, UnpairReason.REPLACED, now)
        is StartAnswer.Refused -> Step(answered.withPairing(p.copy(refusal = answer.refusal)), listOf(line("start-refused", "refusal" to answer.refusal, "message" to answer.message)))
        is StartAnswer.Failed -> Step(answered.withPairing(p.copy(refusal = Refusal.START_FAILED, startFailed = StartFailure.START_ERROR)))
        // Read before this `when`, whenever it lands (codeEnded).
        StartAnswer.CodeEnded -> Step(answered)
      }
    return step.copy(commands = listOf(noted) + step.commands)
  }

  /**
   * Re-review 3 I: a start answered with a sid this pairing refused (a Stop never live, its end not yet done on the
   * server: the stop beat raced, or is not yet delivered). It starts nothing, and since the hold's ask cleared the
   * last end, it says the start failed, the try-again line a 5xx gives, or the tap shows nothing. No retry of its own
   * (the amendment retries no start): the operator's next hold is the retry. The line says why, never the sid, and
   * no `startFailed` rides a beat: the server's start answered.
   */
  private fun refusedSid(answered: Phase.Paired, answer: StartAnswer): Step =
    Step(
      answered.withPairing(answered.pairing.copy(refusal = Refusal.START_FAILED)),
      listOf(line("start-answered", "answer" to answer::class.simpleName, "refusedSid" to true)),
    )

  /**
   * A 401 to `POST start` is the code's end, not this start's (amendment:41, D5), so it holds whenever it
   * lands, late or not: read as a beat's 401 is. Paired or Arming, the code is forgotten, and
   * [Pairings.unpaired] deletes a held stopped record (A17). A broadcast held from Armed on runs on, and
   * the pairing ends with it (the 401 deferral, C0b). A late answer can land there holding no record:
   * only a Paired beat's go-live arms while a start is in flight, and that 2xx delivered it.
   */
  private fun codeEnded(phase: Phase, requestId: Int, now: Now): Step {
    val pairing = phase.beating ?: return Step(phase, listOf(line("start-answered", "answer" to "CodeEnded", "late" to true)))
    val late = pairing.starts.inFlightId != requestId
    val noted = if (late) line("start-answered", "answer" to "CodeEnded", "late" to true) else line("start-answered", "answer" to "CodeEnded")
    val answered = if (late) pairing else pairing.copy(starts = pairing.starts.copy(inFlightId = null))
    val decided = beat(phase.withPairing(answered), ServerWord.CodeEnded, now)
    return decided.copy(commands = listOf(noted) + decided.commands)
  }
}

/**
 * Final review I-2b: a 2xx answer, beat or session shape, owed the waiting fields and one could not be read
 * (`Bodies`), so the pairing kept its own: its label never came, its overlay was never known, and nothing said
 * why. One `waiting-unreadable` warn a pairing names the [source] and the field, never its value.
 */
internal object WaitingUnread {
  /** The line for [field] refused on [source]'s answer, or null when none was or [pairing] has had its line. */
  fun line(pairing: PairingState, field: String?, source: String): Command? {
    if (field == null || pairing.waitingUnreadableSaid) return null
    return Command.Record(RecordEntry("waiting-unreadable", listOf("source" to source, "field" to field), level = "warn"))
  }
}
