package com.seazn.capture.engine.adapter

import com.seazn.capture.engine.core.Command
import com.seazn.capture.engine.core.Configs
import com.seazn.capture.engine.core.ConnectFailure
import com.seazn.capture.engine.core.DropReason
import com.seazn.capture.engine.core.Engine
import com.seazn.capture.engine.core.FakeClock
import com.seazn.capture.engine.core.FakeScheduler
import com.seazn.capture.engine.core.Input
import com.seazn.capture.engine.core.SessionMachine
import com.seazn.capture.engine.core.SessionRecord
import java.io.IOException
import java.net.ConnectException
import java.net.URLEncoder
import java.net.UnknownHostException
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull

class AttemptSignalsTest {
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
    assertEquals(null, signals.connected(2), "a failed attempt never connects")
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
  fun `a sink that ends before its connect answers is a drop, and that attempt never connects or fails after it`() {
    val signals = AttemptSignals()
    assertEquals(Input.Dropped(5, DropReason.ENDPOINT_CLOSED, "IOException: reset"), signals.dropped(5, IOException("reset")))
    assertNull(signals.connected(5))
    assertNull(signals.connectFailed(5, IOException("late")))
  }

  @Test
  fun `a late signal for an older attempt is stale, as the pollers read it (carry from Task 14)`() {
    val signals = AttemptSignals()
    assertEquals(Input.Connected(1), signals.connected(1))
    assertEquals(Input.Connected(2), signals.connected(2), "a newer attempt starts afresh")
    assertNull(signals.connected(1), "a late Connected for attempt n-1")
    assertNull(signals.dropped(1, IOException("reset")), "a late Dropped for attempt n-1")
    assertNull(signals.connectFailed(1, IOException("late")), "a late ConnectFailed for attempt n-1")
    assertEquals(Input.Dropped(2, DropReason.REQUESTED, null), signals.dropped(2, null), "the newest attempt still ends once")
  }

  @Test
  fun `the newest attempt is the highest heard of, whichever signal named it`() {
    val signals = AttemptSignals()
    assertEquals(ConnectFailure.TIMEOUT, signals.connectFailed(7, ConnectException("Connection setup failure: connection timed out"))?.failure)
    assertNull(signals.dropped(6, IOException("reset")), "attempt 6 never signalled, and is older than the failed 7")
    assertEquals(Input.Connected(8), signals.connected(8))
  }

  /**
   * Security. A library may quote the SRT URL it was given in its message, secrets and all. The record
   * masks each protected secret where it stands (CD6), so the adapter must pass the text through whole:
   * a cut message could leave part of a secret that no mask matches. Read whole and in part, 8 characters
   * at a time, on the lines that carry the platform's text.
   */
  @Test
  fun `a secret the platform quotes in a failure or a drop never reaches the record, whole or in part`() {
    val clock = FakeClock()
    val scheduler = FakeScheduler(clock)
    val lines = mutableListOf<String>()
    val connects = mutableListOf<Int>()
    val engine =
      Engine(
        clock,
        scheduler,
        commands = { if (it is Command.Connect) connects += it.attemptId },
        snapshots = {},
        record = SessionRecord { lines += it },
      ).apply { start() }
    Configs.pairInputs().forEach(engine::send)
    scheduler.advanceBy(0)
    val encoded = URLEncoder.encode(Configs.PASSPHRASE, "UTF-8")
    val quoted = "srt://live.cloudflare.com:778?streamid=${Configs.STREAM_ID}&passphrase=$encoded (${Configs.PASSPHRASE})"
    val signals = AttemptSignals()
    engine.send(signals.connectFailed(connects.last(), ConnectException("Connection setup failure: $quoted"))!!)
    scheduler.advanceBy(SessionMachine.RETRY_MS + Engine.TICK_MS)
    val next = connects.last()
    engine.send(signals.connected(next)!!)
    engine.send(signals.dropped(next, IOException("Connection reset: $quoted"))!!)
    scheduler.advanceBy(0)
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
