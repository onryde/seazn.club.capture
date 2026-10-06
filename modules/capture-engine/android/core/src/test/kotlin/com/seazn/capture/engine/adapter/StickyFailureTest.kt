package com.seazn.capture.engine.adapter

import com.seazn.capture.engine.core.Command
import com.seazn.capture.engine.core.Configs
import com.seazn.capture.engine.core.Engine
import com.seazn.capture.engine.core.EndReason
import com.seazn.capture.engine.core.FakeClock
import com.seazn.capture.engine.core.FakeScheduler
import com.seazn.capture.engine.core.Input
import com.seazn.capture.engine.core.Phase
import com.seazn.capture.engine.core.SessionRecord
import com.seazn.capture.engine.core.SnapshotState
import com.seazn.capture.engine.core.attemptInHand
import kotlin.concurrent.thread
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertIs
import kotlin.test.assertTrue

class StickyFailureTest {
  private val executed = mutableListOf<Command>()
  private val reported = mutableListOf<Input>()
  private var attempt = 1
  private val sticky = StickyFailure({ executed += it }, { attempt }) { reported += it }
  private val connect = Command.Connect(4, Configs.srt, 1_500_000, null)

  @Test
  fun `carry 18 after a permanent failure every later connect is answered PlatformFailed for its own attempt`() {
    sticky.fail("UnsatisfiedLinkError: libsrt", attemptInHand = 3, scope = Scope.PROCESS)
    sticky.execute(connect)
    sticky.execute(Command.Rebuild(4, connect.copy(attemptId = 5)))
    sticky.execute(Command.StartNewSession(5, connect.copy(attemptId = 6)))
    assertEquals<List<Input>>(
      listOf(3, 4, 5, 6).map { Input.PlatformFailed(it, "UnsatisfiedLinkError: libsrt") },
      reported,
    )
    assertTrue(executed.none { it is Command.Connect || it is Command.Rebuild || it is Command.StartNewSession })
  }

  @Test
  fun `carry 18 a failure before the first connect is reported at once with the attempt in hand`() {
    sticky.fail("MediaCodec.configure: unsupported", attemptInHand = 1, scope = Scope.PAIRING)
    assertEquals(listOf<Input>(Input.PlatformFailed(1, "MediaCodec.configure: unsupported")), reported)
  }

  @Test
  fun `the second failure is not reported again, and End still reaches the platform`() {
    sticky.fail("a", 1, Scope.PROCESS)
    sticky.fail("b", 1, Scope.PROCESS)
    sticky.execute(Command.End(EndReason.FATAL_ERROR))
    assertEquals(1, reported.size)
    assertTrue(executed.single() is Command.End)
  }

  @Test
  fun `a pairing failure clears at the next accepted pair, a process failure never does`() {
    sticky.fail("codec", 1, Scope.PAIRING)
    sticky.pairAccepted()
    sticky.execute(connect)
    assertEquals(connect, executed.single())
    sticky.fail("libsrt", 4, Scope.PROCESS)
    sticky.pairAccepted()
    sticky.execute(connect.copy(attemptId = 9))
    assertEquals(Input.PlatformFailed(9, "libsrt"), reported.last())
  }

  @Test
  fun `linkage errors and wrapped permanent failures are permanent, a timeout is not`() {
    assertTrue(Failures.permanent(UnsatisfiedLinkError("x")))
    assertTrue(Failures.permanent(NoClassDefFoundError("x")))
    assertTrue(Failures.permanent(RuntimeException(PermanentPlatformFailure("codec"))))
    assertTrue(!Failures.permanent(java.net.SocketTimeoutException("t")))
  }

  @Test
  fun `a process failure after a pairing one in the same pairing is not reported again, and outlasts the pairing`() {
    sticky.fail("MediaCodec.configure: unsupported", 1, Scope.PAIRING)
    sticky.fail("UnsatisfiedLinkError: libsrt", 1, Scope.PROCESS)
    assertEquals(listOf<Input>(Input.PlatformFailed(1, "MediaCodec.configure: unsupported")), reported)
    sticky.pairAccepted()
    sticky.execute(connect)
    assertTrue(executed.isEmpty(), "no connect reaches the platform")
    assertEquals(Input.PlatformFailed(4, "UnsatisfiedLinkError: libsrt"), reported.last())
  }

  @Test
  fun `after a re-pair a pairing failure is new, and is reported for the new pairing's attempt`() {
    sticky.fail("MediaCodec.configure: unsupported", 1, Scope.PAIRING)
    sticky.pairAccepted()
    sticky.fail("MediaCodec.configure: unsupported", 2, Scope.PAIRING)
    assertEquals<List<Input>>(listOf(1, 2).map { Input.PlatformFailed(it, "MediaCodec.configure: unsupported") }, reported)
  }

  @Test
  fun `after a re-pair over a process failure a new failure still ends the new pairing, once`() {
    sticky.fail("UnsatisfiedLinkError: libsrt", 1, Scope.PROCESS)
    sticky.pairAccepted()
    sticky.fail("MediaCodec.configure: unsupported", 2, Scope.PAIRING)
    sticky.fail("MediaCodec.configure: unsupported", 2, Scope.PAIRING)
    assertEquals<List<Input>>(
      listOf(Input.PlatformFailed(1, "UnsatisfiedLinkError: libsrt"), Input.PlatformFailed(2, "MediaCodec.configure: unsupported")),
      reported,
    )
    // The process failure still answers the next connect, with its own message.
    sticky.execute(connect)
    assertEquals(Input.PlatformFailed(4, "UnsatisfiedLinkError: libsrt"), reported.last())
  }

  @Test
  fun `review 13 m1 a second process failure never replaces the first one's message`() {
    sticky.fail("UnsatisfiedLinkError: libsrt", 1, Scope.PROCESS)
    sticky.fail("NoClassDefFoundError: SrtSocket", 1, Scope.PROCESS)
    sticky.pairAccepted()
    sticky.execute(connect)
    assertEquals(Input.PlatformFailed(4, "UnsatisfiedLinkError: libsrt"), reported.last())
  }

  @Test
  fun `review 13 I4 failed says whether a failure is held - a pairing one until the next pair, a process one for good`() {
    assertFalse(sticky.failed)
    sticky.fail("MediaCodec.configure: unsupported", 1, Scope.PAIRING)
    assertTrue(sticky.failed)
    sticky.pairAccepted()
    assertFalse(sticky.failed)
    sticky.fail("UnsatisfiedLinkError: libsrt", 2, Scope.PROCESS)
    sticky.pairAccepted()
    assertTrue(sticky.failed)
  }

  @Test
  fun `review 13 I1 a held process failure refuses the next pairing's permission ask, for the attempt in hand`() {
    sticky.fail("UnsatisfiedLinkError: libsrt", 1, Scope.PROCESS)
    sticky.pairAccepted()
    attempt = 2
    sticky.execute(Command.AskPermissions)
    assertTrue(executed.isEmpty(), "no permission dialog, so no Hold and no claim beat can follow")
    assertEquals(Input.PlatformFailed(2, "UnsatisfiedLinkError: libsrt"), reported.last())
  }

  @Test
  fun `review 13 I1 a held pairing failure still lets the next pairing ask for permissions`() {
    sticky.fail("MediaCodec.configure: unsupported", 1, Scope.PAIRING)
    attempt = 2
    // The pair's commands run before Task 20's noticePair calls pairAccepted: the failure is the last pairing's.
    sticky.execute(Command.AskPermissions)
    assertEquals(listOf<Command>(Command.AskPermissions), executed)
    assertEquals(listOf<Input>(Input.PlatformFailed(1, "MediaCodec.configure: unsupported")), reported)
  }

  @Test
  fun `review 13 m2 the walk reads eight links of the cause chain and no more`() {
    fun wrapped(depth: Int): Throwable = (1..depth).fold<Int, Throwable>(PermanentPlatformFailure("codec")) { inner, n -> RuntimeException("wrap $n", inner) }
    assertTrue(Failures.permanent(wrapped(7)), "the eighth link is read")
    assertFalse(Failures.permanent(wrapped(8)), "the ninth is not")
  }

  @Test
  fun `a failure is described by its class and its message, and by its class alone with no message`() {
    assertEquals("UnsatisfiedLinkError: libsrt", Failures.describe(UnsatisfiedLinkError("libsrt")))
    assertEquals("StackOverflowError", Failures.describe(StackOverflowError()))
  }

  @Test
  fun `a cause chain that loops ends the walk, and is not permanent`() {
    val first = RuntimeException("first")
    val second = IllegalStateException("second", first)
    first.initCause(second)
    var answer: Boolean? = null
    // On a thread of its own, so an unbounded walk fails this test instead of hanging the suite.
    val walker = thread(isDaemon = true) { answer = Failures.permanent(first) }
    walker.join(2_000)
    assertEquals(false, answer, "the walk returned, and found nothing permanent")
  }

  /**
   * Carries 15 and 18 together, on plan B's engine: a native library that will not load throws at the
   * first connect. The Error stops at the guard, the pairing ends fatal-error for the attempt in hand,
   * the End still reaches the platform, and the tick lives on with no beat after the end.
   */
  @Test
  fun `a linkage Error at the connect ends the pairing fatal-error, and the engine's thread lives on`() {
    val clock = FakeClock()
    val platform = mutableListOf<Command>()
    val published = mutableListOf<Pair<Long, SnapshotState>>()
    lateinit var engine: Engine
    val guard = StickyFailure({ command ->
      platform += command
      if (command is Command.Connect) throw UnsatisfiedLinkError("libsrt.so not found")
    }, { engine.phase.attemptInHand }) { engine.send(it) }
    val inner = FakeScheduler(clock)
    val scheduler =
      GuardedScheduler(inner) { failure ->
        if (Failures.permanent(failure)) guard.fail(Failures.describe(failure), engine.phase.attemptInHand, Scope.PROCESS)
      }
    engine = Engine(clock, scheduler, guard, { published += clock.mono to it.state }, SessionRecord {})
    engine.start()
    Configs.pairInputs().forEach(engine::send)
    inner.advanceBy(0)
    val connect = platform.filterIsInstance<Command.Connect>().single()
    assertEquals(1, scheduler.caught)
    assertEquals(EndReason.FATAL_ERROR, assertIs<Phase.Ended>(engine.phase).reason)
    val end = platform.indexOf(Command.End(EndReason.FATAL_ERROR))
    assertTrue(end > platform.indexOf(connect), "the End reached the platform after the connect")
    inner.advanceBy(30_000)
    assertEquals(SnapshotState.Ended(EndReason.FATAL_ERROR, durationMs = null), published.last().second)
    assertEquals(30_000L, published.last().first, "the tick still runs after the Error")
    assertTrue(platform.drop(end).none { it is Command.PostHeartbeat || it is Command.Connect }, "no beat and no connect after the end")
  }

  /**
   * Review 13 I1, the reviewer's probe as a row. A linkage Error ended the first pairing; the operator's
   * Continue tap (reset, then pair) meets the held process failure at the pair's permission ask, and
   * the new pairing ends fatal-error: no dialog, no Hold, no beat, so no claim on the slot. The fake
   * platform grants permissions at once, so an ask that got through would reach Paired and beat.
   */
  @Test
  fun `review 13 I1 a re-pair over a held process failure ends fatal-error before any Hold or beat`() {
    val clock = FakeClock()
    val platform = mutableListOf<Command>()
    var granting = false
    lateinit var engine: Engine
    val sticky = StickyFailure({ command ->
      platform += command
      if (command is Command.Connect) throw UnsatisfiedLinkError("libsrt.so not found")
      if (command == Command.AskPermissions && granting) engine.send(Input.PermissionsAnswered(granted = true))
    }, { engine.phase.attemptInHand }) { engine.send(it) }
    val inner = FakeScheduler(clock)
    val scheduler =
      GuardedScheduler(inner) { failure ->
        if (Failures.permanent(failure)) sticky.fail(Failures.describe(failure), engine.phase.attemptInHand, Scope.PROCESS)
      }
    engine = Engine(clock, scheduler, sticky, {}, SessionRecord {})
    engine.start()
    Configs.pairInputs().forEach(engine::send)
    inner.advanceBy(0)
    assertEquals(EndReason.FATAL_ERROR, assertIs<Phase.Ended>(engine.phase).reason)
    val tap = platform.size
    granting = true
    var accepted = false
    engine.send(Input.Reset)
    engine.send(Input.Pair(Configs.pairRequest(), Configs.PHONE, stopped = null))
    // Where Task 20's noticePair calls it: posted after the pair, run once the phase is Pairing.
    scheduler.schedule(0) {
      if (engine.phase is Phase.Pairing) {
        sticky.pairAccepted()
        accepted = true
      }
    }
    inner.advanceBy(600_000)
    assertTrue(accepted, "the new pairing was accepted, and the process failure outlived it")
    assertEquals(EndReason.FATAL_ERROR, assertIs<Phase.Ended>(engine.phase).reason)
    val after = platform.drop(tap)
    assertEquals(listOf<Command>(Command.End(EndReason.FATAL_ERROR)), after.filterIsInstance<Command.End>())
    assertTrue(after.none { it is Command.AskPermissions || it is Command.Hold || it is Command.PostHeartbeat || it is Command.Release }, "$after")
  }
}
