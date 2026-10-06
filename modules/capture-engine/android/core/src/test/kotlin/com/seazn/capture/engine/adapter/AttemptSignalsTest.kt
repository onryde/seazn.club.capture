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
  // --- Review C7 M-3: a drop while the start is in flight waits for the start's end ---

  @Test
  fun `M-3 a drop during a start that finds the camera busy is no drop, and the start's failure ends the attempt, once`() {
    val signals = AttemptSignals()
    signals.starting(1)
    assertNull(signals.dropped(1, IOException("endpoint closed")), "held while the start is in flight")
    assertNull(signals.startEnded(1, StartEnd.CAMERA), "the camera was another app's: the drop was the start's own failure")
    assertIs<Input.ConnectFailed>(signals.connectFailed(1, RuntimeException("Camera already in use")))
    assertNull(signals.connectFailed(1, RuntimeException("Camera already in use")), "once")
    assertNull(signals.dropped(1, IOException("endpoint closed")), "ended: a late drop is no second report")
  }

  @Test
  fun `M-3 a drop during a start that ends otherwise passes at the start's end, as it always did`() {
    var checked = 0
    for ((label, cause, reason) in listOf(Triple("the far end's", IOException("endpoint closed"), DropReason.ENDPOINT_CLOSED), Triple("asked for", null, DropReason.REQUESTED))) {
      if (cause != null) {
        val failing = AttemptSignals()
        failing.starting(1)
        assertNull(failing.dropped(1, cause), label)
        assertEquals(reason, failing.startEnded(1, StartEnd.FAILED)?.reason, "$label: the far end's drop passes once the start failed")
        assertNull(failing.connectFailed(1, ConnectException("refused")), "$label: and the failure after it does not")
        assertNull(failing.startEnded(1, StartEnd.FAILED), "$label: once")
      }
      val opening = AttemptSignals()
      opening.starting(1)
      assertNull(opening.dropped(1, cause), label)
      assertEquals(reason, opening.startEnded(1, StartEnd.RETURNED)?.reason, "$label: the drop passes before the open")
      assertEquals(Input.Connected(1), opening.connected(1), "$label: an open passes once, as it did after a drop")
      checked += 1
    }
    assertEquals(2, checked, "the sweep's own count")
  }

  /**
   * Device session 4, F-S4-1. StreamPack 3.2.1's `startStream(descriptor)` closes the endpoint it opened when the start
   * fails (`EncodingPipelineOutput.startStream`: its catch runs `closeUnsafe`, the 3.2.1 sources), and our sink's own
   * close ends the socket with no cause. That drop is the failed start's own close, so no drop: the start's failure ends
   * the attempt, as what it is. The phone read it as `other`, `requested`, never counted and with no message, 42
   * times in two minutes, and never fell back. A start that ran out its bound ends the same way.
   */
  @Test
  fun `F-S4-1 a failed start's own close is no drop - the start's failure ends the attempt, once`() {
    val signals = AttemptSignals()
    signals.starting(1)
    assertNull(signals.dropped(1, null), "held while the start is in flight")
    assertNull(signals.startEnded(1, StartEnd.FAILED), "the failed start's own close: no drop")
    assertEquals(ConnectFailure.REFUSED, signals.connectFailed(1, ConnectException("Connection setup failure: connection rejected"))?.failure, "the start's failure ends it")
    assertNull(signals.connectFailed(1, ConnectException("Connection setup failure: connection rejected")), "once")
    assertNull(signals.dropped(1, null), "ended: a late close is no second report")
    signals.starting(2)
    assertNull(signals.dropped(2, null))
    assertNull(signals.startEnded(2, StartEnd.FAILED), "the next attempt's own close is no drop either")
    assertEquals(ConnectFailure.TIMEOUT, signals.connectFailed(2, java.util.concurrent.TimeoutException("start timed out after 14000 ms"))?.failure)
  }

  @Test
  fun `M-3 with no drop in flight the start's end passes nothing, and a drop after it passes at once`() {
    val signals = AttemptSignals()
    assertNull(signals.startEnded(1, StartEnd.RETURNED), "no start in flight")
    signals.starting(1)
    assertNull(signals.startEnded(1, StartEnd.CAMERA), "no drop held")
    assertEquals(DropReason.ENDPOINT_CLOSED, signals.dropped(1, IOException("endpoint closed"))?.reason, "the start is over: no hold")
  }

  @Test
  fun `M-3 only the attempt starting is held - an older one's drop passes as before`() {
    val signals = AttemptSignals()
    assertEquals(Input.Connected(1), signals.connected(1))
    signals.starting(2)
    assertEquals(DropReason.ENDPOINT_CLOSED, signals.dropped(1, IOException("endpoint closed"))?.reason, "attempt 1 is not the start in flight")
    assertNull(signals.startEnded(1, StartEnd.CAMERA), "not the start in flight: nothing")
    assertNull(signals.dropped(2, IOException("endpoint closed")), "attempt 2's is held")
    assertEquals(DropReason.ENDPOINT_CLOSED, signals.startEnded(2, StartEnd.RETURNED)?.reason)
  }

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
