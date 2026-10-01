package com.seazn.capture.engine.core

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertIs
import kotlin.test.assertNull
import kotlin.test.assertTrue

class StartTest {
  private fun paired(rig: MachineRig) = assertIs<Phase.Paired>(rig.phase).pairing

  private fun ready(): MachineRig {
    val rig = MachineRig().paired()
    rig.hear("waiting")
    rig.ready()
    return rig
  }

  @Test fun `the hold posts start with the phone's id when paired and ready`() {
    val rig = ready()
    rig.send(Input.Start)
    val post = rig.sent<Command.PostStart>().single()
    assertEquals("""{"phone":"${Configs.PHONE_ID}"}""", post.body)
    assertEquals(Configs.pairRequest().startUrl, post.url)
  }

  @Test fun `A11 the hold is ignored when not ready, and a second hold while one is in flight is one post`() {
    val rig = MachineRig().paired()
    rig.send(Input.Start)
    assertTrue(rig.sent<Command.PostStart>().isEmpty())
    rig.ready()
    rig.send(Input.Start)
    rig.send(Input.Start)
    assertEquals(1, rig.sent<Command.PostStart>().size)
  }

  @Test fun `start 200 arms its sid, cause operator`() {
    val rig = ready()
    rig.codes = null
    rig.starts = { StartAnswer.Started("sess_42") }
    rig.send(Input.Start)
    val arming = assertIs<Phase.Arming>(rig.phase)
    assertEquals(Cause.OPERATOR, arming.cause)
  }

  @Test fun `409 already_live arms its sid, with its startedBy`() {
    val rig = ready()
    rig.codes = null
    rig.starts = { StartAnswer.AlreadyLive("sess_42", "organiser") }
    rig.send(Input.Start)
    assertEquals(Cause.ORGANISER, assertIs<Phase.Arming>(rig.phase).cause)
  }

  @Test fun `each refusal stays paired with its line`() {
    for (refusal in listOf(Refusal.NO_DESTINATION, Refusal.NO_CREDIT, Refusal.NOT_ENTITLED, Refusal.UNKNOWN)) {
      val rig = ready()
      rig.starts = { StartAnswer.Refused(refusal) }
      rig.send(Input.Start)
      assertEquals(refusal, paired(rig).refusal, "$refusal")
    }
  }

  @Test fun `no answer, 404, 429 or 5xx stays paired, start-error, and is never retried on its own`() {
    val rig = ready()
    rig.starts = { StartAnswer.Failed("503") }
    rig.send(Input.Start)
    assertEquals(Refusal.START_FAILED, paired(rig).refusal)
    assertEquals(StartFailure.START_ERROR, paired(rig).startFailed)
    rig.advance(60_000)
    assertEquals(1, rig.sent<Command.PostStart>().size)
  }

  @Test fun `409 replaced unpairs as a beat's replaced`() {
    val rig = ready()
    rig.starts = { StartAnswer.Replaced }
    rig.send(Input.Start)
    assertEquals(UnpairReason.REPLACED, assertIs<Phase.Idle>(rig.phase).unpaired?.reason)
  }

  @Test fun `a late start answer naming S moves nothing, and any other shows no refusal`() {
    val rig = ready()
    rig.codes = null
    rig.send(Input.Start)
    val post = rig.sent<Command.PostStart>().single()
    rig.hear("go-live", sid = "sess_42")
    rig.send(Input.StartAnswered(post.requestId, StartAnswer.Refused(Refusal.NO_CREDIT)))
    val arming = assertIs<Phase.Arming>(rig.phase)
    assertNull(arming.pairing.refusal)
  }

  @Test fun `the descriptor unreachable stays Arming, retrying, spaced 10 s apart`() {
    val rig = MachineRig().paired()
    rig.codes = { CodeAnswer.Unreachable("dns") }
    rig.hear("go-live", sid = "sess_42")
    assertTrue(assertIs<Phase.Arming>(rig.phase).retrying)
    rig.advance(9_500)
    assertEquals(1, rig.sent<Command.FetchCode>().size)
    rig.advance(500)
    assertEquals(2, rig.sent<Command.FetchCode>().size)
  }

  @Test fun `the descriptor 429 waits its Retry-After, clamped to 300 s`() {
    val rig = MachineRig().paired()
    rig.codes = { CodeAnswer.Status(429, 900, null) }
    rig.hear("go-live", sid = "sess_42")
    rig.advance(299_500)
    assertEquals(1, rig.sent<Command.FetchCode>().size)
    rig.advance(500)
    assertEquals(2, rig.sent<Command.FetchCode>().size)
  }

  @Test fun `the descriptor 401 - Idle, code-ended`() {
    val rig = MachineRig().paired()
    rig.codes = { CodeAnswer.Status(401, null, null) }
    rig.hear("go-live", sid = "sess_42")
    assertEquals(UnpairReason.CODE_ENDED, assertIs<Phase.Idle>(rig.phase).unpaired?.reason)
  }

  @Test fun `404, a foreign cred host and a bad config each refuse S, with their startFailed`() {
    val rows =
      listOf(
        CodeAnswer.Status(404, null, null) to StartFailure.NOT_FOUND,
        CodeAnswer.ForeignIngest("sess_42") to StartFailure.CRED_HOST,
        Configs.open(descriptor = Configs.descriptor(primary = SrtTarget("srt://live.stg.seazn.club:778", "", Configs.PASSPHRASE, 2_000))) to StartFailure.CONFIG,
        CodeAnswer.Unreadable("cred.rtmps") to StartFailure.CONFIG,
      )
    for ((answer, failure) in rows) {
      val rig = MachineRig().paired()
      rig.codes = { answer }
      rig.hear("go-live", sid = "sess_42")
      val pairing = paired(rig)
      assertEquals(failure, pairing.startFailed, "$answer")
      assertEquals(Refusal.START_FAILED, pairing.refusal)
      assertTrue("sess_42" in pairing.refused)
    }
  }

  @Test fun `a foreign cred host writes a cred-host-refused line`() {
    val rig = MachineRig().paired()
    rig.codes = { CodeAnswer.ForeignIngest("sess_42") }
    rig.hear("go-live", sid = "sess_42")
    assertEquals("sess_42", rig.records("cred-host-refused").single().field("sid"))
  }

  @Test fun `a refused sid is not retried from beats, and a new sid starts again`() {
    val rig = MachineRig().paired()
    rig.codes = { CodeAnswer.Status(404, null, null) }
    rig.hear("go-live", sid = "sess_42")
    rig.hear("go-live", sid = "sess_42")
    assertEquals(1, rig.sent<Command.FetchCode>().size)
    rig.codes = null
    rig.hear("go-live", sid = "sess_43")
    assertEquals("sess_43", assertIs<Phase.Arming>(rig.phase).sid)
  }

  @Test fun `the start-failed line shows until the next start of any cause`() {
    val rig = MachineRig().paired()
    rig.codes = { CodeAnswer.Status(404, null, null) }
    rig.hear("go-live", sid = "sess_42")
    rig.codes = null
    rig.hear("go-live", sid = "sess_43")
    assertNull(assertIs<Phase.Arming>(rig.phase).pairing.startFailed)
  }

  @Test fun `G0-d no cred - stay Arming, claim resume at once, fetch again when the claim names S`() {
    val rig = MachineRig().paired()
    rig.hear("waiting")
    rig.codes = { CodeAnswer.NotCurrent("sess_42") }
    rig.hear("go-live", sid = "sess_42")
    val arming = assertIs<Phase.Arming>(rig.phase)
    assertTrue(arming.notCurrent)
    assertEquals("resume", Configs.body(rig.sent<Command.PostHeartbeat>().last()).getString("claim"))
    rig.codes = null
    rig.advance(30_000)
    assertEquals(1, rig.sent<Command.FetchCode>().size)
    rig.hear("go-live", sid = "sess_42")
    assertEquals(2, rig.sent<Command.FetchCode>().size)
  }

  @Test fun `G0-d once the claim names S the phone is current - a later beat for S fetches nothing more`() {
    val rig = MachineRig().paired()
    rig.codes = { CodeAnswer.NotCurrent("sess_42") }
    rig.hear("go-live", sid = "sess_42")
    rig.codes = null
    rig.hear("go-live", sid = "sess_42")
    assertEquals(2, rig.sent<Command.FetchCode>().size, "fetched again once, when the claim named S")
    assertTrue(!assertIs<Phase.Arming>(rig.phase).notCurrent)
    rig.hear("live", sid = "sess_42")
    assertEquals(2, rig.sent<Command.FetchCode>().size, "a confirmation, not a second claim")
  }

  @Test fun `a POST start answer naming a refused sid starts nothing`() {
    val answers = listOf(StartAnswer.Started("sess_42"), StartAnswer.AlreadyLive("sess_42", "organiser"))
    for (answer in answers) {
      val rig = MachineRig().paired()
      rig.codes = { CodeAnswer.Status(404, null, null) }
      rig.hear("go-live", sid = "sess_42")
      assertTrue("sess_42" in paired(rig).refused, "$answer")
      rig.ready()
      rig.starts = { answer }
      rig.send(Input.Start)
      assertEquals(1, rig.sent<Command.PostStart>().size, "$answer")
      assertIs<Phase.Paired>(rig.phase, "$answer")
      assertEquals(1, rig.sent<Command.FetchCode>().size, "$answer")
    }
  }

  @Test fun `I3 in Paired a release or reopen with no take does nothing, and a second take is one`() {
    val rig = MachineRig().paired()
    assertEquals(emptyList(), rig.send(Input.CameraReleased))
    assertEquals(emptyList(), rig.send(Input.CameraReopened(ok = true)))
    assertEquals(CameraState.OWN, paired(rig).camera)
    rig.send(Input.CameraContended)
    assertEquals(emptyList(), rig.send(Input.CameraContended))
    assertEquals(1, rig.records("camera-taken").size)
    rig.send(Input.CameraReleased)
    assertEquals(emptyList(), rig.send(Input.CameraReleased), "released once")
    assertEquals(listOf(Command.ReopenCamera), rig.sent<Command.ReopenCamera>())
  }

  @Test fun `M8 no cred naming N while Arming S - S is over, Paired, and no claim loop for S`() {
    val rig = MachineRig().paired()
    rig.codes = { CodeAnswer.NotCurrent("sess_43") }
    rig.hear("go-live", sid = "sess_42")
    assertEquals(LastEnd.STOPPED, paired(rig).lastEnd)
    assertTrue(rig.records("not-current").isEmpty())
  }

  @Test fun `G0-d no cred, then replaced - unpairs as usual`() {
    val rig = MachineRig().paired()
    rig.codes = { CodeAnswer.NotCurrent("sess_42") }
    rig.hear("go-live", sid = "sess_42")
    rig.hear("replaced")
    assertEquals(UnpairReason.REPLACED, assertIs<Phase.Idle>(rig.phase).unpaired?.reason)
  }

  @Test fun `A18 RTMPS alone plans no fallback, and its hold window ends it as before`() {
    val rig = MachineRig(descriptor = Configs.descriptor(primary = Configs.rtmps, fallback = null)).armed()
    val session = assertIs<Phase.Armed>(rig.phase).session
    assertNull(session.config.fallback)
    assertEquals(false, session.broadcast.srtOffered)
  }

  @Test fun `a camera taken while Armed puts up no slate - nothing is on air`() {
    val rig = MachineRig().armed()
    val commands = rig.send(Input.CameraContended)
    assertTrue(commands.none { it is Command.Slate })
  }

  @Test fun `I3 a camera taken while paired stays taken into the broadcast - not ready, camera - and it connects once back`() {
    val rig = MachineRig().paired()
    rig.ready()
    rig.send(Input.CameraContended)
    assertEquals(CameraState.TAKEN, paired(rig).camera)
    rig.send(Input.Start)
    assertTrue(rig.sent<Command.PostStart>().isEmpty(), "the hold waits for the camera")
    rig.hear("go-live", sid = "sess_42")
    assertEquals(CameraState.TAKEN, assertIs<Phase.Armed>(rig.phase).session.camera)
    rig.advance(10_000)
    assertEquals("camera", Configs.body(rig.sent<Command.PostHeartbeat>().last()).getString("notReady"))
    assertTrue(rig.sent<Command.Connect>().isEmpty())
    rig.send(Input.CameraReleased)
    rig.send(Input.CameraReopened(ok = true))
    assertIs<Phase.Connecting>(rig.phase)
    assertTrue(rig.sent<Command.Slate>().isEmpty(), "nothing was on air to cover")
  }

  @Test fun `I3 a broadcast that ends with the camera taken hands it back to the pairing`() {
    val rig = MachineRig().armed()
    rig.send(Input.CameraContended)
    rig.hear("over", sid = "sess_42", endReason = "stopped")
    assertEquals(CameraState.TAKEN, paired(rig).camera)
    rig.send(Input.CameraReleased)
    assertEquals(listOf(Command.ReopenCamera), rig.sent<Command.ReopenCamera>())
  }
}
