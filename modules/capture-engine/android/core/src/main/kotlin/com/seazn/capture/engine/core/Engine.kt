package com.seazn.capture.engine.core

/** Plan C's adapters: carry out one command. Called on the scheduler's thread; must not block. */
fun interface CommandSink {
  fun execute(command: Command)
}

/** Plan C's bridge: hand one snapshot up to JavaScript. */
fun interface SnapshotSink {
  fun publish(snapshot: Snapshot)
}

/**
 * The driver: the only stateful object in the core. Every input — an intent from the bridge, a fact
 * from an adapter, its own tick — is posted to the injected [Scheduler] and run there one at a time,
 * so the reducer never sees two inputs at once and a command that answers synchronously is simply
 * the next input. It holds no rule: those are all in [SessionMachine].
 */
class Engine(
  private val clock: Clock,
  private val scheduler: Scheduler,
  private val commands: CommandSink,
  private val snapshots: SnapshotSink,
  val record: SessionRecord,
  private val reducer: (Phase, Input, Now) -> Step = SessionMachine::reduce,
) {
  var phase: Phase = Phase.Idle
    private set

  /** Commands the platform threw on. Each is also a record line. */
  var commandFailures: Int = 0
    private set

  /** Snapshots the bridge threw on. Counted only: the next tick sends a fresh one. */
  var snapshotFailures: Int = 0
    private set

  private var lastPublished: SnapshotState? = null
  private var ticking: Cancellable? = null

  /** Starts the tick. Idempotent. */
  fun start() {
    if (ticking == null) scheduleTick()
  }

  fun stop() {
    ticking?.cancel()
    ticking = null
  }

  /** Thread-safe as far as the [Scheduler] is. Returns at once: intents, not RPC (AGENTS §2). */
  fun send(input: Input) {
    scheduler.schedule(0) { process(input) }
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

  private fun process(input: Input) {
    val now = clock.now()
    if (input is Input.Arm) record.protect(input.config)
    val step =
      try {
        reducer(phase, input, now)
      } catch (failure: Exception) {
        val noted = Command.Record(RecordEntry("engine-error", listOf("message" to failure.toString())))
        Step(Phase.Ended(EndReason.FATAL_ERROR), listOf(noted, Command.End(EndReason.FATAL_ERROR)))
      }
    phase = step.phase
    for (command in step.commands) dispatch(command, now)
    val snapshot = Projection.snapshot(phase, now)
    if (input == Input.Tick || snapshot.state != lastPublished) {
      lastPublished = snapshot.state
      try {
        snapshots.publish(snapshot)
      } catch (_: Exception) {
        snapshotFailures += 1
      }
    }
  }

  private fun dispatch(command: Command, now: Now) {
    if (command is Command.Record) return record.append(now.wallMs, command.entry)
    try {
      commands.execute(command)
    } catch (failure: Exception) {
      commandFailures += 1
      record.append(now.wallMs, RecordEntry("command-failed", listOf("message" to "${command::class.simpleName}: $failure")))
    }
  }

  companion object {
    /** Twice a second: the watchdog's cadence in P5, and a snapshot at least once a second (AGENTS §2). */
    const val TICK_MS = 500L
  }
}
