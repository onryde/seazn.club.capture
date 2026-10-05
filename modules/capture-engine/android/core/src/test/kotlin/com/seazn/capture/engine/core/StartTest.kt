package com.seazn.capture.engine.core

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertIs
import kotlin.test.assertNotNull
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

  @Test fun `401 code_ended forgets the code, as a beat's 401 does - Idle, code-ended, the service released`() {
    val rig = ready()
    rig.starts = { StartAnswer.CodeEnded }
    rig.send(Input.Start)
    assertEquals(UnpairReason.CODE_ENDED, assertIs<Phase.Idle>(rig.phase).unpaired?.reason)
    assertEquals(1, rig.sent<Command.Release>().size)
    assertTrue(rig.sent<Command.DeleteStopped>().isEmpty(), "no stopped record was held")
    val noted = rig.records("start-answered").single()
    assertEquals("CodeEnded", noted.field("answer"))
    assertTrue(noted.fields.none { it.first == "late" }, "the answer in flight is not late: $noted")
  }

  @Test fun `A17 401 code_ended on the start deletes a held stopped record, once`() {
    val record = StoppedRecord.of(Configs.pairRequest().name, "sess_41", 1_790_000_000_000, null)
    val rig = MachineRig()
    rig.send(Input.Pair(Configs.pairRequest(), Configs.PHONE, record))
    rig.send(Input.Network(true))
    rig.hear(null, status = 503)
    rig.ready()
    rig.starts = { StartAnswer.CodeEnded }
    rig.send(Input.Start)
    assertEquals(UnpairReason.CODE_ENDED, assertIs<Phase.Idle>(rig.phase).unpaired?.reason)
    assertEquals(listOf(Command.DeleteStopped("fx42hmnp7k2q", 1)), rig.sent<Command.DeleteStopped>())
  }

  @Test fun `C0b a 401 to a start the console's go-live overtook - the broadcast runs on, and the code goes when it ends`() {
    val (rig, id) = raced()
    rig.send(Input.CodeAnswered(rig.sent<Command.FetchCode>().last().requestId, Configs.open()))
    rig.send(Input.Connected(rig.attempt!!))
    rig.advance(1_000)
    assertIs<Phase.OnAir>(rig.phase)
    val commands = rig.send(Input.StartAnswered(id, StartAnswer.CodeEnded))
    assertIs<Phase.OnAir>(rig.phase)
    assertTrue(commands.none { it == Command.StopBroadcast || it == Command.Release }, "$commands")
    assertTrue(rig.phase.pairing!!.codeEndedPending)
    assertEquals(true, rig.records("start-answered").last().field("late"))
    rig.hear("over", sid = "sess_42", endReason = "stopped")
    assertEquals(UnpairReason.CODE_ENDED, assertIs<Phase.Idle>(rig.phase).unpaired?.reason)
  }

  @Test fun `A17 a late 401 while S is held finds the record already delivered by the go-live that armed S - deleted once, never again`() {
    val record = StoppedRecord.of(Configs.pairRequest().name, "sess_41", 1_790_000_000_000, null)
    val rig = MachineRig()
    rig.send(Input.Pair(Configs.pairRequest(), Configs.PHONE, record))
    rig.send(Input.Network(true))
    rig.hear(null, status = 503)
    rig.ready()
    rig.codes = null
    rig.send(Input.Start)
    val id = rig.sent<Command.PostStart>().single().requestId
    // The go-live that overtakes the start answers a Paired beat, which carried the record (RR3): its 2xx delivers it.
    rig.hear("go-live", sid = "sess_42")
    assertEquals(listOf(Command.DeleteStopped("fx42hmnp7k2q", 1)), rig.sent<Command.DeleteStopped>())
    rig.send(Input.CodeAnswered(rig.sent<Command.FetchCode>().last().requestId, Configs.open()))
    assertTrue(rig.phase.holdsBroadcast, rig.phase.name)
    rig.send(Input.StartAnswered(id, StartAnswer.CodeEnded))
    assertTrue(rig.phase.pairing!!.codeEndedPending)
    assertNull(rig.phase.pairing!!.stopped)
    assertEquals(1, rig.sent<Command.DeleteStopped>().size)
    // The broadcast ends, and the pairing with it: the record is not deleted a second time.
    rig.hear("over", sid = "sess_42", endReason = "stopped")
    assertEquals(UnpairReason.CODE_ENDED, assertIs<Phase.Idle>(rig.phase).unpaired?.reason)
    assertEquals(1, rig.sent<Command.DeleteStopped>().size)
  }

  @Test fun `a 401 to a start that lands while Arming S forgets the code, as the answer table's 401 row says for Arming`() {
    val (rig, id) = raced()
    rig.send(Input.StartAnswered(id, StartAnswer.CodeEnded))
    assertEquals(UnpairReason.CODE_ENDED, assertIs<Phase.Idle>(rig.phase).unpaired?.reason)
  }

  // A late POST start answer: the hold's request was in flight and a beat's go-live arrived first.
  // "It never moves the engine and never shows a refusal" (amendment, the answer table).
  private val lateAnswers =
    listOf(
      StartAnswer.Started("sess_42"),
      StartAnswer.AlreadyLive("sess_42", "organiser"),
      StartAnswer.Refused(Refusal.NO_CREDIT),
      StartAnswer.Failed("503"),
    )

  /** Ready, the hold's POST start in flight, then the console's go-live S overtakes it: Arming S. */
  private fun raced(): Pair<MachineRig, Int> {
    val rig = ready()
    rig.codes = null
    rig.send(Input.Start)
    val post = rig.sent<Command.PostStart>().single()
    rig.hear("go-live", sid = "sess_42")
    assertIs<Phase.Arming>(rig.phase)
    return rig to post.requestId
  }

  @Test fun `a late start answer while Arming S - Started or AlreadyLive naming S, or any other - changes nothing`() {
    for (late in lateAnswers) {
      val (rig, id) = raced()
      val before = rig.phase
      val commands = rig.send(Input.StartAnswered(id, late))
      assertEquals(before, rig.phase, "$late")
      assertEquals(listOf("start-answered"), commands.map { (it as Command.Record).entry.kind }, "$late")
      assertEquals(true, rig.records("start-answered").single().field("late"), "$late")
    }
    assertEquals(4, lateAnswers.size)
  }

  @Test fun `I1 a late start answer after the broadcast it raced has ended moves nothing and shows no refusal`() {
    for (late in lateAnswers) {
      val (rig, id) = raced()
      rig.hear("waiting")
      assertEquals(LastEnd.STOPPED, paired(rig).lastEnd, "$late")
      val before = rig.phase
      rig.send(Input.StartAnswered(id, late))
      assertEquals(before, rig.phase, "$late")
      assertNull(paired(rig).refusal, "$late")
      assertEquals(1, rig.sent<Command.FetchCode>().size, "$late: no code fetched for a broadcast the server ended")
    }
  }

  @Test fun `a start answer that lands after a permanent failure ended the pairing moves nothing and shows no refusal`() {
    for (late in lateAnswers) {
      val rig = ready()
      rig.send(Input.Start)
      val post = rig.sent<Command.PostStart>().single()
      rig.send(Input.PlatformFailed(1, "no camera"))
      val ended = assertIs<Phase.Ended>(rig.phase)
      rig.send(Input.StartAnswered(post.requestId, late))
      assertIs<Phase.Ended>(rig.phase, "$late")
      assertNull(rig.snapshot.refusal, "$late")
      assertEquals(ended.pairing!!.starts.nextId, rig.phase.pairing!!.starts.nextId, "$late")
      assertTrue(rig.sent<Command.FetchCode>().isEmpty(), "$late")
    }
  }

  @Test fun `I1 once the raced broadcast ends the next hold posts at once, and the first hold's late answer never decides for it`() {
    val (rig, first) = raced()
    rig.hear("waiting")
    rig.send(Input.Start)
    val second = rig.sent<Command.PostStart>().last().requestId
    assertEquals(2, rig.sent<Command.PostStart>().size)
    rig.send(Input.StartAnswered(first, StartAnswer.Started("sess_42")))
    assertIs<Phase.Paired>(rig.phase)
    rig.send(Input.StartAnswered(second, StartAnswer.Refused(Refusal.NO_DESTINATION)))
    assertEquals(Refusal.NO_DESTINATION, paired(rig).refusal)
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
        Configs.open(descriptor = Configs.descriptor(primary = SrtTarget(Configs.srt.url, "", Configs.PASSPHRASE, 2_000))) to StartFailure.CONFIG,
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

  /**
   * Item 4 ruling (2026-10-05, server facts at stg da3297a33): a beat carrying `startFailed` is only recorded by the
   * server, which keeps S warming for up to 10 minutes and answers every Go live 409 already_live with it. So the
   * beat that carries `startFailed` for S also carries `stopped: S`, with sid and cause null (capture-beat.v1:
   * `stopped` "only while sid is null", `cause` null while sid is null), and the server ends S as operator_stopped
   * (T23), keeping the pairing. The stopped record's own path delivers it: written, carried, deleted on a 2xx.
   */
  /** The sid a start fails for: the session config's own. */
  private val failedSid = Configs.valid().sid

  /** Arms [sid] by the organiser's Go live, with the code fetch answered [code] (null leaves it unanswered). */
  private fun MachineRig.armWith(code: CodeAnswer?, sid: String = failedSid) {
    codes = { code }
    hear("go-live", sid = sid)
  }

  /** Each local start failure, as the rig reaches it: each row carries its own trigger. */
  private val startFailures: List<Pair<String, MachineRig.() -> Unit>> =
    listOf(
      "not-found (code 404)" to { armWith(CodeAnswer.Status(404, null, null)) },
      "cred-host" to { armWith(CodeAnswer.ForeignIngest(failedSid)) },
      "config (descriptor)" to { armWith(Configs.open(descriptor = Configs.descriptor(primary = SrtTarget(Configs.srt.url, "", Configs.PASSPHRASE, 2_000)))) },
      "config (unreadable)" to { armWith(CodeAnswer.Unreadable("cred.rtmps")) },
      "not-found (beat 404)" to {
        armWith(null)
        hear(null, status = 404)
      },
    )

  @Test fun `item 4 a local start failure beats startFailed and the stopped sid together, sid and cause null, at once`() {
    val seen = mutableSetOf<StartFailure>()
    for ((name, setup) in startFailures) {
      val rig = MachineRig().paired()
      rig.setup()
      val pairing = paired(rig)
      seen += assertNotNull(pairing.startFailed, name)
      val beat = Configs.body(rig.sent<Command.PostHeartbeat>().last())
      assertEquals("paired", beat.getString("state"), name)
      assertTrue(beat.isNull("sid") && beat.isNull("cause"), "$name: $beat")
      assertEquals(pairing.startFailed!!.wire, beat.getString("startFailed"), name)
      assertEquals(failedSid, beat.getString("stopped"), name)
      assertEquals(listOf(failedSid), rig.sent<Command.WriteStopped>().map { it.record.sid }, name)
      assertTrue(rig.phase.beating!!.heartbeat.inFlightId != null, "$name: the beat went, in flight")
    }
    // Every failure a held sid can meet, from the enum: START_ERROR is the server refusing the start, no sid minted.
    assertEquals(StartFailure.entries.toSet() - StartFailure.START_ERROR, seen, "${startFailures.size} rows")
  }

  @Test fun `item 4 the stopped sid of a start failure is delivered once, redelivered after a failed beat, and the next Go live arms a new sid`() {
    val rig = MachineRig().paired()
    rig.armWith(CodeAnswer.ForeignIngest(failedSid))
    rig.beats = null
    val first = rig.phase.beating!!.heartbeat.inFlightId!!
    rig.send(Input.HeartbeatAnswered(first, HeartbeatResponse.Failed("timeout")))
    rig.advance(30_000)
    val again = Configs.body(rig.sent<Command.PostHeartbeat>().last())
    assertEquals(failedSid, again.getString("stopped"), "carried again after the failed beat")
    assertTrue(rig.sent<Command.DeleteStopped>().isEmpty())
    rig.hear("waiting")
    assertEquals(1, rig.sent<Command.DeleteStopped>().size, "delivered")
    assertEquals(1, rig.records("stopped-delivered").size)
    val before = rig.sent<Command.PostHeartbeat>().size
    rig.advance(30_000)
    rig.hear("waiting")
    val later = rig.sent<Command.PostHeartbeat>().drop(before).map(Configs::body)
    assertTrue(later.isNotEmpty() && later.all { it.isNull("stopped") }, "never sent twice: $later")
    rig.ready()
    val fresh = "$failedSid-fresh"
    rig.codes = { if (rig.phase is Phase.Arming) Configs.open(sid = fresh, descriptor = rig.descriptor) else null }
    rig.starts = { StartAnswer.Started(fresh) }
    rig.send(Input.Start)
    assertEquals(fresh, rig.phase.heldSid, "the next Go live arms the new sid")
    assertNull(rig.snapshot.refusal)
  }

  /**
   * Item 4: the start-failure beat, from the real machine with a uuid sid, is the shared vector `wire/beat-bodies.json`
   * names; serverBodies.test.ts validates that vector against the vendored capture-beat.v1 with ajv.
   */
  @Test fun `item 4 the start-failure beat is the shared vector the contract check validates`() {
    // The vector names its sid once (a uuid, as the schema wants); the machine is driven with it.
    val vector = Shared.read("wire/beat-bodies.json").getJSONObject("startFailedStopped")
    val rig = MachineRig().paired()
    rig.armWith(CodeAnswer.Status(404, null, null), sid = vector.getString("stopped"))
    val beat = Configs.body(rig.sent<Command.PostHeartbeat>().last())
    // As JSON values: a number is the same number whether it reads 0 or 0.0.
    assertTrue(vector.similar(beat), "the machine's beat ${rig.sent<Command.PostHeartbeat>().last().body} is the vector $vector")
    assertEquals(vector.keySet(), beat.keySet())
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

  /**
   * Re-review 3 I: the hold's ask clears the last end and any refusal, so an answer naming a refused sid that only
   * started nothing left the screen blank: "Stream stopped" wiped, nothing in its place. It starts nothing, and says
   * the start failed, the try-again line a 5xx gives (amendment, the answer table). No retry of its own: a retry is
   * the operator's next hold. The line says why, never which sid; nothing rides a beat (`startFailed` is the
   * server's start failing, and this one answered).
   */
  @Test fun `a POST start answer naming a refused sid starts nothing, shows the try-again refusal, and records refusedSid`() {
    val answers = listOf(StartAnswer.Started("sess_42"), StartAnswer.AlreadyLive("sess_42", "organiser"))
    var checked = 0
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
      assertEquals(Refusal.START_FAILED, rig.snapshot.refusal, "$answer")
      assertNull(paired(rig).startFailed, "$answer: no start-error rides a beat")
      val line = rig.records("start-answered").single()
      assertEquals(listOf("answer" to answer::class.simpleName, "refusedSid" to true), line.fields, "$answer")
      rig.advance(60_000)
      assertEquals(1, rig.sent<Command.PostStart>().size, "$answer: never retried on its own")
      checked++
    }
    assertEquals(2, checked)
  }

  /** The positive pair: an answer naming a sid not refused records no refusedSid at all. */
  @Test fun `a POST start answer naming a sid not refused records no refusedSid`() {
    val rig = ready()
    rig.starts = { StartAnswer.Started("sess_42") }
    rig.send(Input.Start)
    assertEquals(listOf("answer" to "Started"), rig.records("start-answered").single().fields)
    assertNull(rig.snapshot.refusal)
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
