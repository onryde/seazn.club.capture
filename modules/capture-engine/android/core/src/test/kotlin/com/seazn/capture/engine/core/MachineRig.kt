package com.seazn.capture.engine.core

/**
 * Drives [SessionMachine] the way plan C's adapters will: intents, a tick every 500 ms, encoded
 * frames while on air, permissions granted and the code answered open by default, and — when a test
 * sets them — link readings once a second and answers to playlist fetches, heartbeats and starts.
 */
class MachineRig(val request: PairRequest = Configs.pairRequest(), val descriptor: BroadcastDescriptor = Configs.descriptor()) {
  var phase: Phase = Phase.Idle()
  var mono = 0L
  var wall = 1_790_000_000_000L
  val commands = mutableListOf<Command>()

  /** Answers each playlist fetch at once; null leaves it unanswered. */
  var playlists: ((String) -> FetchResult?)? = null

  /** Answers each heartbeat at once; null leaves it unanswered. */
  var beats: ((Int) -> HeartbeatResponse?)? = null

  /** Link counters once a second while on air; null sends none. */
  var link: ((Long) -> LinkCounters)? = null

  /** Answers each permissions ask at once; null leaves it unanswered. */
  var permissions: Boolean? = true

  /**
   * Answers each code fetch at once; null leaves it unanswered. The default answers the fetch at
   * Arming open for `sess_42`, and leaves a reconnect's fetch in flight, as plan B's rig left its
   * descriptor asks: a test that wants a reconnect answered sets its own.
   */
  var codes: ((Int) -> CodeAnswer?)? = { if (phase is Phase.Arming) Configs.open(descriptor = descriptor) else null }

  /** Answers each `POST start` at once; null (the default) leaves it unanswered. */
  var starts: ((Int) -> StartAnswer?)? = null

  private var video = 0L
  private var audio = 0L
  private var feedingAttempt: Int? = null

  val now: Now
    get() = Now(mono, wall)

  val state: SnapshotState
    get() = Projection.state(phase, now)

  val snapshot: Snapshot
    get() = Projection.snapshot(phase, now)

  /** The broadcast held, from Armed on. */
  val session: Session
    get() = phase.session!!

  /** The attempt the machine is connecting or publishing, if any. */
  val attempt: Int?
    get() = (phase as? Phase.OnAir)?.attemptId ?: ((phase as? Phase.Connecting)?.step as? ConnectStep.Requested)?.attemptId

  fun send(input: Input): List<Command> {
    val step = SessionMachine.reduce(phase, input, now)
    phase = step.phase
    commands += step.commands
    for (command in step.commands) answer(command)
    return step.commands
  }

  private fun answer(command: Command) {
    when (command) {
      is Command.FetchPlaylist -> playlists?.invoke(command.url)?.let { send(Input.PlaylistFetched(command.requestId, it)) }
      is Command.PostHeartbeat -> beats?.invoke(command.beatId)?.let { send(Input.HeartbeatAnswered(command.beatId, it)) }
      Command.AskPermissions -> permissions?.let { send(Input.PermissionsAnswered(it)) }
      is Command.FetchCode -> codes?.invoke(command.requestId)?.let { send(Input.CodeAnswered(command.requestId, it)) }
      is Command.PostStart -> starts?.invoke(command.requestId)?.let { send(Input.StartAnswered(command.requestId, it)) }
      else -> Unit
    }
  }

  /** Moves time to [ms] with no input: nothing runs until the next [send]. Never backwards; [ms] may be now. */
  fun at(ms: Long) {
    require(ms >= mono) { "at($ms): time never runs backwards from $mono" }
    wall += ms - mono
    mono = ms
  }

  /** Moves time in 500 ms steps. On air and [videoPerStep] > 0 is 30 fps; [audioPerStep] 23 is ~46 a second. */
  fun advance(ms: Long, videoPerStep: Long = 15, audioPerStep: Long = 23, feeding: Boolean = true, onStep: () -> Unit = {}) {
    val end = mono + ms
    while (mono < end) {
      mono += 500
      wall += 500
      val onAir = phase as? Phase.OnAir
      if (onAir != null && feeding) feed(onAir.attemptId, videoPerStep, audioPerStep)
      if (onAir != null && mono % 1_000 == 0L) link?.let { send(Input.Link(onAir.attemptId, it(mono))) }
      send(Input.Tick)
      onStep()
    }
  }

  private fun feed(attemptId: Int, videoAdd: Long, audioAdd: Long) {
    if (feedingAttempt != attemptId) {
      feedingAttempt = attemptId
      video = 0
      audio = 0
    }
    video += videoAdd
    audio += audioAdd
    send(Input.Frames(attemptId, video, audio))
  }

  /**
   * Paired: the pair, permissions granted, the network fact, and the claim beat in flight. The claim
   * is left for [hear] even when [beats] is set, so a test's own answers start with the next beat.
   */
  fun paired(validated: Boolean = true): MachineRig {
    val answering = beats
    beats = null
    send(Input.Pair(request, Configs.PHONE, stopped = null))
    beats = answering
    send(Input.Network(validated))
    return this
  }

  /** Answers the beat in flight, ticking until one is; fails after two minutes with none. */
  fun hear(state: String?, sid: String? = null, startedBy: String? = null, endReason: String? = null, status: Int = 200, pollSeconds: Int = 10): List<Command> {
    val until = mono + 120_000
    while (phase.beating?.heartbeat?.inFlightId == null) {
      check(mono < until) { "no beat in flight in ${phase.name}" }
      advance(500)
    }
    val id = phase.beating!!.heartbeat.inFlightId!!
    val reply = BeatReply(state, sid, startedBy, endReason, Configs.waiting(pollSeconds))
    return send(Input.HeartbeatAnswered(id, HeartbeatResponse.Answered(status, reply)))
  }

  /** Armed for `sess_42`, by the organiser's Go live, and not yet ready. */
  fun armed(validated: Boolean = true): MachineRig {
    paired(validated)
    hear("go-live", sid = "sess_42", startedBy = "organiser")
    return this
  }

  fun ready(readiness: Readiness = Configs.READY): List<Command> = send(Input.ReadinessChanged(readiness))

  /** Armed, ready, connected, and a second of encoded frames: LIVE. */
  fun live(): MachineRig {
    armed()
    ready()
    send(Input.Connected(attempt!!))
    advance(1_000)
    return this
  }

  /** Every connect attempt in order, whether sent bare or inside a rebuild or a new session. */
  fun connects(): List<Command.Connect> =
    commands.mapNotNull {
      when (it) {
        is Command.Connect -> it
        is Command.Rebuild -> it.next
        is Command.StartNewSession -> it.next
        else -> null
      }
    }

  inline fun <reified T : Command> sent(): List<T> = commands.filterIsInstance<T>()

  fun records(kind: String): List<RecordEntry> = sent<Command.Record>().map { it.entry }.filter { it.kind == kind }
}

/** The value a record line carries under [key]; fails if the key is missing or written twice. */
fun RecordEntry.field(key: String): Any? = fields.single { it.first == key }.second

/** Why the session ended, or null while it has not. How long it was live is asserted where that is the point. */
val SnapshotState.endReason: EndReason?
  get() = (this as? SnapshotState.Ended)?.reason
