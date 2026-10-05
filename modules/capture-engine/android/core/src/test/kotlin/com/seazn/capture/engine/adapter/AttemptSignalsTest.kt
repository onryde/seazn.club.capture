package com.seazn.capture.engine.adapter

import com.seazn.capture.engine.core.BroadcastDescriptor
import com.seazn.capture.engine.core.Command
import com.seazn.capture.engine.core.Configs
import com.seazn.capture.engine.core.ConnectFailure
import com.seazn.capture.engine.core.DropReason
import com.seazn.capture.engine.core.Engine
import com.seazn.capture.engine.core.FakeClock
import com.seazn.capture.engine.core.FakeScheduler
import com.seazn.capture.engine.core.FallbackPolicy
import com.seazn.capture.engine.core.Input
import com.seazn.capture.engine.core.Phase
import com.seazn.capture.engine.core.RtmpsTarget
import com.seazn.capture.engine.core.SessionMachine
import com.seazn.capture.engine.core.SessionRecord
import java.io.IOException
import java.net.ConnectException
import java.net.URLEncoder
import java.net.UnknownHostException
import java.nio.channels.UnresolvedAddressException
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertIs
import kotlin.test.assertNull
import kotlin.test.assertTrue

class AttemptSignalsTest {
  /** A real engine, paired and armed through [Configs.pairInputs], keeping what it commands and what it writes. */
  private class Rig(descriptor: BroadcastDescriptor = Configs.descriptor()) {
    val clock = FakeClock()
    val scheduler = FakeScheduler(clock)
    val lines = mutableListOf<String>()
    val executed = mutableListOf<Command>()
    val engine = Engine(clock, scheduler, commands = { executed += it }, snapshots = {}, record = SessionRecord { lines += it }).apply { start() }

    init {
      Configs.pairInputs(descriptor).forEach(engine::send)
      scheduler.advanceBy(0)
    }

    val connects: List<Command.Connect>
      get() = executed.filterIsInstance<Command.Connect>()

    /** Sends a signal the adapter let through, and returns the commands the engine answered it with. */
    fun send(input: Input?): List<Command> {
      val before = executed.size
      engine.send(requireNotNull(input) { "the signal was swallowed" })
      scheduler.advanceBy(0)
      return executed.drop(before)
    }

    fun retry() = scheduler.advanceBy(SessionMachine.RETRY_MS + Engine.TICK_MS)
  }

  @Test
  fun `R3 one drop per attempt, from the sink's completion, however often it is reported`() {
    val signals = AttemptSignals()
    assertEquals(Input.Connected(1), signals.connected(1))
    assertEquals(null, signals.connected(1), "a replayed open is not a second connect")
    val first = signals.dropped(1, IOException("reset"))
    assertEquals(Input.Dropped(1, DropReason.ENDPOINT_CLOSED, "IOException: reset"), first)
    assertEquals(null, signals.dropped(1, IOException("reset")), "StateFlow replays; we report once")
    assertEquals(null, signals.connected(1), "a dropped attempt never connects again")
  }

  @Test
  fun `a failed connect is reported once, and never also as a drop`() {
    val signals = AttemptSignals()
    assertEquals(Input.ConnectFailed(2, ConnectFailure.UNRESOLVED, "UnknownHostException: h"), signals.connectFailed(2, UnknownHostException("h")))
    assertEquals(null, signals.connectFailed(2, UnknownHostException("h")))
    assertEquals(null, signals.dropped(2, null))
  }

  @Test
  fun `a clean close with no cause is a requested drop`() {
    val signals = AttemptSignals().apply { connected(3) }
    assertEquals(Input.Dropped(3, DropReason.REQUESTED, null), signals.dropped(3, null))
  }

  @Test
  fun `a connect failure after the attempt connected is not reported, and its drop still is (review 14)`() {
    // The machine ignores a ConnectFailed once on air, with no line (G4): the attempt's end is its drop.
    val signals = AttemptSignals().apply { connected(4) }
    assertNull(signals.connectFailed(4, ConnectException("Connection setup failure: connection timed out")))
    assertEquals(Input.Dropped(4, DropReason.ENDPOINT_CLOSED, "IOException: reset"), signals.dropped(4, IOException("reset")))
  }

  @Test
  fun `a sink that ends before its connect answers is a drop, and that attempt never fails after it`() {
    val signals = AttemptSignals()
    assertEquals(Input.Dropped(5, DropReason.ENDPOINT_CLOSED, "IOException: reset"), signals.dropped(5, IOException("reset")))
    assertNull(signals.connectFailed(5, IOException("late")))
  }

  /**
   * I1. An open is the one signal the machine must always hear, whichever attempt it names and whether
   * or not that attempt failed or dropped: it answers one it no longer wants with `Disconnect(n)` and a
   * `stale-connected` line (`SessionMachine.connected`), and that is what closes the stream. Only the
   * pollers ignore an older attempt's open (Task 14). Within one attempt a replayed open is still not a
   * second connect.
   */
  @Test
  fun `I1 an open passes once per attempt, an older one's too, tagged with its id`() {
    val signals = AttemptSignals()
    assertEquals(ConnectFailure.TIMEOUT, signals.connectFailed(1, ConnectException("Connection setup failure: connection timed out"))?.failure)
    assertEquals(Input.Connected(1), signals.connected(1), "attempt 1 opens after its own failure: the machine closes it")
    assertEquals(Input.Connected(2), signals.connected(2), "a newer attempt starts afresh")
    assertNull(signals.connected(2), "the current attempt's replayed open is still deduped")
    assertNull(signals.connected(1), "and attempt 1's, once reported")
    assertEquals(Input.Dropped(3, DropReason.ENDPOINT_CLOSED, "IOException: reset"), signals.dropped(3, IOException("reset")))
    assertEquals(Input.Connected(3), signals.connected(3), "attempt 3 opens after its own drop: the machine closes it")
  }

  @Test
  fun `I1 an older attempt that never opened passes its first open, while its drop and failure stay stale`() {
    val signals = AttemptSignals()
    assertEquals(ConnectFailure.TIMEOUT, signals.connectFailed(1, ConnectException("Connection setup failure: connection timed out"))?.failure)
    assertEquals(Input.Connected(2), signals.connected(2))
    assertEquals(Input.Connected(1), signals.connected(1), "attempt 1's late open, after attempt 2 went on air")
    assertNull(signals.connected(1), "once")
    assertNull(signals.dropped(1, IOException("reset")), "a late Dropped for attempt n-1: the machine ignores it anyway")
    assertNull(signals.connectFailed(1, IOException("late")), "a late ConnectFailed for attempt n-1")
    assertEquals(Input.Dropped(2, DropReason.REQUESTED, null), signals.dropped(2, null), "the newest attempt still ends once")
  }

  @Test
  fun `I1 the machine closes every late open it no longer wants, and the attempt on air carries on`() {
    val rig = Rig()
    val signals = AttemptSignals()
    val timedOut = ConnectException("Connection setup failure: connection timed out")
    val first = rig.connects.last().attemptId
    rig.send(signals.connectFailed(first, timedOut))
    // The same attempt opens after all, while the machine waits to retry.
    assertEquals(listOf<Command>(Command.Disconnect(first)), rig.send(signals.connected(first)))
    rig.retry()
    val second = rig.connects.last().attemptId
    rig.send(signals.connectFailed(second, timedOut))
    rig.retry()
    val third = rig.connects.last().attemptId
    rig.send(signals.connected(third))
    // Attempt 2 opens late, after attempt 3 went on air: older, and still the machine's to close.
    assertEquals(listOf<Command>(Command.Disconnect(second)), rig.send(signals.connected(second)))
    assertEquals(third, (rig.engine.phase as? Phase.OnAir)?.attemptId, "attempt $third stays on air")
    assertFalse(Command.Disconnect(third) in rig.executed)
    assertEquals(2, rig.lines.count { """"kind":"stale-connected"""" in it }, rig.lines.joinToString("\n"))
  }

  @Test
  fun `I2 F-P5-1 a dead DNS on RTMPS is unresolved, and never counts towards the final fallback`() {
    val rig = Rig(Configs.descriptor(primary = Configs.rtmps, fallback = Configs.srt))
    val signals = AttemptSignals()
    repeat(FallbackPolicy.FAILURES_TO_FALL_BACK + 1) { n ->
      val connect = rig.connects.last()
      assertIs<RtmpsTarget>(connect.target, "attempt ${connect.attemptId}")
      // Ktor (3.3.3 and 3.5.1, javap) leaves a failed lookup unresolved, and SocketChannel.connect throws this, with no message.
      val dead = if (n % 2 == 0) UnresolvedAddressException() else IOException("connect failed", UnresolvedAddressException())
      rig.send(signals.connectFailed(connect.attemptId, dead))
      rig.retry()
    }
    val failed = rig.lines.filter { """"kind":"connect-failed"""" in it }
    assertEquals(FallbackPolicy.FAILURES_TO_FALL_BACK + 1, failed.size, rig.lines.joinToString("\n"))
    for (line in failed) {
      assertTrue(""""failure":"unresolved"""" in line && """"validated":true""" in line && """"counted":false""" in line, line)
    }
    assertFalse(rig.lines.any { """"kind":"fell-back"""" in it }, "a dead DNS never moves the broadcast off RTMPS")
    assertIs<RtmpsTarget>(rig.connects.last().target)
  }

  @Test
  fun `the newest attempt is the highest heard of, whichever signal named it`() {
    val signals = AttemptSignals()
    assertEquals(ConnectFailure.TIMEOUT, signals.connectFailed(7, ConnectException("Connection setup failure: connection timed out"))?.failure)
    assertNull(signals.dropped(6, IOException("reset")), "attempt 6 never signalled, and is older than the failed 7")
    assertEquals(Input.Connected(8), signals.connected(8))
    assertNull(signals.connectFailed(6, IOException("late")), "an older attempt that never opened fails stale too")
    assertEquals(Input.Dropped(8, DropReason.REQUESTED, null), signals.dropped(8, null), "and leaves the newest one's end alone")
  }

  /**
   * Security. A library may quote the SRT URL it was given in its message, secrets and all. The record
   * masks each protected secret where it stands (CD6), so the adapter must pass the text through whole:
   * a cut message could leave part of a secret that no mask matches. Read whole and in part, 8 characters
   * at a time, on the lines that carry the platform's text.
   */
  @Test
  fun `a secret the platform quotes in a failure or a drop never reaches the record, whole or in part`() {
    val rig = Rig()
    val encoded = URLEncoder.encode(Configs.PASSPHRASE, "UTF-8")
    val quoted = "srt://live.cloudflare.com:778?streamid=${Configs.STREAM_ID}&passphrase=$encoded (${Configs.PASSPHRASE})"
    val signals = AttemptSignals()
    rig.send(signals.connectFailed(rig.connects.last().attemptId, ConnectException("Connection setup failure: $quoted")))
    rig.retry()
    val next = rig.connects.last().attemptId
    rig.send(signals.connected(next))
    rig.send(signals.dropped(next, IOException("Connection reset: $quoted")))
    val lines = rig.lines
    val quoting = lines.filter { """"kind":"connect-failed"""" in it || """"kind":"dropped"""" in it }
    assertEquals(2, quoting.size, lines.joinToString("\n"))
    for (line in quoting) {
      for (secret in listOf(Configs.PASSPHRASE, encoded, Configs.STREAM_ID)) {
        for (part in secret.windowed(8)) assertFalse(part in line, "leaked $part: $line")
      }
    }
    for (line in lines) assertFalse(Configs.PASSPHRASE.windowed(8).any { it in line }, "the passphrase, anywhere: $line")
  }
}
