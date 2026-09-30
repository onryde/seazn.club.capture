package com.seazn.capture.engine.core

/** Plan C's adapters: carry out one command. Called on the scheduler's thread; must not block. */
fun interface CommandSink {
  fun execute(command: Command)
}

/** Plan C's bridge: hand one snapshot up to JavaScript. Called on the scheduler's thread; must not block. */
fun interface SnapshotSink {
  fun publish(snapshot: Snapshot)
}

/**
 * The driver: the only stateful object in the core. Every input — an intent from the bridge, a fact
 * from an adapter, its own tick — is posted to the injected [Scheduler] and run there one at a time,
 * so the reducer never sees two inputs at once and a command that answers synchronously is simply
 * the next input. It holds no rule: those are all in [SessionMachine].
 *
 * Threads: [send] may be called from any thread. [start] and [stop] must run on the scheduler's
 * thread (post them through the scheduler), because the tick reads what they write. The public
 * fields are written only there and are volatile, so any thread reads a current value.
 */
class Engine(
  private val clock: Clock,
  private val scheduler: Scheduler,
  private val commands: CommandSink,
  private val snapshots: SnapshotSink,
  val record: SessionRecord,
  private val reducer: (Phase, Input, Now) -> Step = SessionMachine::reduce,
  private val projection: (Phase, Now) -> Snapshot = Projection::snapshot,
) {
  @Volatile
  var phase: Phase = Phase.Idle()
    private set

  /** Commands the platform threw on. Each is also a record line. */
  @Volatile
  var commandFailures: Int = 0
    private set

  /** Snapshots that were not handed up: the projection or the bridge threw. Counted only: the next tick sends a fresh one. */
  @Volatile
  var snapshotFailures: Int = 0
    private set

  private var lastPublished: SnapshotState? = null
  private var ticking: Cancellable? = null

  /** Starts the tick. Idempotent. On the scheduler's thread only. */
  fun start() {
    if (ticking == null) scheduleTick()
  }

  /** Stops the tick. On the scheduler's thread only: a tick running elsewhere could reschedule itself. */
  fun stop() {
    ticking?.cancel()
    ticking = null
  }

  /** Thread-safe as far as the [Scheduler] is. Returns at once: intents, not RPC (AGENTS §2). */
  fun send(input: Input) {
    scheduler.schedule(0) { process(input) }
  }

  /**
   * A line for the session record from outside the machine: plan C forwards the JavaScript logger's
   * lines here (AGENTS §11). Posted like [send], so it lands in order with the engine's own lines, on
   * the scheduler's thread, and is scrubbed like every other line. Thread-safe as far as the [Scheduler] is.
   */
  fun log(entry: RecordEntry) {
    scheduler.schedule(0) { record.append(clock.now().wallMs, entry) }
  }

  /**
   * The next tick is scheduled in a `finally` (carry 15): an `Error` from a tick still reaches the
   * scheduler's thread, where plan C's adapter reports it, but it never stops the tick for good. A
   * tick reschedules only while it is still the engine's tick, so a [stop] from inside it is the last
   * one, and a [stop] then [start] from inside it leaves exactly one tick running.
   */
  private fun scheduleTick() {
    lateinit var tick: Cancellable
    tick =
      scheduler.schedule(TICK_MS) {
        try {
          process(Input.Tick)
        } finally {
          if (ticking === tick) scheduleTick()
        }
      }
    ticking = tick
  }

  /**
   * One input, contained (B6 review m7): an exception inside the machine, or while protecting the
   * secrets of an arm that would take effect, ends the session fatal-error, never armed with its
   * secrets unprotected; an exception from a command, the record's sink or the snapshot is counted.
   * No exception reaches the scheduler's thread. An arm outside idle is one the machine ignores, so its
   * config never runs: an exception while protecting it is recorded, and the session carries on (B7 E1).
   *
   * An `Error` is not the engine's to catch, and it does reach the scheduler's thread (carry 15), but
   * never halfway through a step (final review M-1). The platform's commands go first, so nothing
   * the record or the snapshot throws can hold one back, an End least of all; then every record line,
   * then the snapshot. Each runs whatever the one before it threw, and the first `Error` is rethrown
   * once all of them have. One from the machine itself is thrown before the step changes anything.
   */
  private fun process(input: Input) {
    val now = clock.now()
    val step = reduced(input, now)
    phase = step.phase
    val errors = mutableListOf<Throwable>()
    val lines = mutableListOf<RecordEntry>()
    for (command in step.commands) {
      if (command is Command.Record) lines += command.entry else contained(errors) { execute(command, lines) }
    }
    for (entry in lines) contained(errors) { record.append(now.wallMs, entry) }
    contained(errors) { publish(input, now) }
    errors.firstOrNull()?.let { throw it }
  }

  private fun reduced(input: Input, now: Now): Step =
    try {
      val unprotected = (input as? Input.Arm)?.let { protectFailure(it.config) }
      if (unprotected != null && phase is Phase.Idle) throw unprotected
      val reduced = reducer(phase, input, now)
      if (unprotected == null) reduced else reduced.copy(commands = listOf(engineError(unprotected)) + reduced.commands)
    } catch (failure: Exception) {
      Step(phase.ended(EndReason.FATAL_ERROR, now), listOf(engineError(failure), Command.End(EndReason.FATAL_ERROR)))
    }

  /** Runs [effect]; what it throws is kept in [errors], so the step's next effect still runs. */
  private inline fun contained(errors: MutableList<Throwable>, effect: () -> Unit) {
    try {
      effect()
    } catch (failure: Throwable) {
      errors += failure
    }
  }

  /** Protects an arm's secrets before any line can carry them. The exception, when protecting threw. */
  private fun protectFailure(config: SessionConfig): Exception? =
    try {
      record.protect(config)
      null
    } catch (failure: Exception) {
      failure
    }

  private fun engineError(failure: Exception): Command = Command.Record(RecordEntry("engine-error", listOf("message" to failure.toString())))

  /** On every tick, and at once when the state changes. */
  private fun publish(input: Input, now: Now) {
    try {
      val snapshot = projection(phase, now)
      if (input != Input.Tick && snapshot.state == lastPublished) return
      lastPublished = snapshot.state
      snapshots.publish(snapshot)
    } catch (_: Exception) {
      snapshotFailures += 1
    }
  }

  /** A command the platform throws on is counted and gets a line in [lines], in its place; an `Error` is rethrown too. */
  private fun execute(command: Command, lines: MutableList<RecordEntry>) {
    try {
      commands.execute(command)
    } catch (failure: Throwable) {
      commandFailures += 1
      lines += RecordEntry("command-failed", listOf("message" to "${command::class.simpleName}: $failure"))
      if (failure !is Exception) throw failure
    }
  }

  companion object {
    /** Twice a second: the watchdog's cadence in P5, and a snapshot at least once a second (AGENTS §2). */
    const val TICK_MS = 500L
  }
}
