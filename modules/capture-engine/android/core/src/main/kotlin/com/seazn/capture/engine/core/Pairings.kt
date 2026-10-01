package com.seazn.capture.engine.core

private fun line(kind: String, vararg fields: Pair<String, Any?>): Command = Command.Record(RecordEntry(kind, fields.toList()))

/** Pairing, the settings, readiness and the start gate (amendment, _The engine port_ and A11). */
internal object Pairings {
  fun pair(phase: Phase, input: Input.Pair, now: Now): Step {
    // The request is read only once the pair can act: one the machine ignores never runs (B7 E1).
    if (phase.holdsBroadcast || phase is Phase.Ended) return SessionMachine.ignored(phase, "pair")
    val name = input.request.name
    if ((phase is Phase.Pairing || phase is Phase.Paired) && phase.pairing?.name == name) return SessionMachine.ignored(phase, "pair")
    val problems = input.request.problems()
    if (problems.isNotEmpty()) {
      val refused = line("pair-refused", "problems" to problems.joinToString("; "))
      return Step(phase.ended(EndReason.FATAL_ERROR, now), listOf(refused, Command.End(EndReason.FATAL_ERROR), Command.Release))
    }
    val left = if (phase is Phase.Paired || phase is Phase.Pairing) listOf(Command.Release, line("unpaired", "reason" to "re-pair")) else emptyList()
    val ids = phase.ids
    val stopped = input.stopped?.takeIf { it.isFor(name) && it.current(now.wallMs) }
    val pairing =
      PairingState(
        request = input.request,
        phone = input.phone,
        claim = input.request.claim,
        automatic = input.request.automatic,
        language = input.request.language,
        heartbeat = HeartbeatState(nextId = ids.beat),
        stopped = stopped,
        refused = setOfNotNull(stopped?.sid),
        starts = StartAsks(nextId = ids.start),
      )
    val asked = line("pair", "claim" to input.request.claim, "slot" to name.slot, "tokenTag" to name.tokenTag, "stopped" to (stopped != null))
    return Step(Phase.Pairing(pairing, ids, phase.networkValidated), left + asked + Command.AskPermissions)
  }

  fun permissions(phase: Phase, granted: Boolean, now: Now): Step {
    if (phase !is Phase.Pairing) return Step(phase, listOf(line("permissions-late", "granted" to granted)))
    if (!granted) {
      val idle = Phase.Idle(phase.ids, phase.networkValidated, Unpaired(UnpairReason.PERMISSIONS, phase.pairing.name))
      return Step(idle, listOf(line("unpaired", "reason" to UnpairReason.PERMISSIONS)))
    }
    val paired = Phase.Paired(phase.pairing.copy(heartbeat = phase.pairing.heartbeat.soon(now.monoMs)), phase.ids, phase.networkValidated)
    // The claim goes at once (A9): the first beat is due now.
    return Heartbeats.tick(Step(paired, listOf(Command.Hold, line("paired"))), now)
  }

  fun unpair(phase: Phase): Step =
    when (phase) {
      is Phase.Paired -> Step(Phase.Idle(phase.ids, phase.networkValidated), listOf(Command.Release, line("unpaired", "reason" to "operator")))
      is Phase.Pairing -> Step(Phase.Idle(phase.ids, phase.networkValidated), listOf(line("unpaired", "reason" to "operator")))
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
    return Step(Phase.Idle(phase.ids, phase.networkValidated, Unpaired(reason, pairing.name)), commands)
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
    val cleared = pairing.copy(refusal = null, startFailed = null, lastEnd = null)
    val (asks, id) = DescriptorAsks(nextId = ids.descriptor).asked(now.monoMs)
    val arming = Phase.Arming(cleared, sid, cause, ids, phase.networkValidated, asks)
    return Step(arming, listOf(line("broadcast-start", "sid" to sid, "cause" to cause), fetchCode(pairing, id)))
  }

  /** An open session shape for the sid in hand: the broadcast's plan, then Armed. */
  fun opened(arming: Phase.Arming, answer: CodeAnswer.Open): Step {
    val pairing = answer.waiting?.let { arming.pairing.copy(waiting = it) } ?: arming.pairing
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
        nextAttemptId = ids.attempt,
        descriptor = arming.asks,
        networkValidated = arming.networkValidated,
      )
    val armed = line("armed", "sid" to arming.sid, "transport" to config.primary.transport, "srtOffered" to descriptor.srtOffered, "playbackUrl" to config.playbackUrl)
    return Step(Phase.Armed(session), listOf(armed))
  }

  /** The tick in Arming: fetch again once the asks' spacing and any Retry-After allow, unless a claim is awaited. */
  fun tick(arming: Phase.Arming, now: Now): Step {
    if (arming.notCurrent || now.monoMs < arming.notBeforeMs || !arming.asks.mayAsk(now.monoMs)) return Step(arming)
    val (asks, id) = arming.asks.asked(now.monoMs)
    return Step(arming.copy(asks = asks), listOf(fetchCode(arming.pairing, id)))
  }

  /**
   * The code's answer at Arming: the open shape for the sid arms it; the over verdicts return to
   * Paired; a 404 refuses the sid (PV8: Task 7's row, here for the refused-sid row). Task 7 completes it.
   */
  fun answered(arming: Phase.Arming, input: Input.CodeAnswered, now: Now): Step {
    val asks = arming.asks.answered(input.requestId) ?: return Step(arming)
    val answered = arming.copy(asks = asks, retrying = false)
    val answer = input.answer
    if (answer is CodeAnswer.Open && answer.sid == arming.sid) return opened(answered, answer)
    val word = ServerWord.ofCode(answer, arming.sid)
    if (word is ServerWord.Over && word.ends(arming.sid)) return Verdicts.over(answered, LastEnd.of(word.endReason), now)
    if (word == ServerWord.NoBroadcast) return Verdicts.over(answered, LastEnd.STOPPED, now)
    if (word == ServerWord.NotFound) return failed(answered, StartFailure.NOT_FOUND)
    return Step(answered, listOf(line("code", "answer" to answer::class.simpleName)))
  }

  /** A start that failed for S: back to Paired, S refused for this pairing, the line until the next start. */
  fun failed(arming: Phase.Arming, failure: StartFailure, vararg extra: Command): Step {
    val pairing = arming.pairing.copy(refused = arming.pairing.refused + arming.sid, startFailed = failure, refusal = Refusal.START_FAILED)
    val noted = line("start-failed", "sid" to arming.sid, "failure" to failure)
    return Step(Phase.Paired(pairing, arming.ids, arming.networkValidated), extra.toList() + noted)
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

/** The answer table (amendment, _The answer table_), by phase. Task 7 completes the start rows. */
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
      word == ServerWord.CodeEnded -> Step(phase.withPairing(pairing.copy(codeEndedPending = true)), listOf(line("code-ended-pending")))
      word == ServerWord.NotFound && phase is Phase.Arming -> Starts.failed(phase, StartFailure.NOT_FOUND)
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

  /**
   * The held broadcast is over without the operator: back to Paired with [lastEnd], or, after a 401
   * heard while it was held, to Idle with code-ended (the 401 deferral).
   */
  fun over(phase: Phase, lastEnd: LastEnd, now: Now): Step {
    val pairing = phase.pairing ?: return Step(phase)
    if (pairing.codeEndedPending) return Pairings.unpaired(phase, UnpairReason.CODE_ENDED, now)
    val publishing = phase is Phase.Connecting || phase is Phase.OnAir
    val ended = line("broadcast-ended", "sid" to phase.heldSid, "lastEnd" to lastEnd, "wasLive" to (phase.session?.liveSinceEpochMs != null))
    val paired = Phase.Paired(pairing.copy(lastEnd = lastEnd), phase.ids, phase.networkValidated)
    return Step(paired, listOfNotNull(if (publishing) Command.StopBroadcast else null, ended))
  }

  /** The code's answer: at Arming it decides the start; on a reconnect only the over verdicts act. */
  fun code(phase: Phase, input: Input.CodeAnswered, now: Now): Step {
    val held = phase.heldSid ?: return Step(phase)
    return if (phase is Phase.Arming) Starts.answered(phase, input, now) else reconnectAnswer(phase, held, input, now)
  }

  /** A reconnect's fetch (plan B: on every reconnect): only the over verdicts act; anything else is recorded. */
  private fun reconnectAnswer(phase: Phase, held: String, input: Input.CodeAnswered, now: Now): Step {
    val session = phase.session ?: return Step(phase)
    val asks = session.descriptor.answered(input.requestId) ?: return Step(phase)
    val answered = phase.withSession(session.copy(descriptor = asks))
    val word = ServerWord.ofCode(input.answer, held)
    // One rule for the server's word: Over(S), NoBroadcast and another sid (with or without cred, M8) end S.
    if (word.ends(held)) return over(answered, LastEnd.of((word as? ServerWord.Over)?.endReason), now)
    // Plan B's descriptor line kept why the server could not be reached; so does this one (carry 12 masks it).
    val message = (input.answer as? CodeAnswer.Unreachable)?.message
    return Step(answered, listOf(line("code", "answer" to input.answer::class.simpleName, "message" to message)))
  }

  fun started(phase: Phase, input: Input.StartAnswered, now: Now): Step = Step(phase)

  fun postStart(phase: Phase, now: Now): Step = SessionMachine.ignored(phase, "start")
}
