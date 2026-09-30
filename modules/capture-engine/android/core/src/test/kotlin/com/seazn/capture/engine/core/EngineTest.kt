package com.seazn.capture.engine.core

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertFalse
import kotlin.test.assertIs
import kotlin.test.assertTrue

class EngineTest {
  private val clock = FakeClock()
  private val scheduler = FakeScheduler(clock)
  private val executed = mutableListOf<Command>()
  private val published = mutableListOf<Pair<Long, Snapshot>>()
  private val lines = mutableListOf<String>()
  private var onCommand: (Engine, Command) -> Unit = { _, _ -> }

  private fun engine(
    projection: (Phase, Now) -> Snapshot = Projection::snapshot,
    reducer: (Phase, Input, Now) -> Step = SessionMachine::reduce,
  ): Engine {
    lateinit var engine: Engine
    engine =
      Engine(
        clock,
        scheduler,
        commands = { command ->
          executed += command
          onCommand(engine, command)
        },
        snapshots = { published += clock.mono to it },
        record = SessionRecord { lines += it },
        reducer = reducer,
        projection = projection,
      )
    return engine
  }

  @Test
  fun `the tick drives time-based rules with no platform answer - a connect times out`() {
    val engine = engine().apply { start() }
    engine.send(Input.Arm(Configs.valid()))
    engine.send(Input.Network(true))
    engine.send(Input.Start)
    scheduler.advanceBy(15_000)
    assertTrue(Command.Disconnect(1) in executed)
  }

  @Test
  fun `send returns before the input runs, and inputs run one at a time in order`() {
    val engine = engine()
    engine.send(Input.Arm(Configs.valid()))
    assertEquals(Phase.Idle(), engine.phase, "nothing runs until the scheduler does")
    // An adapter that answers synchronously: its answer is simply the next input.
    onCommand = { e, command -> if (command is Command.Connect) e.send(Input.Connected(command.attemptId)) }
    engine.send(Input.Start)
    scheduler.advanceBy(0)
    assertIs<Phase.OnAir>(engine.phase)
  }

  @Test
  fun `a snapshot goes up on every tick, and at once when the state changes`() {
    val engine = engine().apply { start() }
    scheduler.advanceBy(2_000)
    assertEquals(listOf(500L, 1_000L, 1_500L, 2_000L), published.map { it.first })
    engine.send(Input.Arm(Configs.valid()))
    scheduler.advanceBy(0)
    assertEquals(SnapshotState.Armed, published.last().second.state)
    assertEquals(2_000L, published.last().first)
  }

  @Test
  fun `records go to the session record and never to the platform`() {
    val engine = engine()
    engine.send(Input.Arm(Configs.valid()))
    scheduler.advanceBy(0)
    assertFalse(executed.any { it is Command.Record })
    assertTrue(lines.single().contains(""""kind":"armed""""))
  }

  @Test
  fun `a secret quoted by the platform never reaches the record`() {
    val engine = engine()
    engine.send(Input.Arm(Configs.valid()))
    engine.send(Input.Start)
    engine.send(Input.ConnectFailed(1, ConnectFailure.OTHER, "srt://h?passphrase=${Configs.PASSPHRASE}&streamid=${Configs.STREAM_ID}"))
    scheduler.advanceBy(0)
    for (secret in listOf(Configs.TOKEN, Configs.PASSPHRASE, Configs.STREAM_KEY)) {
      assertFalse(lines.any { secret in it }, "leaked $secret")
    }
    // The stream id is public inside the playback URL (the armed line) and a secret everywhere else.
    val failure = lines.single { "connect-failed" in it }
    assertFalse(Configs.STREAM_ID in failure, failure)
  }

  @Test
  fun `a command the platform throws on is recorded, and the engine carries on`() {
    onCommand = { _, command -> if (command is Command.Connect) throw IllegalStateException("camera busy") }
    val engine = engine()
    engine.send(Input.Arm(Configs.valid()))
    engine.send(Input.Start)
    engine.send(Input.Stop)
    scheduler.advanceBy(0)
    assertEquals(1, engine.commandFailures)
    assertTrue(lines.any { "command-failed" in it && "camera busy" in it })
    assertEquals(EndReason.OPERATOR_STOPPED, assertIs<Phase.Ended>(engine.phase).reason)
  }

  @Test
  fun `a snapshot the bridge throws on is counted, and the next tick still goes up`() {
    var throwing = true
    val engine =
      Engine(
        clock,
        scheduler,
        commands = { executed += it },
        snapshots = {
          if (throwing) throw IllegalStateException("bridge gone")
          published += clock.mono to it
        },
        record = SessionRecord { lines += it },
      )
    engine.start()
    scheduler.advanceBy(500)
    assertEquals(1, engine.snapshotFailures)
    throwing = false
    scheduler.advanceBy(500)
    assertEquals(listOf(1_000L), published.map { it.first })
  }

  @Test
  fun `a failure inside the machine ends fatal-error instead of escaping`() {
    val engine = engine { _, _, _ -> throw IllegalStateException("bug") }
    engine.send(Input.Start)
    scheduler.advanceBy(0)
    assertEquals(Phase.Ended(EndReason.FATAL_ERROR, Ids()), engine.phase)
    assertTrue(Command.End(EndReason.FATAL_ERROR) in executed)
    assertTrue(lines.any { "engine-error" in it })
  }

  @Test
  fun `stop cancels the tick, and start twice ticks once`() {
    val engine = engine()
    engine.start()
    engine.start()
    scheduler.advanceBy(1_000)
    assertEquals(2, published.size)
    engine.stop()
    scheduler.advanceBy(5_000)
    assertEquals(2, published.size)
  }

  private class Crash : Error("crash")

  @Test
  fun `carry 15 an Error that escapes a tick does not stop the tick`() {
    var crashed = false
    val engine = engine { phase, input, now ->
      if (input == Input.Tick && !crashed) {
        crashed = true
        throw Crash()
      }
      SessionMachine.reduce(phase, input, now)
    }
    engine.start()
    // An Error is not the machine's to catch: it reaches the scheduler's thread, as the platform's own would.
    assertFailsWith<Crash> { scheduler.advanceBy(500) }
    scheduler.advanceBy(500)
    assertEquals(listOf(1_000L), published.map { it.first }, "the tick after the crash went up")
  }

  @Test
  fun `a stop and a start from inside a tick leave one tick running`() {
    var restarted = false
    lateinit var engine: Engine
    engine =
      Engine(
        clock,
        scheduler,
        commands = { executed += it },
        snapshots = {
          published += clock.mono to it
          if (!restarted) {
            restarted = true
            engine.stop()
            engine.start()
          }
        },
        record = SessionRecord { lines += it },
      )
    engine.start()
    scheduler.advanceBy(2_000)
    assertEquals(listOf(500L, 1_000L, 1_500L, 2_000L), published.map { it.first })
  }

  @Test
  fun `a stop from inside a tick is the last tick`() {
    lateinit var engine: Engine
    engine =
      Engine(
        clock,
        scheduler,
        commands = { executed += it },
        snapshots = {
          published += clock.mono to it
          if (clock.mono == 1_000L) engine.stop()
        },
        record = SessionRecord { lines += it },
      )
    engine.start()
    scheduler.advanceBy(5_000)
    assertEquals(listOf(500L, 1_000L), published.map { it.first })
    assertEquals(0, scheduler.pending)
  }

  @Test
  fun `an intent with no session is recorded as ignored, and nothing is asked of the platform`() {
    val engine = engine()
    engine.send(Input.Start)
    engine.send(Input.Stop)
    scheduler.advanceBy(0)
    assertEquals(Phase.Idle(), engine.phase)
    assertTrue(executed.isEmpty())
    assertEquals(2, lines.count { """"kind":"intent-ignored"""" in it })
  }

  @Test
  fun `carry 12 a machine failure on the arm itself is masked - the config is protected before the machine runs`() {
    val engine = engine { phase, input, now ->
      if (input is Input.Arm) throw IllegalStateException("cannot parse srt://h?passphrase=${Configs.PASSPHRASE}")
      SessionMachine.reduce(phase, input, now)
    }
    engine.send(Input.Arm(Configs.valid()))
    scheduler.advanceBy(0)
    val error = lines.single { "engine-error" in it }
    assertFalse(Configs.PASSPHRASE in error, error)
    assertTrue(SessionRecord.MASK in error, error)
  }

  @Test
  fun `carry 12 a machine failure that quotes a secret is masked in the record`() {
    val engine = engine { phase, input, now ->
      if (input == Input.Start) throw IllegalStateException("srt://h?passphrase=${Configs.PASSPHRASE}&streamid=${Configs.STREAM_ID}")
      SessionMachine.reduce(phase, input, now)
    }
    engine.send(Input.Arm(Configs.valid()))
    engine.send(Input.Start)
    scheduler.advanceBy(0)
    val error = lines.single { "engine-error" in it }
    assertFalse(Configs.PASSPHRASE in error, error)
    assertFalse(Configs.STREAM_ID in error, error)
    assertTrue(SessionRecord.MASK in error, error)
  }

  @Test
  fun `carry 12 a platform exception that quotes a secret is masked in the record`() {
    onCommand = { _, command -> if (command is Command.Connect) throw IllegalStateException("rtmps://h/live/${Configs.STREAM_KEY} refused") }
    val engine = engine()
    engine.send(Input.Arm(Configs.valid(primary = Configs.rtmps, fallback = Configs.srt)))
    engine.send(Input.Start)
    scheduler.advanceBy(0)
    val failure = lines.single { "command-failed" in it }
    assertFalse(Configs.STREAM_KEY in failure, failure)
    assertTrue("Connect: " in failure && SessionRecord.MASK in failure, failure)
  }

  @Test
  fun `carry 12 a heartbeat failure that quotes the token is masked in the record`() {
    onCommand = { e, command ->
      if (command is Command.PostHeartbeat) e.send(Input.HeartbeatAnswered(command.beatId, HeartbeatResponse.Failed("401 for Bearer ${Configs.TOKEN}")))
    }
    val engine = engine().apply { start() }
    engine.send(Input.Arm(Configs.valid()))
    scheduler.advanceBy(500)
    val heartbeat = lines.single { """"kind":"heartbeat"""" in it }
    assertFalse(Configs.TOKEN in heartbeat, heartbeat)
    assertTrue("401 for Bearer ${SessionRecord.MASK}" in heartbeat, heartbeat)
  }

  /** An adapter whose ingest refuses every connect, and whose descriptor fetch answers [result]. */
  private fun refusedIngest(result: DescriptorCheck) {
    onCommand = { e, command ->
      when (command) {
        is Command.Connect -> e.send(Input.ConnectFailed(command.attemptId, ConnectFailure.REFUSED, "publish rejected"))
        is Command.FetchDescriptor -> e.send(Input.DescriptorChecked(command.requestId, result))
        else -> Unit
      }
    }
  }

  @Test
  fun `carry 12 an unreachable descriptor that quotes a secret is masked in the record`() {
    val engine = engine()
    refusedIngest(DescriptorCheck.Unreachable("GET https://stg.seazn.club/c?tok=${Configs.TOKEN} timed out"))
    engine.send(Input.Arm(Configs.valid()))
    engine.send(Input.Start)
    scheduler.advanceBy(0)
    val descriptor = lines.single { """"kind":"descriptor"""" in it }
    assertFalse(Configs.TOKEN in descriptor, descriptor)
    assertTrue("tok=${SessionRecord.MASK} timed out" in descriptor, descriptor)
  }

  @Test
  fun `carry 12 an arm the machine ignores still protects its secrets`() {
    val other = SrtTarget("srt://live.cloudflare.com:778", "f0e1d2c3b4a5968778695a4b3c2d1e0f", "other+secret/9a8b7c", latencyMs = 2_000)
    val engine = engine()
    refusedIngest(DescriptorCheck.Unreachable("srt://h?passphrase=other+secret/9a8b7c"))
    engine.send(Input.Arm(Configs.valid()))
    engine.send(Input.Arm(Configs.valid(primary = other)))
    engine.send(Input.Start)
    scheduler.advanceBy(0)
    assertEquals(1, lines.count { """"kind":"intent-ignored"""" in it }, "the second arm was ignored")
    val descriptor = lines.single { """"kind":"descriptor"""" in it }
    assertFalse("other+secret/9a8b7c" in descriptor, descriptor)
  }

  @Test
  fun `an input that leaves the state as it was waits for the tick`() {
    val engine = engine()
    engine.send(Input.Arm(Configs.valid()))
    scheduler.advanceBy(0)
    assertEquals(listOf(SnapshotState.Armed), published.map { it.second.state })
    engine.send(Input.Network(true))
    engine.send(Input.Device(DeviceSample(null, null, 70, true, null, null)))
    scheduler.advanceBy(0)
    assertEquals(1, published.size, "still armed: the next tick carries the rest")
  }

  @Test
  fun `B6 review m3 ids outlive a fatal error, so the next session's attempts are new`() {
    val engine = engine { phase, input, now -> if (input == Input.SwitchCamera) error("bug") else SessionMachine.reduce(phase, input, now) }
    engine.send(Input.Arm(Configs.valid()))
    engine.send(Input.Start)
    // A failure while connecting, again once ended, and again once idle: each keeps the ids.
    engine.send(Input.SwitchCamera)
    engine.send(Input.SwitchCamera)
    engine.send(Input.Reset)
    engine.send(Input.SwitchCamera)
    engine.send(Input.Reset)
    engine.send(Input.Arm(Configs.valid()))
    engine.send(Input.Start)
    scheduler.advanceBy(0)
    assertEquals(3, lines.count { """"kind":"engine-error"""" in it })
    assertEquals(listOf(1, 2), executed.filterIsInstance<Command.Connect>().map { it.attemptId })
  }

  /** A config no Kotlin caller can build: every field null. Only a bug on the platform's side makes one. */
  private fun nullConfig(): SessionConfig {
    val field = Class.forName("sun.misc.Unsafe").getDeclaredField("theUnsafe").apply { isAccessible = true }
    val unsafe = field.get(null)
    return unsafe.javaClass.getMethod("allocateInstance", Class::class.java).invoke(unsafe, SessionConfig::class.java) as SessionConfig
  }

  @Test
  fun `B6 review m7 a throw from protecting an arm's secrets ends fatal-error, is recorded, and the tick carries on`() {
    val engine = engine().apply { start() }
    engine.send(Input.Arm(nullConfig()))
    scheduler.advanceBy(0)
    assertEquals(EndReason.FATAL_ERROR, assertIs<Phase.Ended>(engine.phase).reason, "never armed with its secrets unprotected")
    assertEquals(1, lines.count { """"kind":"engine-error"""" in it })
    scheduler.advanceBy(1_000)
    assertEquals(listOf(0L, 500L, 1_000L), published.map { it.first })
  }

  @Test
  fun `B7 E1 an idle arm whose secrets cannot be protected ends fatal-error, even when the machine would take it`() {
    // The real machine throws on this config too. A stand-in that arms on any config leaves the
    // protect failure as the only thing between the session and an arm with its secrets unprotected.
    val arming: (Phase, Input, Now) -> Step = { phase, input, now ->
      SessionMachine.reduce(phase, if (input is Input.Arm) Input.Arm(Configs.valid()) else input, now)
    }
    val engine = engine(reducer = arming)
    engine.send(Input.Arm(nullConfig()))
    scheduler.advanceBy(0)
    assertEquals(EndReason.FATAL_ERROR, assertIs<Phase.Ended>(engine.phase).reason)
    assertEquals(1, lines.count { """"kind":"engine-error"""" in it })
  }

  /**
   * A fresh engine armed on a validated network, then [setup], then a second arm whose config no Kotlin
   * caller can build. Returns the phase before and after that arm; [executed] and [lines] hold only its effects.
   */
  private fun malformedArmAfter(setup: List<Input>): Pair<Phase, Phase> {
    onCommand = { e, command -> if (command is Command.Connect) e.send(Input.Connected(command.attemptId)) }
    val engine = engine()
    engine.send(Input.Arm(Configs.valid()))
    engine.send(Input.Network(true))
    for (input in setup) engine.send(input)
    scheduler.advanceBy(0)
    val before = engine.phase
    executed.clear()
    lines.clear()
    engine.send(Input.Arm(nullConfig()))
    scheduler.advanceBy(0)
    return before to engine.phase
  }

  @Test
  fun `B7 E1 a malformed arm while a session runs is ignored and recorded, as the machine does - never fatal-error`() {
    // Armed, on air, and ended by the operator: the machine ignores an arm in each, so its config never runs.
    for (setup in listOf(emptyList(), listOf(Input.Start), listOf(Input.Start, Input.Stop))) {
      val (before, after) = malformedArmAfter(setup)
      assertEquals(before, after, "after $setup")
      assertTrue(executed.isEmpty(), "after $setup, asked of the platform: $executed")
      assertEquals(1, lines.count { """"kind":"engine-error"""" in it }, "after $setup")
      assertEquals(1, lines.count { """"kind":"intent-ignored"""" in it }, "after $setup")
    }
  }

  @Test
  fun `B6 review m7 a throw from the projection is counted, and the tick carries on`() {
    var failing = true
    val engine = engine(projection = { phase, now -> if (failing) error("projection") else Projection.snapshot(phase, now) }).apply { start() }
    engine.send(Input.Arm(Configs.valid()))
    scheduler.advanceBy(1_000)
    assertIs<Phase.Armed>(engine.phase, "the input still ran")
    assertEquals(3, engine.snapshotFailures, "the arm and two ticks")
    assertTrue(published.isEmpty())
    failing = false
    scheduler.advanceBy(500)
    assertEquals(listOf(1_500L), published.map { it.first })
  }
}
