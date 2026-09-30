package com.seazn.capture.engine.core

/**
 * Drives [SessionMachine] the way plan C's adapters will: intents, a tick every 500 ms, encoded
 * frames while on air, and — when a test sets them — link readings once a second and answers to
 * playlist fetches and heartbeats.
 */
class MachineRig(val config: SessionConfig = Configs.valid()) {
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

  private var video = 0L
  private var audio = 0L
  private var feedingAttempt: Int? = null

  val now: Now
    get() = Now(mono, wall)

  val state: SnapshotState
    get() = Projection.state(phase, now)

  val snapshot: Snapshot
    get() = Projection.snapshot(phase, now)

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
      else -> Unit
    }
  }

  /** Moves time to [ms] with no input: nothing runs until the next [send]. */
  fun at(ms: Long) {
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

  fun armed(validated: Boolean = true): MachineRig {
    send(Input.Arm(config))
    send(Input.Network(validated))
    return this
  }

  /** Armed, started, connected, and a second of encoded frames: LIVE. */
  fun live(): MachineRig {
    armed()
    send(Input.Start)
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
