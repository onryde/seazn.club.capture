package com.seazn.capture.engine.core

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertIs
import kotlin.test.assertTrue

class AnswerTableTest {
  private fun idle(rig: MachineRig) = assertIs<Phase.Idle>(rig.phase)

  private fun paired(rig: MachineRig) = assertIs<Phase.Paired>(rig.phase).pairing

  // The table's columns, each set up as the operator reaches it. Arming leaves the code's fetch in flight.
  private fun arming() = MachineRig().paired().apply { codes = null; hear("go-live", sid = "sess_42") }

  private fun connecting() = MachineRig().armed().apply { ready() }

  private val pairedOnly: List<Pair<String, () -> MachineRig>> = listOf("Paired" to { MachineRig().paired() })

  private val held: List<Pair<String, () -> MachineRig>> =
    listOf("Arming" to ::arming, "Armed" to { MachineRig().armed() }, "Connecting" to ::connecting, "on air" to { MachineRig().live() })

  private val everyPhase = pairedOnly + held

  /** Sets each phase up and checks it is the phase named, so a sweep can never test the wrong column. */
  private fun sweep(phases: List<Pair<String, () -> MachineRig>>, check: (String, MachineRig) -> Unit): Int {
    for ((name, setUp) in phases) {
      val rig = setUp()
      assertEquals(name, column(rig.phase), "set-up for $name")
      check(name, rig)
    }
    return phases.size
  }

  private fun column(phase: Phase): String =
    when (phase) {
      is Phase.Paired -> "Paired"
      is Phase.Arming -> "Arming"
      is Phase.Armed -> "Armed"
      is Phase.Connecting -> "Connecting"
      is Phase.OnAir -> "on air"
      else -> phase.name
    }

  /** Ticks until a beat is in flight, so the phase read before the answer is the one it answers; fails after two minutes with none. */
  private fun beatDue(rig: MachineRig): Phase {
    val until = rig.mono + 120_000
    while (rig.phase.beating?.heartbeat?.inFlightId == null) {
      check(rig.mono < until) { "no beat in flight in ${rig.phase.name} after two minutes" }
      rig.advance(500)
    }
    return rig.phase
  }

  @Test fun `beatDue fails, rather than hangs, on a rig that never beats`() {
    val failure = assertFailsWith<IllegalStateException> { beatDue(MachineRig()) }
    assertEquals("no beat in flight in idle after two minutes", failure.message)
  }

  // waiting
  @Test fun `waiting while paired changes nothing`() {
    val rig = MachineRig().paired()
    rig.hear("waiting")
    assertIs<Phase.Paired>(rig.phase)
  }

  @Test fun `waiting while Arming or Armed - S is over, back to Paired, stopped`() {
    val cases =
      sweep(held.take(2)) { name, rig ->
        rig.hear("waiting")
        assertEquals(LastEnd.STOPPED, paired(rig).lastEnd, name)
        assertTrue(rig.sent<Command.StopBroadcast>().isEmpty(), name)
      }
    assertEquals(2, cases)
  }

  @Test fun `waiting while on air - end S, back to Paired, stopped`() {
    val rig = MachineRig().live()
    rig.hear("waiting")
    assertEquals(LastEnd.STOPPED, paired(rig).lastEnd)
    assertEquals(1, rig.sent<Command.StopBroadcast>().size)
  }

  // go-live N and live N
  @Test fun `go-live N while paired starts N with its cause`() {
    val rig = MachineRig().paired()
    rig.codes = null
    rig.hear("go-live", sid = "sess_43", startedBy = "automatic")
    assertEquals(Cause.AUTOMATIC, assertIs<Phase.Arming>(rig.phase).cause)
  }

  @Test fun `A10 live N while paired rejoins N`() {
    val rig = MachineRig().paired()
    rig.codes = null
    rig.hear("live", sid = "sess_43")
    assertEquals(Cause.REJOIN, assertIs<Phase.Arming>(rig.phase).cause)
  }

  @Test fun `go-live N while Armed drops S's start and arms N`() {
    val rig = MachineRig().armed()
    rig.codes = null
    rig.hear("go-live", sid = "sess_43")
    assertEquals("sess_43", assertIs<Phase.Arming>(rig.phase).sid)
  }

  @Test fun `live N on air - S is over, end it, then Arming for N, a rejoin`() {
    val rig = MachineRig().live()
    rig.codes = null
    rig.hear("live", sid = "sess_43")
    assertEquals("sess_43", assertIs<Phase.Arming>(rig.phase).sid)
    assertEquals(Cause.REJOIN, (rig.phase as Phase.Arming).cause)
    assertEquals(1, rig.sent<Command.StopBroadcast>().size)
  }

  @Test fun `go-live N on air - S is over, end it, then Arming for N with its cause`() {
    val rig = MachineRig().live()
    rig.codes = null
    rig.hear("go-live", sid = "sess_43", startedBy = "organiser")
    assertEquals("sess_43", assertIs<Phase.Arming>(rig.phase).sid)
    assertEquals(Cause.ORGANISER, (rig.phase as Phase.Arming).cause)
    assertEquals(1, rig.sent<Command.StopBroadcast>().size)
  }

  @Test fun `live N while Armed drops S's start and rejoins N - nothing was publishing`() {
    val rig = MachineRig().armed()
    rig.codes = null
    rig.hear("live", sid = "sess_43")
    assertEquals("sess_43", assertIs<Phase.Arming>(rig.phase).sid)
    assertEquals(Cause.REJOIN, (rig.phase as Phase.Arming).cause)
    assertTrue(rig.sent<Command.StopBroadcast>().isEmpty())
  }

  @Test fun `go-live N while Arming S - S is over, Arming for N`() {
    val rig = MachineRig().paired()
    rig.codes = null
    rig.hear("go-live", sid = "sess_42")
    rig.hear("go-live", sid = "sess_43")
    assertEquals("sess_43", assertIs<Phase.Arming>(rig.phase).sid)
    assertTrue(rig.sent<Command.StopBroadcast>().isEmpty())
    // S's end is its line; lastEnd lasts "until the next start" (amendment, the snapshot fields), and N is one.
    val ended = rig.records("broadcast-ended").single()
    assertEquals("sess_42", ended.field("sid"))
    assertEquals(LastEnd.STOPPED, ended.field("lastEnd"))
    assertEquals(null, rig.phase.pairing!!.lastEnd)
  }

  @Test fun `go-live or live S is a confirmation in every held phase`() {
    var cases = 0
    for (word in listOf("go-live", "live")) {
      cases +=
        sweep(held) { name, rig ->
          val fetches = rig.sent<Command.FetchCode>().size
          val before = column(beatDue(rig))
          rig.hear(word, sid = "sess_42")
          assertEquals(before, column(rig.phase), "$word $name")
          assertEquals("sess_42", rig.phase.heldSid, "$word $name")
          assertTrue(rig.sent<Command.StopBroadcast>().isEmpty(), "$word $name")
          assertEquals(fetches, rig.sent<Command.FetchCode>().size, "$word $name: nothing is fetched again")
        }
    }
    assertEquals(8, cases)
  }

  // over
  @Test fun `over S while Armed - Paired, the line for its endReason`() {
    val rig = MachineRig().armed()
    rig.hear("over", sid = "sess_42", endReason = "stopped")
    assertEquals(LastEnd.STOPPED_BY_ORGANISER, paired(rig).lastEnd)
  }

  @Test fun `over S on air - end S, Paired, its line - for every endReason`() {
    val table =
      mapOf(
        "stopped" to LastEnd.STOPPED_BY_ORGANISER,
        "auto_stopped" to LastEnd.STOPPED_AUTOMATICALLY,
        "no_inbound_timeout" to LastEnd.NO_SIGNAL,
        "target_rejected" to LastEnd.DESTINATION_REFUSED,
        "max_duration" to LastEnd.MAX_DURATION,
        "phone_lost" to LastEnd.PHONE_LOST,
        "failed" to LastEnd.ENDED_BY_SEAZN,
        "new_word" to LastEnd.STOPPED,
      )
    for ((said, line) in table) {
      val rig = MachineRig().live()
      rig.hear("over", sid = "sess_42", endReason = said)
      assertEquals(line, paired(rig).lastEnd, said)
    }
  }

  @Test fun `over N changes nothing, paired or held`() {
    val cases =
      sweep(everyPhase) { name, rig ->
        val before = column(beatDue(rig))
        rig.hear("over", sid = "sess_43", endReason = "stopped")
        assertEquals(before, column(rig.phase), name)
        assertEquals(null, rig.phase.pairing!!.lastEnd, name)
        assertTrue(rig.sent<Command.StopBroadcast>().isEmpty(), name)
      }
    assertEquals(5, cases)
  }

  // replaced and taken
  @Test fun `replaced while paired - Idle, unpaired replaced`() {
    val rig = MachineRig().paired()
    rig.hear("replaced")
    assertEquals(UnpairReason.REPLACED, idle(rig).unpaired?.reason)
  }

  @Test fun `replaced on air ends S at once, then unpairs`() {
    val rig = MachineRig().live()
    val commands = rig.hear("replaced")
    assertEquals(UnpairReason.REPLACED, idle(rig).unpaired?.reason)
    assertEquals(listOf(Command.StopBroadcast, Command.Release), commands.filter { it == Command.StopBroadcast || it == Command.Release })
  }

  @Test fun `replaced while Arming or Armed - Idle, unpaired replaced, nothing to stop`() {
    val arming = MachineRig().paired()
    arming.codes = null
    arming.hear("go-live", sid = "sess_42")
    arming.hear("replaced")
    assertEquals(UnpairReason.REPLACED, idle(arming).unpaired?.reason)
    val armed = MachineRig().armed()
    armed.hear("replaced")
    assertEquals(UnpairReason.REPLACED, idle(armed).unpaired?.reason)
    assertTrue(armed.sent<Command.StopBroadcast>().isEmpty())
  }

  @Test fun `taken while paired - Idle, unpaired taken - and ignored while held`() {
    val paired = MachineRig().paired()
    paired.hear("taken")
    assertEquals(UnpairReason.TAKEN, idle(paired).unpaired?.reason)
    val cases =
      sweep(held) { name, rig ->
        val before = column(beatDue(rig))
        rig.hear("taken")
        assertEquals(before, column(rig.phase), name)
        assertEquals("sess_42", rig.phase.heldSid, name)
      }
    assertEquals(4, cases)
  }

  // 401
  @Test fun `401 while paired - Idle, unpaired code-ended`() {
    val rig = MachineRig().paired()
    rig.hear(null, status = 401)
    assertEquals(UnpairReason.CODE_ENDED, idle(rig).unpaired?.reason)
  }

  @Test fun `401 while Arming - the same`() {
    val rig = MachineRig().paired()
    rig.codes = null
    rig.hear("go-live", sid = "sess_42")
    rig.hear(null, status = 401)
    assertEquals(UnpairReason.CODE_ENDED, idle(rig).unpaired?.reason)
  }

  @Test fun `the 401 deferral - expiry never ends a broadcast, and the pairing ends with it`() {
    val rig = MachineRig().live()
    rig.hear(null, status = 401)
    assertIs<Phase.OnAir>(rig.phase)
    assertTrue(rig.phase.pairing!!.codeEndedPending)
    rig.hear("over", sid = "sess_42", endReason = "stopped")
    assertEquals(UnpairReason.CODE_ENDED, idle(rig).unpaired?.reason)
  }

  @Test fun `the 401 deferral while Armed - held until S is over, then code-ended`() {
    val rig = MachineRig().armed()
    rig.hear(null, status = 401)
    assertIs<Phase.Armed>(rig.phase)
    assertTrue(rig.phase.pairing!!.codeEndedPending)
    rig.hear("over", sid = "sess_42", endReason = "stopped")
    assertEquals(UnpairReason.CODE_ENDED, idle(rig).unpaired?.reason)
  }

  @Test fun `a 401 on a reconnect's code fetch - the broadcast runs on, and when it ends the pairing ends, code-ended`() {
    val rig = MachineRig().live()
    rig.codes = { CodeAnswer.Status(401, null, null) }
    rig.send(Input.Dropped(rig.attempt!!, DropReason.ENDPOINT_CLOSED, null))
    assertEquals(2, rig.sent<Command.FetchCode>().size, "the reconnect fetched the code")
    assertEquals("sess_42", rig.phase.heldSid)
    assertTrue(rig.phase.pairing!!.codeEndedPending)
    assertTrue(rig.sent<Command.StopBroadcast>().isEmpty())
    rig.codes = null
    rig.hear("over", sid = "sess_42", endReason = "stopped")
    assertEquals(UnpairReason.CODE_ENDED, idle(rig).unpaired?.reason)
  }

  // 426 app_outdated (court device check, 2026-11-19, web #1265): a court claim from a build below the server's court
  // minimum. The build can never pair that code, so it leaves the pairing with its own reason, which Home names.
  @Test fun `426 on the claim while paired - Idle, unpaired app-outdated, the service released`() {
    val rig = MachineRig().paired()
    rig.hear(null, status = 426)
    assertEquals(UnpairReason.APP_OUTDATED, idle(rig).unpaired?.reason)
    assertEquals(1, rig.sent<Command.Release>().size)
    assertEquals(listOf<Any?>(UnpairReason.APP_OUTDATED), rig.records("unpaired").map { it.field("reason") })
  }

  @Test fun `426 while Arming, a resume claim's answer - the same`() {
    val rig = arming()
    rig.hear(null, status = 426)
    assertEquals(UnpairReason.APP_OUTDATED, idle(rig).unpaired?.reason)
  }

  @Test fun `a 426 from Armed on is counted and changes nothing else - the broadcast runs on`() {
    val cases =
      sweep(held.drop(1)) { name, rig ->
        val before = beatDue(rig)
        val failures = before.pairing!!.heartbeat.failures
        rig.hear(null, status = 426)
        assertEquals(column(before), column(rig.phase), name)
        assertEquals(before.heldSid, rig.phase.heldSid, name)
        assertEquals(failures + 1, rig.phase.pairing!!.heartbeat.failures, name)
        assertTrue(rig.sent<Command.StopBroadcast>().isEmpty(), name)
      }
    assertEquals(3, cases)
  }

  // Review M1: only a 2xx clears the claim (SessionMachine.answered), so a claim whose answer was lost reaches Armed with
  // the operator's start and rides every held beat. The server answers each 426; each is counted, and nothing stops.
  @Test fun `a claim carried into Armed is answered 426 on every beat - counted, nothing stops, the broadcast untouched`() {
    val rig = MachineRig().paired()
    beatDue(rig)
    val lost = rig.phase.beating!!.heartbeat.inFlightId!!
    rig.send(Input.HeartbeatAnswered(lost, HeartbeatResponse.Failed("timeout")))
    assertEquals(Claim.NEW, paired(rig).claim, "a lost answer keeps the claim")
    rig.ready()
    rig.starts = { StartAnswer.Started("sess_42") }
    rig.send(Input.Start)
    assertTrue(column(rig.phase) in setOf("Armed", "Connecting"), column(rig.phase))
    rig.send(Input.Connected(rig.attempt!!))
    rig.advance(1_000)
    assertIs<Phase.OnAir>(rig.phase)
    repeat(3) { at ->
      val before = beatDue(rig)
      val failures = before.pairing!!.heartbeat.failures
      val body = org.json.JSONObject(rig.sent<Command.PostHeartbeat>().last().body)
      assertEquals("new", body.getString("claim"), "beat $at carries the claim")
      rig.hear(null, status = 426)
      assertIs<Phase.OnAir>(rig.phase, "beat $at")
      assertEquals("sess_42", rig.phase.heldSid, "beat $at")
      assertEquals(failures + 1, rig.phase.pairing!!.heartbeat.failures, "beat $at")
      assertEquals(Claim.NEW, rig.phase.pairing!!.claim, "beat $at")
    }
    assertTrue(rig.sent<Command.StopBroadcast>().isEmpty())
    assertTrue(rig.records("unpaired").isEmpty())
  }

  @Test fun `after a 426 the same code paired again claims again, and the server's second 426 unpairs it again`() {
    val rig = MachineRig().paired()
    rig.hear(null, status = 426)
    idle(rig)
    rig.paired()
    assertIs<Phase.Paired>(rig.phase)
    val claim = org.json.JSONObject(rig.sent<Command.PostHeartbeat>().last().body)
    assertEquals("new", claim.getString("claim"))
    rig.hear(null, status = 426)
    assertEquals(UnpairReason.APP_OUTDATED, idle(rig).unpaired?.reason)
    assertEquals(2, rig.records("unpaired").size)
  }

  @Test fun `A17 a 426 keeps a held stopped record - the code has not ended, and the updated app delivers it`() {
    val record = StoppedRecord.of(Configs.pairRequest().name, "sess_41", 1_790_000_000_000, null)
    val rig = MachineRig()
    rig.send(Input.Pair(Configs.pairRequest(), Configs.PHONE, record))
    rig.send(Input.Network(true))
    rig.hear(null, status = 426)
    assertEquals(UnpairReason.APP_OUTDATED, idle(rig).unpaired?.reason)
    assertTrue(rig.sent<Command.DeleteStopped>().isEmpty(), "${rig.sent<Command.DeleteStopped>()}")
  }

  // a beat's 410, defensively
  @Test fun `a beat's 410 naming S - Paired, stopped, and S is ended first from connecting or on air`() {
    val stops = mapOf("Arming" to 0, "Armed" to 0, "Connecting" to 1, "on air" to 1)
    val cases =
      sweep(held) { name, rig ->
        rig.hear(null, status = 410)
        assertEquals(LastEnd.STOPPED, paired(rig).lastEnd, name)
        assertEquals(stops.getValue(name), rig.sent<Command.StopBroadcast>().size, name)
      }
    assertEquals(4, cases)
  }

  @Test fun `a beat's 410 while paired, naming no sid, changes nothing`() {
    val rig = MachineRig().paired()
    rig.hear(null, status = 410)
    assertEquals(null, paired(rig).lastEnd)
  }

  // 404, 429, 5xx, none
  @Test fun `I2 a beat's 404 at Arming fails the start - Paired, not-found, S refused`() {
    val rig = arming()
    rig.hear(null, status = 404)
    val pairing = paired(rig)
    assertEquals(StartFailure.NOT_FOUND, pairing.startFailed)
    assertEquals(Refusal.START_FAILED, pairing.refusal)
    assertTrue("sess_42" in pairing.refused)
  }

  @Test fun `a beat's 404 while paired, Armed, connecting or on air is counted, and changes nothing else`() {
    val cases =
      sweep(pairedOnly + held.drop(1)) { name, rig ->
        val before = beatDue(rig)
        val failures = before.pairing!!.heartbeat.failures
        rig.hear(null, status = 404)
        assertEquals(column(before), column(rig.phase), name)
        assertEquals(before.heldSid, rig.phase.heldSid, name)
        assertEquals(failures + 1, rig.phase.pairing!!.heartbeat.failures, name)
      }
    assertEquals(4, cases)
  }

  @Test fun `429, 5xx and no answer are counted in every phase`() {
    val cases =
      sweep(everyPhase) { name, rig ->
        val before = beatDue(rig)
        val failures = before.pairing!!.heartbeat.failures
        rig.hear(null, status = 503)
        rig.hear(null, status = 429)
        beatDue(rig)
        rig.send(Input.HeartbeatAnswered(rig.phase.beating!!.heartbeat.inFlightId!!, HeartbeatResponse.Failed("timeout")))
        assertEquals(column(before), column(rig.phase), name)
        assertEquals(before.heldSid, rig.phase.heldSid, name)
        assertEquals(failures + 3, rig.phase.pairing!!.heartbeat.failures, name)
      }
    assertEquals(5, cases)
  }

  // the code's answer
  @Test fun `the code's 410 or over state at Arming - Paired, the line for its endReason`() {
    val table =
      listOf(
        CodeAnswer.Status(410, null, "stopped") to LastEnd.STOPPED_BY_ORGANISER,
        CodeAnswer.Status(410, null, null) to LastEnd.STOPPED,
        CodeAnswer.Over("sess_42", "stopped") to LastEnd.STOPPED_BY_ORGANISER,
        CodeAnswer.Over("sess_42", "max_duration") to LastEnd.MAX_DURATION,
      )
    for ((answer, line) in table) {
      val rig = MachineRig().paired()
      rig.codes = { answer }
      rig.hear("go-live", sid = "sess_42")
      assertEquals(line, paired(rig).lastEnd, "$answer")
      assertTrue("sess_42" !in paired(rig).refused, "$answer")
    }
    assertEquals(4, table.size)
  }

  @Test fun `the code's over state on a reconnect - end S, Paired`() {
    val rig = MachineRig().live()
    rig.codes = { CodeAnswer.Over("sess_42", "max_duration") }
    rig.send(Input.Dropped(rig.attempt!!, DropReason.ENDPOINT_CLOSED, null))
    assertEquals(LastEnd.MAX_DURATION, paired(rig).lastEnd)
  }

  @Test fun `M8 a reconnect's code answer naming N with no cred - S is over, end it, Paired, stopped`() {
    val rig = MachineRig().live()
    rig.codes = { CodeAnswer.NotCurrent("sess_43") }
    rig.send(Input.Dropped(rig.attempt!!, DropReason.ENDPOINT_CLOSED, null))
    assertEquals(LastEnd.STOPPED, paired(rig).lastEnd)
  }

  @Test fun `a waiting-shaped code at Arming is NoBroadcast - Paired, stopped, S not refused`() {
    val rig = MachineRig().paired()
    rig.codes = { CodeAnswer.Waiting(Configs.waiting()) }
    rig.hear("go-live", sid = "sess_42")
    assertEquals(LastEnd.STOPPED, paired(rig).lastEnd)
    assertTrue("sess_42" !in paired(rig).refused)
  }

  // refused and stopped sids
  /** Paired with sess_42 refused (the code's 404 at Arming), then brought to [column] holding sess_43. */
  private fun refusedThen(column: String): MachineRig {
    val rig = MachineRig().paired()
    rig.codes = { CodeAnswer.Status(404, null, null) }
    rig.hear("go-live", sid = "sess_42")
    assertTrue("sess_42" in paired(rig).refused)
    if (column == "Paired") return rig
    rig.codes = if (column == "Arming") null else ({ if (rig.phase is Phase.Arming) Configs.open(sid = "sess_43") else null })
    rig.hear("go-live", sid = "sess_43")
    if (column == "Arming" || column == "Armed") return rig
    rig.ready()
    if (column == "Connecting") return rig
    rig.send(Input.Connected(rig.attempt!!))
    rig.advance(1_000)
    return rig
  }

  @Test fun `a go-live or live naming a refused sid is ignored in every phase`() {
    var cases = 0
    for (name in listOf("Paired", "Arming", "Armed", "Connecting", "on air")) {
      for (word in listOf("go-live", "live")) {
        val rig = refusedThen(name)
        assertEquals(name, column(rig.phase), "set-up for $name")
        val held = rig.phase.heldSid
        val fetches = rig.sent<Command.FetchCode>().size
        beatDue(rig)
        rig.hear(word, sid = "sess_42")
        assertEquals(name, column(rig.phase), "$word $name")
        assertEquals(held, rig.phase.heldSid, "$word $name")
        assertEquals(fetches, rig.sent<Command.FetchCode>().size, "$word $name")
        assertTrue(rig.sent<Command.StopBroadcast>().isEmpty(), "$word $name")
        cases++
      }
    }
    assertEquals(10, cases)
  }

  // hold window
  // N37 (the owner's ruling, 2026-10-13): the phone ended S itself, so the server's live for S is ignored.
  @Test fun `a hold that runs out returns to Paired, hold-window-expired, and live S is ignored - never rejoined`() {
    val rig = MachineRig(descriptor = Configs.descriptor()).live()
    rig.send(Input.Dropped(rig.attempt!!, DropReason.ENDPOINT_CLOSED, null))
    rig.advance(184_000, feeding = false)
    assertEquals(LastEnd.HOLD_WINDOW_EXPIRED, paired(rig).lastEnd)
    rig.codes = null
    rig.hear("live", sid = "sess_42")
    assertEquals(LastEnd.HOLD_WINDOW_EXPIRED, paired(rig).lastEnd)
    assertEquals("sess_42", rig.records("open-ignored").single().field("sid"))
  }

  @Test fun `the waiting fields and pollSeconds refresh on every 2xx, in every phase`() {
    val cases =
      sweep(everyPhase) { name, rig ->
        val before = column(beatDue(rig))
        // A word that keeps each phase as it is: waiting while paired, a confirmation while held.
        rig.hear(if (name == "Paired") "waiting" else "live", sid = rig.phase.heldSid, pollSeconds = 60)
        assertEquals(before, column(rig.phase), name)
        assertEquals(Configs.waiting(pollSeconds = 60), rig.phase.pairing!!.waiting, name)
      }
    assertEquals(5, cases)
  }
}
