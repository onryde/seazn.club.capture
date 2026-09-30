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

  private fun engine(reducer: (Phase, Input, Now) -> Step = SessionMachine::reduce): Engine {
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
    assertEquals(Phase.Idle, engine.phase, "nothing runs until the scheduler does")
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
    assertEquals(Phase.Ended(EndReason.OPERATOR_STOPPED), engine.phase)
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
    assertEquals(Phase.Ended(EndReason.FATAL_ERROR), engine.phase)
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
}
