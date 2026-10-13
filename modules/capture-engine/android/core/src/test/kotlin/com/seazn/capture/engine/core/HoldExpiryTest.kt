package com.seazn.capture.engine.core

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertIs
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * N37, the owner's ruling of 2026-10-13 (option a; R8 in the D3 fixes ledger, not the D3 findings design's R8): when the
 * hold runs out the phone ends the broadcast itself. It stays Paired, tells the server with `stopped: <sid>` on a beat
 * (T23: the server ends that session and keeps the pairing), and never rejoins the sid: a restored network waits for a
 * new Go live. Before the ruling the server kept the session live, and the phone rejoined it on the network's return
 * (N29's rejoin), a second recording after a strip that said the stream had stopped.
 */
class HoldExpiryTest {
  private val sevenSecondHolds = Configs.descriptor(holdWindowSeconds = mapOf(Transport.SRT to 7, Transport.RTMPS to 7))

  /**
   * Live on sess_42 at 1 s with 7 s holds, then the network goes: dropped at 1 s, every beat fails at once (as one sent
   * with no network does), and no connect or code fetch is ever answered.
   */
  private fun offline(rig: MachineRig = MachineRig(descriptor = sevenSecondHolds).live()): MachineRig {
    rig.beats = { HeartbeatResponse.Failed("no network") }
    rig.send(Input.Network(false))
    rig.send(Input.Dropped(rig.attempt!!, DropReason.ENDPOINT_CLOSED, null))
    return rig
  }

  /**
   * The hold from the drop at 1 s runs out at 8 s, connecting (attempt 2 asked for at 3 s, unanswered) or on air
   * (attempt 2 connected at 3.5 s with no frame since, its first-frame grace running to 8.5 s). Time is at 7.5 s.
   */
  private val holding: List<Pair<String, () -> MachineRig>> =
    listOf(
      "connecting" to { offline().apply { advance(6_500, feeding = false) } },
      "on air" to {
        offline().apply {
          advance(2_500, feeding = false)
          send(Input.Connected(attempt!!))
          advance(4_000, feeding = false)
        }
      },
    )

  /** The tick at 8 s that ends it, and its commands. */
  private fun expire(rig: MachineRig): List<Command> {
    assertIs<SnapshotState.Reconnecting>(rig.state, "7.5 s: still holding")
    rig.at(8_000)
    return rig.send(Input.Tick)
  }

  private fun expired(): MachineRig = offline().apply { advance(6_500, feeding = false) }.also { expire(it) }

  private fun carriedStopped(rig: MachineRig): List<String?> =
    rig.sent<Command.PostHeartbeat>().map { Configs.body(it) }.map { if (it.isNull("stopped")) null else it.getString("stopped") }

  @Test
  fun `N37 the hold runs out - Paired, the sid refused, its record written, and the stopped sid on a beat in the same step`() {
    var checked = 0
    for ((name, setup) in holding) {
      val rig = setup()
      assertEquals(name, rig.phase.name.replace("-", " "), "the rig is $name")
      val commands = expire(rig)
      val paired = assertIs<Phase.Paired>(rig.phase, name)
      assertEquals(LastEnd.HOLD_WINDOW_EXPIRED, paired.pairing.lastEnd, name)
      assertTrue("sess_42" in paired.pairing.refused, "$name: never started or rejoined again")
      // No End and no Release: the pairing and its service stay, as for a Stop never live (owner decision 1).
      val platform = commands.filterNot { it is Command.Record }
      assertEquals(listOf(Command.StopBroadcast::class, Command.WriteStopped::class, Command.PostHeartbeat::class), platform.map { it::class }, name)
      assertEquals("sess_42", platform.filterIsInstance<Command.WriteStopped>().single().record.sid, name)
      val beat = Configs.body(platform.filterIsInstance<Command.PostHeartbeat>().single())
      assertEquals("paired", beat.getString("state"), name)
      assertTrue(beat.isNull("sid"), name)
      assertEquals("sess_42", beat.getString("stopped"), name)
      assertTrue(!beat.has("endReason"), "$name: never the ended beat (T21), which ends the server's pairing")
      checked++
    }
    assertEquals(2, checked)
  }

  @Test
  fun `N37 the record names the end - hold-expired, then the broadcast ended for its sid, and the pairing never ends`() {
    val rig = offline().apply { advance(6_500, feeding = false) }
    val lines = expire(rig).filterIsInstance<Command.Record>().map { it.entry }
    assertEquals(listOf("hold-expired", "broadcast-ended"), lines.map { it.kind })
    val ended = lines.single { it.kind == "broadcast-ended" }
    assertEquals("sess_42", ended.field("sid"))
    assertEquals(LastEnd.HOLD_WINDOW_EXPIRED, ended.field("lastEnd"))
    assertEquals(true, ended.field("wasLive"))
    assertTrue(rig.records("ended").isEmpty() && rig.records("unpaired").isEmpty(), "the pairing goes on: its record window stays open")
  }

  @Test
  fun `N37 every beat carries the stopped sid until one is answered 2xx, which delivers it once - and the line stays`() {
    val rig = expired()
    rig.advance(30_000)
    // Counted by hand: the expiry's beat at 8 s, then the paired cadence of 10 s, each failed at once: 18, 28 and 38 s.
    assertEquals(listOf("sess_42", "sess_42", "sess_42", "sess_42"), carriedStopped(rig).drop(1))
    assertTrue(rig.sent<Command.DeleteStopped>().isEmpty(), "a failed beat delivers nothing")
    // The network is back: the server ends sess_42 on the stopped beat and answers over (T23).
    rig.beats = null
    rig.send(Input.Network(true))
    val delivered = rig.hear("over", sid = "sess_42", endReason = "stopped")
    assertTrue(delivered.any { it is Command.DeleteStopped }, "$delivered")
    assertEquals(1, rig.records("stopped-delivered").size)
    assertNull(rig.phase.pairing!!.stopped)
    assertEquals(LastEnd.HOLD_WINDOW_EXPIRED, rig.snapshot.lastEnd, "the server's over for the stopped sid does not move the line")
    rig.hear("waiting")
    assertNull(carriedStopped(rig).last(), "delivered: the next beat carries none")
    assertEquals(1, rig.sent<Command.DeleteStopped>().size)
  }

  @Test
  fun `N37 after the network's return the server's live for the lapsed sid arms nothing, a second time too - no second recording`() {
    val rig = expired()
    val fetches = rig.sent<Command.FetchCode>().size
    val connects = rig.connects().size
    rig.beats = null
    rig.send(Input.Network(true))
    for (word in listOf("live", "live", "go-live")) {
      rig.hear(word, sid = "sess_42", startedBy = "organiser")
      assertIs<Phase.Paired>(rig.phase, word)
      assertEquals(LastEnd.HOLD_WINDOW_EXPIRED, rig.snapshot.lastEnd, "$word: the line stays until the next start")
    }
    assertEquals(listOf("sess_42", "sess_42", "sess_42"), rig.records("open-ignored").map { it.field("sid") })
    assertEquals(fetches, rig.sent<Command.FetchCode>().size, "no code fetched for it")
    assertEquals(connects, rig.connects().size, "nothing connects")
    assertTrue(rig.records("broadcast-start").size == 1, "only the first Go live")
  }

  @Test
  fun `N37 the operator's Go live after the expiry, answered already live with the lapsed sid, says try again, and a new sid starts plainly`() {
    val rig = expired()
    rig.beats = null
    rig.send(Input.Network(true))
    val fetches = rig.sent<Command.FetchCode>().size
    rig.starts = { StartAnswer.AlreadyLive("sess_42", "operator") }
    rig.send(Input.Start)
    assertIs<Phase.Paired>(rig.phase)
    assertEquals(Refusal.START_FAILED, rig.snapshot.refusal, "said, not silent")
    assertEquals(true, rig.records("start-answered").last().field("refusedSid"))
    assertEquals(fetches, rig.sent<Command.FetchCode>().size, "the lapsed sid is never armed")
    rig.codes = { if (rig.phase is Phase.Arming) Configs.open(sid = "sess_43", descriptor = sevenSecondHolds) else null }
    rig.starts = { StartAnswer.Started("sess_43") }
    rig.send(Input.Start)
    assertEquals("sess_43", rig.phase.heldSid)
    assertEquals(Cause.OPERATOR, rig.session.cause)
    assertEquals(SnapshotState.Connecting(Transport.SRT), rig.state, "a new start, never a rejoin")
  }

  @Test
  fun `N37 the console's Go live for a new sid after the expiry starts it as any start from Paired, on a clock of its own`() {
    val rig = MachineRig(descriptor = sevenSecondHolds).live()
    val lapsedSince = rig.session.liveSinceEpochMs!!
    offline(rig).advance(6_500, feeding = false)
    expire(rig)
    rig.beats = null
    rig.send(Input.Network(true))
    rig.codes = { if (rig.phase is Phase.Arming) Configs.open(sid = "sess_43", descriptor = sevenSecondHolds) else null }
    rig.hear("go-live", sid = "sess_43", startedBy = "organiser")
    assertEquals("sess_43", rig.phase.heldSid)
    assertEquals(Cause.ORGANISER, rig.session.cause)
    assertEquals(SnapshotState.Connecting(Transport.SRT), rig.state)
    rig.send(Input.Connected(rig.attempt!!))
    val connectedAt = rig.wall
    rig.advance(1_000)
    val since = assertIs<SnapshotState.Publishing>(rig.state).sinceEpochMs
    assertTrue(since in connectedAt..rig.wall, "the new broadcast's own first frame, $since")
    assertTrue(since - lapsedSince >= 8_000, "never the lapsed broadcast's clock")
  }

  @Test
  fun `N37 a second call - the tick after the expiry does nothing, and a second broadcast's expiry refuses its sid too`() {
    val rig = expired()
    assertEquals(emptyList(), rig.send(Input.Tick), "the expiry is not judged twice")
    rig.beats = null
    rig.send(Input.Network(true))
    rig.codes = { if (rig.phase is Phase.Arming) Configs.open(sid = "sess_43", descriptor = sevenSecondHolds) else null }
    rig.hear("go-live", sid = "sess_43", startedBy = "organiser")
    rig.send(Input.Connected(rig.attempt!!))
    rig.advance(1_000)
    assertIs<SnapshotState.Publishing>(rig.state)
    offline(rig)
    rig.advance(6_500, feeding = false)
    assertIs<SnapshotState.Reconnecting>(rig.state)
    rig.advance(500, feeding = false)
    val paired = assertIs<Phase.Paired>(rig.phase)
    assertEquals(setOf("sess_42", "sess_43"), paired.pairing.refused)
    assertEquals(listOf("sess_42", "sess_43"), rig.sent<Command.WriteStopped>().map { it.record.sid })
    assertEquals("sess_43", paired.pairing.stopped?.sid, "one record a pairing: the newer one")
    assertEquals(2, rig.records("hold-expired").size)
  }

  @Test
  fun `N37 an empty input - a broadcast that never went live has no hold to run out, and nothing is refused`() {
    val rig = MachineRig(descriptor = sevenSecondHolds).armed()
    rig.ready()
    rig.beats = { HeartbeatResponse.Failed("no network") }
    rig.send(Input.Network(false))
    rig.advance(30_000, feeding = false)
    assertIs<Phase.Connecting>(rig.phase)
    assertEquals(SnapshotState.Connecting(Transport.SRT), rig.state)
    assertTrue(rig.records("hold-expired").isEmpty())
    assertTrue(rig.phase.pairing!!.refused.isEmpty())
    assertTrue(rig.sent<Command.WriteStopped>().isEmpty())
  }

  @Test
  fun `N37 after an interruption - a fatal error after the expiry holds no broadcast, so it ends never live`() {
    val rig = expired()
    rig.send(Input.PlatformFailed(rig.phase.attemptInHand, "codec"))
    assertNull(assertIs<SnapshotState.Ended>(rig.state).durationMs)
    assertEquals(false, rig.records("ended").single().field("wasLive"))
  }

  @Test
  fun `N37 leaves A10's rejoin alone - a fresh pairing hearing live, no expiry behind it, arms the sid and connects plainly`() {
    val rig = MachineRig(descriptor = sevenSecondHolds).paired()
    rig.codes = { if (rig.phase is Phase.Arming) Configs.open(sid = "sess_42", descriptor = sevenSecondHolds) else null }
    rig.hear("live", sid = "sess_42")
    rig.ready()
    assertEquals("sess_42", rig.phase.heldSid)
    assertEquals(Cause.REJOIN, rig.session.cause)
    assertEquals(SnapshotState.Connecting(Transport.SRT), rig.state)
  }

  @Test
  fun `N37 after an interruption - a process death before the 2xx keeps the record, so the cold start carries it and refuses the sid`() {
    val rig = expired()
    val record = rig.sent<Command.WriteStopped>().single().record
    // A new engine: the cold-start re-pair, its stopped record read back from the store (A17).
    val cold = MachineRig(descriptor = sevenSecondHolds)
    cold.at(rig.mono + 60_000)
    cold.send(Input.Pair(Configs.pairRequest(claim = Claim.RESUME), Configs.PHONE, record))
    cold.send(Input.Network(true))
    assertEquals("sess_42", carriedStopped(cold).first(), "the claim beat carries it")
    cold.hear("live", sid = "sess_42")
    assertIs<Phase.Paired>(cold.phase)
    assertTrue(cold.sent<Command.FetchCode>().isEmpty(), "never rejoined")
  }
}
