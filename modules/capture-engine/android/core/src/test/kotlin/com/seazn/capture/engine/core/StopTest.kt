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

  @Test fun `A8 a stop before the first frame sends no beat, and releases at once`() {
    val rig = MachineRig().armed()
    val commands = rig.send(Input.Stop)
    assertTrue(commands.none { it is Command.PostHeartbeat })
    assertTrue(Command.Release in commands)
  }

  @Test fun `A17 every stop from Arming on writes the record before End`() {
    val rig = MachineRig().paired()
    rig.codes = null
    rig.hear("go-live", sid = "sess_42")
    val commands = rig.send(Input.Stop).filter { it !is Command.Record }
    val written = assertIs<Command.WriteStopped>(commands[0]).record
    assertEquals("sess_42", written.sid)
    // No descriptor answered: twelve hours (RR2).
    assertEquals(written.stoppedAtEpochMs + StoppedRecord.DEFAULT_KEEP_MS, written.keepUntilEpochMs)
    assertEquals(Command.End(EndReason.OPERATOR_STOPPED), commands[1])
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
