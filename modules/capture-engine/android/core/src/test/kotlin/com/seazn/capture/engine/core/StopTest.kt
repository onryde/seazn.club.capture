package com.seazn.capture.engine.core

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertIs
import kotlin.test.assertNull
import kotlin.test.assertTrue

class StopTest {
  @Test fun `A8 a stop from a live broadcast sends one final beat beside End, and holds the service for it`() {
    val rig = MachineRig().live()
    rig.beats = null
    val commands = rig.send(Input.Stop).filter { it !is Command.Record }
    assertIs<Command.WriteStopped>(commands[0])
    assertEquals(Command.End(EndReason.OPERATOR_STOPPED), commands[1])
    val last = Configs.body(assertIs<Command.PostHeartbeat>(commands[2]))
    assertEquals("ended", last.getString("state"))
    assertEquals("operator-stopped", last.getString("endReason"))
    assertEquals("sess_42", last.getString("sid"))
    assertTrue(Command.Release !in commands)
  }

  @Test fun `A8 the service is released when the final beat answers`() {
    val rig = MachineRig().live()
    rig.beats = null
    rig.send(Input.Stop)
    val id = assertIs<Phase.Ended>(rig.phase).finalBeatId!!
    assertEquals(listOf(Command.Release), rig.send(Input.HeartbeatAnswered(id, HeartbeatResponse.Answered(200))).filter { it !is Command.Record })
  }

  @Test fun `A8 or after 10 s with no answer, and the beat is never retried`() {
    val rig = MachineRig().live()
    rig.beats = null
    rig.send(Input.Stop)
    val beats = rig.sent<Command.PostHeartbeat>().size
    rig.advance(9_500)
    assertTrue(rig.sent<Command.Release>().isEmpty())
    rig.advance(500)
    assertEquals(1, rig.sent<Command.Release>().size)
    assertEquals(beats, rig.sent<Command.PostHeartbeat>().size)
  }

  /** The broadcasts held but never live, by phase: Arming (the code unanswered), Armed (not ready) and Connecting. */
  private val neverLive: List<Pair<String, () -> MachineRig>> =
    listOf(
      "arming" to { MachineRig().paired().apply { codes = null; hear("go-live", sid = "sess_42") } },
      "armed" to { MachineRig().armed() },
      "connecting" to { MachineRig().armed().apply { ready() } },
    )

  /**
   * Owner decision 1 (2026-10-05), superseding A8's "no final beat when never live": a Stop before the first frame
   * ends the broadcast, not the pairing. The phone is Paired, with the service still held and Go live offered, and
   * in the Stop's own step one beat goes, holding no sid and carrying the stopped one (RR3); never `state: ended`
   * with the sid (T21), which would end the server's pairing. No End.
   */
  @Test fun `owner decision 1 a stop before the first frame stays Paired and sends the stopped sid on a beat in its own step`() {
    var checked = 0
    for ((name, held) in neverLive) {
      val rig = held()
      assertEquals(name, rig.state.wire, "the rig is $name")
      assertEquals(null, rig.phase.beating?.heartbeat?.inFlightId, "$name: no beat in flight before the stop")
      val commands = rig.send(Input.Stop)
      val paired = assertIs<Phase.Paired>(rig.phase, name)
      assertEquals(LastEnd.STOPPED, paired.pairing.lastEnd, name)
      assertTrue(commands.none { it is Command.End || it == Command.Release }, "$name: the pairing and its service stay: $commands")
      assertEquals(name == "connecting", Command.StopBroadcast in commands, "$name: the capture stops only what it publishes")
      val beat = Configs.body(commands.filterIsInstance<Command.PostHeartbeat>().single())
      assertEquals("paired", beat.getString("state"), name)
      assertTrue(beat.isNull("sid"), name)
      assertEquals("sess_42", beat.getString("stopped"), name)
      assertTrue(!beat.has("endReason") || beat.isNull("endReason"), "$name: never the ended beat (T21)")
      assertEquals(listOf("sess_42"), rig.sent<Command.WriteStopped>().map { it.record.sid }, name)
      assertTrue("sess_42" in paired.pairing.refused, "$name: never started or rejoined again")
      checked++
    }
    assertEquals(3, checked, "the never-live phases swept")
  }

  /**
   * Re-review 3 I, the operator's sequence: a Stop never live, then Go live, answered 409 already_live naming the
   * stopped sid (the server not yet done ending it: the stop beat raced, or not yet delivered). The phone refuses
   * it and says the start failed, where the hold had wiped "Stream stopped". The next hold, answered with a new
   * sid, arms it. A 5xx says the same try-again line.
   */
  @Test fun `owner decision 1 Go live after a never-live stop, answered already live with the stopped sid, says try again, and the next hold arms the new sid`() {
    val rig = MachineRig().paired()
    rig.ready()
    rig.starts = { StartAnswer.Started("sess_42") }
    rig.send(Input.Start)
    assertEquals("connecting", rig.state.wire)
    rig.send(Input.Stop)
    assertEquals(LastEnd.STOPPED, rig.snapshot.lastEnd)
    rig.starts = { StartAnswer.AlreadyLive("sess_42", "operator") }
    rig.send(Input.Start)
    assertIs<Phase.Paired>(rig.phase)
    assertEquals(Refusal.START_FAILED, rig.snapshot.refusal, "said, not silent")
    assertNull(rig.snapshot.lastEnd, "the hold's ask cleared Stream stopped")
    assertEquals(true, rig.records("start-answered").last().field("refusedSid"))
    rig.codes = { if (rig.phase is Phase.Arming) Configs.open(sid = "sess_43", descriptor = rig.descriptor) else null }
    rig.starts = { StartAnswer.Started("sess_43") }
    rig.send(Input.Start)
    assertEquals("sess_43", rig.phase.heldSid)
    assertEquals("connecting", rig.state.wire, "armed, and ready: connecting")
    assertNull(rig.snapshot.refusal)
    assertEquals(3, rig.sent<Command.PostStart>().size)
    val failed = MachineRig().paired()
    failed.ready()
    failed.starts = { StartAnswer.Failed("503") }
    failed.send(Input.Start)
    assertEquals(Refusal.START_FAILED, failed.snapshot.refusal, "a 5xx gives the same try-again line")
  }

  @Test fun `A17 every stop from Arming on writes the record - beside the stopped beat when never live, before End when live`() {
    val rig = MachineRig().paired()
    rig.codes = null
    rig.hear("go-live", sid = "sess_42")
    val commands = rig.send(Input.Stop).filter { it !is Command.Record }
    val written = commands.filterIsInstance<Command.WriteStopped>().single().record
    assertEquals("sess_42", written.sid)
    // No descriptor answered: twelve hours (RR2).
    assertEquals(written.stoppedAtEpochMs + StoppedRecord.DEFAULT_KEEP_MS, written.keepUntilEpochMs)
    assertTrue(commands.indexOf(commands.single { it is Command.WriteStopped }) < commands.indexOf(commands.single { it is Command.PostHeartbeat }), "written before the beat that carries it: $commands")
    val live = MachineRig().live().send(Input.Stop).filter { it !is Command.Record }
    assertIs<Command.WriteStopped>(live[0])
    assertEquals(Command.End(EndReason.OPERATOR_STOPPED), live[1])
  }

  /** Owner decision 1: the beat's 2xx delivers the record, once; no later beat carries it, and a second Stop sends nothing. */
  @Test fun `owner decision 1 the stopped beat's 2xx delivers it once - no later beat carries it, and a second stop sends nothing`() {
    val rig = MachineRig().armed()
    rig.send(Input.Stop)
    val answered = rig.hear("waiting")
    assertEquals(listOf(Command.DeleteStopped("fx42hmnp7k2q", 1)), answered.filterIsInstance<Command.DeleteStopped>())
    assertEquals(listOf<Any?>(200), rig.records("stopped-delivered").map { it.field("status") })
    assertNull(rig.phase.pairing!!.stopped)
    val beats = rig.sent<Command.PostHeartbeat>().size
    assertTrue(rig.send(Input.Stop).none { it is Command.PostHeartbeat }, "Paired holds no broadcast: the second stop is ignored")
    assertEquals(listOf<Any?>("stop"), rig.records("intent-ignored").map { it.field("intent") })
    rig.advance(60_000)
    val later = rig.sent<Command.PostHeartbeat>().drop(beats)
    assertTrue(later.isNotEmpty(), "Paired beats on")
    assertTrue(later.all { Configs.body(it).isNull("stopped") }, "never carried twice once delivered")
    assertEquals(1, rig.records("stopped-delivered").size)
  }

  /** Owner decision 1: a stopped beat that fails leaves the record held, so the next beat carries it, and delivers it. */
  @Test fun `owner decision 1 a stopped beat that fails is carried by the next beat, which delivers it`() {
    for (failure in listOf<HeartbeatResponse>(HeartbeatResponse.Failed("timeout"), HeartbeatResponse.Answered(503))) {
      val rig = MachineRig().armed()
      rig.send(Input.Stop)
      val first = rig.phase.beating!!.heartbeat.inFlightId!!
      rig.send(Input.HeartbeatAnswered(first, failure))
      assertTrue(rig.sent<Command.DeleteStopped>().isEmpty(), "$failure: kept")
      assertEquals("sess_42", rig.phase.pairing!!.stopped?.sid, "$failure")
      rig.hear("waiting")
      val beats = rig.sent<Command.PostHeartbeat>()
      assertEquals(listOf("sess_42", "sess_42"), beats.takeLast(2).map { Configs.body(it).getString("stopped") }, "$failure: the next beat carries it")
      assertEquals(1, rig.sent<Command.DeleteStopped>().size, "$failure: then delivered")
    }
  }

  /** Owner decision 1: a beat already in flight at the stop goes first; the stopped one follows its answer, not the cadence. */
  @Test fun `owner decision 1 a beat in flight at the stop is answered first, and the stopped beat follows at once`() {
    val rig = MachineRig().armed()
    rig.advance(BeatCadence.HELD_MAX_MS)
    val inFlight = rig.phase.beating!!.heartbeat.inFlightId!!
    assertTrue(rig.send(Input.Stop).none { it is Command.PostHeartbeat }, "one beat in flight at a time")
    rig.send(Input.HeartbeatAnswered(inFlight, HeartbeatResponse.Answered(200, BeatReply("go-live", "sess_42", "organiser", null, Configs.waiting()))))
    assertIs<Phase.Paired>(rig.phase, "the old beat's go-live names the stopped sid: refused")
    val beats = rig.sent<Command.PostHeartbeat>().size
    rig.advance(Engine.TICK_MS)
    val next = rig.sent<Command.PostHeartbeat>().drop(beats).single()
    assertEquals("sess_42", Configs.body(next).getString("stopped"))
  }

  /** The 401 deferral stands: a code that ended while the broadcast was held ends the pairing with it, as before. */
  @Test fun `owner decision 1 leaves the 401 deferral - a stop never live after a 401 ends the pairing`() {
    val rig = MachineRig().armed()
    rig.hear(null, status = 401)
    assertTrue(rig.phase.pairing!!.codeEndedPending)
    rig.send(Input.Stop)
    assertEquals(EndReason.OPERATOR_STOPPED, assertIs<Phase.Ended>(rig.phase).reason)
  }

  @Test fun `A17 a stop after the descriptor keeps the record for its maximum duration`() {
    val rig = MachineRig(descriptor = Configs.descriptor(maxDurationMinutes = 240)).live()
    rig.send(Input.Stop)
    val written = rig.sent<Command.WriteStopped>().single().record
    assertEquals(written.stoppedAtEpochMs + 240 * 60_000L, written.keepUntilEpochMs)
  }

  @Test fun `A3 the stop ends the pairing - Ended operator-stopped, no more beats`() {
    val rig = MachineRig().live()
    rig.send(Input.Stop)
    rig.advance(60_000)
    val ended = assertIs<Phase.Ended>(rig.phase)
    assertEquals(EndReason.OPERATOR_STOPPED, ended.reason)
    assertEquals(1, rig.sent<Command.PostHeartbeat>().count { Configs.body(it).getString("state") == "ended" })
  }

  @Test fun `A17 the record rides every paired beat until delivered, and never a held one`() {
    val record = StoppedRecord.of(Configs.pairRequest().name, "sess_41", 1_790_000_000_000, null)
    val rig = MachineRig()
    rig.send(Input.Pair(Configs.pairRequest(), Configs.PHONE, record))
    rig.hear(null, status = 503)
    rig.advance(10_000)
    assertEquals("sess_41", Configs.body(rig.sent<Command.PostHeartbeat>().last()).getString("stopped"))
    rig.codes = null
    rig.hear("go-live", sid = "sess_42")
    rig.advance(10_000)
    assertTrue(Configs.body(rig.sent<Command.PostHeartbeat>().last()).isNull("stopped"))
  }

  @Test fun `A17 a 2xx to a beat that carried it deletes it, and so do replaced and taken (G0-g)`() {
    for (state in listOf("over", "waiting", "replaced", "taken")) {
      val record = StoppedRecord.of(Configs.pairRequest().name, "sess_41", 1_790_000_000_000, null)
      val rig = MachineRig()
      rig.send(Input.Pair(Configs.pairRequest(), Configs.PHONE, record))
      rig.hear(state, sid = "sess_41")
      assertEquals(listOf(Command.DeleteStopped("fx42hmnp7k2q", 1)), rig.sent<Command.DeleteStopped>(), state)
    }
  }

  @Test fun `A17 a 404, 429, 5xx or no answer keeps it`() {
    for (status in listOf(404, 429, 500)) {
      val record = StoppedRecord.of(Configs.pairRequest().name, "sess_41", 1_790_000_000_000, null)
      val rig = MachineRig()
      rig.send(Input.Pair(Configs.pairRequest(), Configs.PHONE, record))
      rig.hear(null, status = status)
      assertTrue(rig.sent<Command.DeleteStopped>().isEmpty(), "$status")
      assertEquals(record, rig.phase.pairing!!.stopped)
    }
  }

  @Test fun `A17 a 401 for its code deletes it too`() {
    val record = StoppedRecord.of(Configs.pairRequest().name, "sess_41", 1_790_000_000_000, null)
    val rig = MachineRig()
    rig.send(Input.Pair(Configs.pairRequest(), Configs.PHONE, record))
    rig.hear(null, status = 401)
    assertEquals(1, rig.sent<Command.DeleteStopped>().size)
  }

  @Test fun `A17 while the record exists its sid is never rejoined, even after delivery`() {
    val record = StoppedRecord.of(Configs.pairRequest().name, "sess_41", 1_790_000_000_000, null)
    val rig = MachineRig()
    rig.send(Input.Pair(Configs.pairRequest(), Configs.PHONE, record))
    rig.hear("live", sid = "sess_41")
    assertIs<Phase.Paired>(rig.phase)
    rig.hear("live", sid = "sess_41")
    assertIs<Phase.Paired>(rig.phase)
    // Never rejoined: no code was fetched for it (the rig's own answer would bounce a wrong Arming back to Paired).
    assertTrue(rig.sent<Command.FetchCode>().isEmpty())
  }

  @Test fun `A17 a record past keepUntil, or for another slot, is not carried`() {
    val name = Configs.pairRequest().name
    val stale = StoppedRecord("fx42hmnp7k2q", 1, "sess_41", 0, 1)
    val other = StoppedRecord.of(name.copy(slot = 2), "sess_41", 1_790_000_000_000, null)
    for (record in listOf(stale, other)) {
      val rig = MachineRig()
      rig.send(Input.Pair(Configs.pairRequest(), Configs.PHONE, record))
      assertNull(rig.phase.pairing!!.stopped)
    }
  }

  @Test fun `A8 the final beat's id is spent - the next pairing's claim never reuses it`() {
    val rig = MachineRig().live()
    rig.send(Input.Stop)
    val finalId = assertIs<Phase.Ended>(rig.phase).finalBeatId!!
    rig.send(Input.Reset)
    rig.paired()
    val claim = rig.sent<Command.PostHeartbeat>().last()
    assertTrue(claim.beatId > finalId, "the claim ${claim.beatId}, the final beat $finalId")
    // The final beat's late answer is not the claim's: nothing arms.
    rig.send(Input.HeartbeatAnswered(finalId, HeartbeatResponse.Answered(200, BeatReply("go-live", "sess_43", "organiser", null, Configs.waiting()))))
    assertIs<Phase.Paired>(rig.phase)
  }

  @Test fun `A8 only the final beat's answer releases - an older beat's late answer does not`() {
    val rig = MachineRig().live()
    rig.advance(10_000)
    val older = rig.phase.pairing!!.heartbeat.inFlightId!!
    rig.send(Input.Stop)
    assertTrue(rig.send(Input.HeartbeatAnswered(older, HeartbeatResponse.Answered(200))).none { it == Command.Release })
    assertTrue(rig.sent<Command.Release>().isEmpty())
  }

  @Test fun `A17 a 401 heard while a broadcast is held deletes the record at once`() {
    val record = StoppedRecord.of(Configs.pairRequest().name, "sess_41", 1_790_000_000_000, null)
    val rig = MachineRig()
    rig.send(Input.Pair(Configs.pairRequest(), Configs.PHONE, record))
    rig.send(Input.Network(true))
    rig.hear(null, status = 503)
    rig.ready()
    rig.starts = { StartAnswer.Started("sess_42") }
    rig.send(Input.Start)
    assertTrue(rig.phase.holdsBroadcast, "${rig.phase.name}")
    rig.hear(null, status = 401)
    assertTrue(rig.phase.pairing!!.codeEndedPending)
    assertEquals(listOf(Command.DeleteStopped("fx42hmnp7k2q", 1)), rig.sent<Command.DeleteStopped>())
  }

  @Test fun `A17 RR3 a held beat carries no record, so its 2xx delivers nothing`() {
    val record = StoppedRecord.of(Configs.pairRequest().name, "sess_41", 1_790_000_000_000, null)
    val rig = MachineRig()
    rig.send(Input.Pair(Configs.pairRequest(), Configs.PHONE, record))
    rig.send(Input.Network(true))
    rig.hear(null, status = 503)
    rig.ready()
    rig.starts = { StartAnswer.Started("sess_42") }
    rig.send(Input.Start)
    assertTrue(rig.phase.holdsBroadcast, "${rig.phase.name}")
    rig.hear("live", sid = "sess_42")
    assertTrue(rig.sent<Command.DeleteStopped>().isEmpty())
    assertEquals(record, rig.phase.pairing!!.stopped)
  }

  @Test fun `a fatal error ends the pairing with End and Release, from any phase`() {
    val rig = MachineRig().live()
    val commands = rig.send(Input.PlatformFailed(rig.attempt!!, "codec"))
    assertEquals(listOf(Command.End(EndReason.FATAL_ERROR), Command.Release), commands.filter { it is Command.End || it == Command.Release })
  }

  @Test fun `reset from Ended with the final beat pending releases at once`() {
    val rig = MachineRig().live()
    rig.beats = null
    rig.send(Input.Stop)
    assertTrue(Command.Release in rig.send(Input.Reset))
  }
}
