package com.seazn.capture.engine.core

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertIs
import kotlin.test.assertTrue

class AnswerTableTest {
  private fun idle(rig: MachineRig) = assertIs<Phase.Idle>(rig.phase)

  private fun paired(rig: MachineRig) = assertIs<Phase.Paired>(rig.phase).pairing

  // waiting
  @Test fun `waiting while paired changes nothing`() {
    val rig = MachineRig().paired()
    rig.hear("waiting")
    assertIs<Phase.Paired>(rig.phase)
  }

  @Test fun `waiting while Arming or Armed - S is over, back to Paired, stopped`() {
    val rig = MachineRig().armed()
    rig.hear("waiting")
    assertEquals(LastEnd.STOPPED, paired(rig).lastEnd)
    assertTrue(rig.sent<Command.StopBroadcast>().isEmpty())
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
    for (setUp in listOf<(MachineRig) -> Unit>({ it.armed() }, { it.live() })) {
      val rig = MachineRig()
      setUp(rig)
      val before = rig.phase::class
      rig.hear("live", sid = "sess_42")
      assertEquals(before, rig.phase::class)
    }
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
    val rig = MachineRig().live()
    rig.hear("over", sid = "sess_43", endReason = "stopped")
    assertIs<Phase.OnAir>(rig.phase)
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
    val held = MachineRig().armed()
    held.hear("taken")
    assertIs<Phase.Armed>(held.phase)
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

  // a beat's 410, defensively
  @Test fun `a beat's 410 naming S - end S, Paired, stopped`() {
    val rig = MachineRig().live()
    rig.hear(null, status = 410)
    assertEquals(LastEnd.STOPPED, paired(rig).lastEnd)
  }

  // 404, 429, 5xx, none
  @Test fun `404 on a beat while Armed or on air is counted`() {
    val rig = MachineRig().live()
    rig.hear(null, status = 404)
    assertIs<Phase.OnAir>(rig.phase)
  }

  @Test fun `429, 5xx and no answer are counted in every phase`() {
    val rig = MachineRig().live()
    rig.hear(null, status = 503)
    rig.hear(null, status = 429)
    assertIs<Phase.OnAir>(rig.phase)
    assertEquals(2, rig.phase.pairing!!.heartbeat.failures)
  }

  // the code's answer
  @Test fun `the code's 410 or over state at Arming - Paired, the line for its endReason`() {
    val rig = MachineRig().paired()
    rig.codes = { CodeAnswer.Status(410, null, "stopped") }
    rig.hear("go-live", sid = "sess_42")
    assertEquals(LastEnd.STOPPED_BY_ORGANISER, paired(rig).lastEnd)
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
  @Test fun `a go-live or live naming a refused sid is ignored in every phase`() {
    val rig = MachineRig().paired()
    rig.codes = { CodeAnswer.Status(404, null, null) }
    rig.hear("go-live", sid = "sess_42")
    rig.codes = null
    rig.hear("go-live", sid = "sess_42")
    rig.hear("live", sid = "sess_42")
    assertIs<Phase.Paired>(rig.phase)
    assertEquals(1, rig.sent<Command.FetchCode>().size)
  }

  // hold window
  @Test fun `a hold that runs out returns to Paired, hold-window-expired, and live S rejoins`() {
    val rig = MachineRig(descriptor = Configs.descriptor()).live()
    rig.send(Input.Dropped(rig.attempt!!, DropReason.ENDPOINT_CLOSED, null))
    rig.advance(184_000, feeding = false)
    assertEquals(LastEnd.HOLD_WINDOW_EXPIRED, paired(rig).lastEnd)
    rig.codes = null
    rig.hear("live", sid = "sess_42")
    assertEquals(Cause.REJOIN, assertIs<Phase.Arming>(rig.phase).cause)
  }

  @Test fun `the waiting fields and pollSeconds refresh on every 2xx, in every phase`() {
    val rig = MachineRig().live()
    rig.hear("live", sid = "sess_42", pollSeconds = 60)
    assertEquals(60, rig.phase.pairing!!.waiting.pollSeconds)
  }
}
