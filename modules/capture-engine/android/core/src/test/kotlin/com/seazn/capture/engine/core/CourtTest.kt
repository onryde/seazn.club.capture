package com.seazn.capture.engine.core

import com.seazn.capture.engine.adapter.Bodies
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertIs
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * Court stream (spec 2026-11-14 §6.3, §6.5, O5): on a court pairing the operator's Stop ends this match only, through
 * [SessionMachine.stoppedHere], never `end()`, and the round line is cleared at each Arming until the new sid's
 * descriptor says it. Per-fixture pairings are unchanged (the twin tests).
 */
class CourtTest {
  /** The pair as JS sends it for a court code: the court from the scan's GET, saved with the code. */
  private fun court(name: String? = "Court 2"): PairRequest {
    val r = Configs.pairRequest()
    return PairRequest(r.code, r.slot, r.token, r.codeUrl, r.heartbeatUrl, r.startUrl, r.language, r.automatic, r.claim, r.environment, court = name)
  }

  /** Answers the beat in flight, 200, with [waiting]. */
  private fun MachineRig.heard(waiting: WaitingFields, state: String = "waiting", sid: String? = null) {
    repeat(240) { if (phase.beating?.heartbeat?.inFlightId == null) advance(500) }
    send(Input.HeartbeatAnswered(phase.beating!!.heartbeat.inFlightId!!, HeartbeatResponse.Answered(200, BeatReply(state, sid, null, null, waiting))))
  }

  private val MachineRig.stage: String?
    get() = snapshot.pairing?.waiting?.stageLabel

  /** What a Stop that ends the match only must have done, and nothing it must not (the [end] path's End and final beat). */
  private fun assertStoppedHere(rig: MachineRig, commands: List<Command>, why: String) {
    val paired = assertIs<Phase.Paired>(rig.phase, why)
    assertEquals(LastEnd.STOPPED, paired.pairing.lastEnd, why)
    assertEquals(Configs.pairRequest().name, paired.pairing.name, "$why: the same pairing")
    assertEquals("Court 2", paired.pairing.waiting.courtName, why)
    assertTrue("sess_42" in paired.pairing.refused, "$why: the sid is never started or rejoined again")
    assertEquals(listOf("sess_42"), commands.filterIsInstance<Command.WriteStopped>().map { it.record.sid }, why)
    val beat = Configs.body(commands.filterIsInstance<Command.PostHeartbeat>().single())
    assertEquals("paired", beat.getString("state"), why)
    assertTrue(beat.isNull("sid"), why)
    assertEquals("sess_42", beat.getString("stopped"), why)
    assertTrue(!beat.has("endReason") || beat.isNull("endReason"), "$why: never the ended beat (T21)")
    assertTrue(commands.none { it is Command.End || it == Command.Release }, "$why: the pairing and its service stay: $commands")
    assertTrue(rig.records("ended").isEmpty(), why)
  }

  @Test
  fun `a court Stop after the first frame goes back to Paired`() {
    val rig = MachineRig(request = court()).live()
    assertEquals("publishing", rig.state.wire, "the rig is on air")
    assertTrue(rig.phase.firstLiveEpochMs != null, "and went live")
    assertNull(rig.phase.beating?.heartbeat?.inFlightId, "no beat in flight before the Stop")
    val commands = rig.send(Input.Stop)
    assertStoppedHere(rig, commands, "live")
    assertTrue(Command.StopBroadcast in commands, "the capture stops publishing")
    assertEquals(true, rig.records("broadcast-ended").single().field("wasLive"))
    // Four questions (1): a second Stop holds no broadcast, so it is ignored and sends nothing.
    val again = rig.send(Input.Stop)
    assertEquals(listOf<Any?>("stop", "paired"), rig.records("intent-ignored").last().let { listOf(it.field("intent"), it.field("phase")) })
    assertTrue(again.none { it is Command.PostHeartbeat || it is Command.WriteStopped || it is Command.End }, "$again")
    assertIs<Phase.Paired>(rig.phase)
  }

  /** Owner decision 1 (2026-10-05) is unchanged on a court: a Stop never live ends the broadcast, not the pairing. */
  @Test
  fun `a court Stop before the first frame behaves the same`() {
    val neverLive: List<Pair<String, () -> MachineRig>> =
      listOf(
        "arming" to { MachineRig(request = court()).paired().apply { codes = null; hear("go-live", sid = "sess_42") } },
        "armed" to { MachineRig(request = court()).armed() },
        "connecting" to { MachineRig(request = court()).armed().apply { ready() } },
      )
    for ((name, held) in neverLive) {
      val rig = held()
      assertEquals(name, rig.state.wire, "the rig is $name")
      assertStoppedHere(rig, rig.send(Input.Stop), name)
    }
    assertEquals(3, neverLive.size)
  }

  /** Review Focus 1: the organiser withdraws the court link mid-match, then the volunteer holds Stop. */
  @Test
  fun `stop on a court code after a held 401 ends the pairing`() {
    val rig = MachineRig(request = court()).live()
    rig.hear(null, status = 401)
    assertTrue(rig.phase.pairing!!.codeEndedPending)
    assertIs<Phase.OnAir>(rig.phase, "the 401 deferral: the broadcast runs on")
    val commands = rig.send(Input.Stop)
    assertEquals(EndReason.OPERATOR_STOPPED, assertIs<Phase.Ended>(rig.phase).reason)
    assertTrue(Command.End(EndReason.OPERATOR_STOPPED) in commands, "$commands")
    // Never back to waiting on a dead code, and never before the first frame either.
    val armed = MachineRig(request = court()).armed()
    armed.hear(null, status = 401)
    armed.send(Input.Stop)
    assertEquals(EndReason.OPERATOR_STOPPED, assertIs<Phase.Ended>(armed.phase).reason)
  }

  @Test
  fun `a per-fixture Stop after the first frame still ends the pairing`() {
    val rig = MachineRig().live()
    assertFalse(rig.phase.pairing!!.isCourt)
    val commands = rig.send(Input.Stop)
    assertEquals(EndReason.OPERATOR_STOPPED, assertIs<Phase.Ended>(rig.phase).reason)
    assertTrue(Command.End(EndReason.OPERATOR_STOPPED) in commands, "$commands")
    val last = Configs.body(commands.filterIsInstance<Command.PostHeartbeat>().single())
    assertEquals("ended", last.getString("state"), "A8's final beat")
  }

  /** Spec §5.4: the stopped match is never current again for the court, and a sid the phone refuses never loops. */
  @Test
  fun `a refused sid offered again is ignored on a court`() {
    val rig = MachineRig(request = court()).live()
    rig.send(Input.Stop)
    rig.codes = null
    rig.hear("go-live", sid = "sess_42", startedBy = "automatic")
    assertIs<Phase.Paired>(rig.phase, "the stopped sid is refused")
    assertEquals(listOf<Any?>("sess_42"), rig.records("open-ignored").map { it.field("sid") })
    // The court goes on: the next match's go-live names a new sid, and it arms.
    rig.armedAgain("sess_43")
    assertEquals("sess_43", rig.phase.heldSid)
    assertEquals("connecting", rig.state.wire, "armed, and still ready from the last match: connecting")
  }

  /** Arming for B on a court whose A is on air, by A's last beat; B's descriptor is left for the test to answer. */
  private fun handover(request: PairRequest): MachineRig {
    val a = Configs.waiting().copy(label = "A v B", stageLabel = "Quarter-final", stageFor = "A v B")
    val rig = MachineRig(request = request)
    rig.codes = { if ((rig.phase as? Phase.Arming)?.sid == "sess_42") CodeAnswer.Open("sess_42", "warming", Configs.descriptor(), a) else null }
    rig.paired()
    rig.heard(Configs.waiting().copy(label = "A v B", venueTimezone = ""), "go-live", "sess_42")
    rig.ready()
    rig.send(Input.Connected(rig.attempt!!))
    rig.advance(1_000)
    assertEquals("publishing", rig.state.wire)
    assertEquals("Quarter-final", rig.stage, "A's round line, from A's descriptor")
    // The beat that hands over still names A's label, so the beat merge alone keeps A's stage.
    rig.heard(Configs.waiting().copy(label = "A v B", venueTimezone = ""), "go-live", "sess_43")
    assertIs<Phase.Arming>(rig.phase)
    assertEquals("sess_43", rig.phase.heldSid)
    return rig
  }

  /** Answers the Arming fetch in flight with B's session shape, whose waiting fields are [waiting]. */
  private fun MachineRig.descriptorForB(waiting: WaitingFields) {
    val id = sent<Command.FetchCode>().last().requestId
    send(Input.CodeAnswered(id, CodeAnswer.Open("sess_43", "warming", Configs.descriptor(), waiting)))
    // Opened: Armed, and connecting at once, as the phone is still ready from A (A11's gate).
    assertEquals("connecting", state.wire)
    assertEquals("sess_43", phase.heldSid)
  }

  @Test
  fun `a court handover arms the new sid with no round line until its descriptor`() {
    val rig = handover(court())
    assertNull(rig.stage, "A's round line is not B's")
    assertNull(rig.phase.pairing!!.waiting.stageFor)
    assertEquals("Court 2", rig.phase.pairing!!.waiting.courtName, "the court stays")
    rig.descriptorForB(Configs.waiting().copy(label = "C v D", stageLabel = "Semi-final", stageFor = "C v D"))
    assertEquals("Semi-final", rig.stage)
    // Four questions (2): a B descriptor with no stage leaves no round line.
    val bare = handover(court())
    bare.descriptorForB(Configs.waiting().copy(label = "C v D"))
    assertNull(bare.stage)
    assertEquals("Court 2", bare.phase.pairing!!.waiting.courtName)
  }

  @Test
  fun `a per-fixture Arming keeps the held round line until its descriptor`() {
    val rig = handover(Configs.pairRequest())
    assertEquals("Quarter-final", rig.stage, "unchanged: the beat merge decides, as before")
    rig.descriptorForB(Configs.waiting().copy(label = "C v D", stageLabel = "Semi-final", stageFor = "C v D"))
    assertEquals("Semi-final", rig.stage)
  }

  /** Review Focus 2: process death on a court phone, then the cold-start re-pair, before any descriptor GET. */
  @Test
  fun `a pair seeded with a court is a court pairing before any GET`() {
    val pairing = MachineRig(request = court().let { r -> PairRequest(r.code, r.slot, r.token, r.codeUrl, r.heartbeatUrl, r.startUrl, r.language, r.automatic, Claim.RESUME, r.environment, court = "Court 2") })
    pairing.permissions = null
    pairing.send(Input.Pair(pairing.request, Configs.PHONE, stopped = null))
    assertTrue(assertIs<Phase.Pairing>(pairing.phase).pairing.isCourt, "Pairing, from the request alone")
    pairing.send(Input.PermissionsAnswered(granted = true))
    assertTrue(assertIs<Phase.Paired>(pairing.phase).pairing.isCourt, "Paired")
    assertTrue(pairing.sent<Command.FetchCode>().isEmpty(), "no GET yet")
    assertFalse(MachineRig().paired().phase.pairing!!.isCourt, "a fixture's code is not a court's")
    assertFalse(MachineRig(request = court(null)).paired().phase.pairing!!.isCourt, "nor one with no court")
  }

  /**
   * P1 review M4: a court code saved by a build from before courts re-pairs with no court, so it is a fixture's pairing
   * until the first Arming descriptor names the court. Stop is only reachable from there, so it is the court Stop.
   */
  @Test
  fun `a pairing whose court first comes on the Arming descriptor stops as a court`() {
    val rig = MachineRig()
    rig.codes = { if (rig.phase is Phase.Arming) CodeAnswer.Open("sess_42", "warming", Configs.descriptor(), Configs.waiting().copy(courtName = "Court 2")) else null }
    rig.paired()
    assertFalse(rig.phase.pairing!!.isCourt)
    rig.hear("go-live", sid = "sess_42", startedBy = "automatic")
    rig.ready()
    rig.send(Input.Connected(rig.attempt!!))
    rig.advance(1_000)
    assertTrue(rig.phase.pairing!!.isCourt, "the descriptor named it")
    assertStoppedHere(rig, rig.send(Input.Stop), "court from the descriptor")
  }

  /**
   * Court stream (capture-start.v1): a court with no streamed match in play answers the operator's start 409 no_match. The pairing
   * stays Paired with the refusal, as every refusal does, until the next start clears it (four questions 1 and 3).
   */
  @Test
  fun `a start refused no_match stays Paired with its refusal, and the next start clears it`() {
    val rig = MachineRig(request = court()).paired()
    rig.hear("waiting")
    rig.ready()
    rig.starts = { Bodies.start(409, """{"code":"no_match","message":"m"}""") }
    rig.send(Input.Start)
    assertEquals(Refusal.NO_MATCH, assertIs<Phase.Paired>(rig.phase).pairing.refusal)
    assertEquals(Refusal.NO_MATCH, rig.snapshot.refusal)
    assertNull(rig.snapshot.unpaired)
    assertTrue(rig.phase.pairing!!.isCourt, "still the court's pairing")
    rig.codes = null
    rig.starts = { StartAnswer.Started("sess_42") }
    rig.send(Input.Start)
    assertIs<Phase.Arming>(rig.phase)
    assertNull(rig.snapshot.refusal, "the retry cleared it")
  }

  private val MachineRig.autoRefusal: AutoRefusal?
    get() = snapshot.pairing?.waiting?.autoRefusal

  /**
   * E2 (2026-11-17): the server's refused automatic start of the court's match rides each waiting beat while it stands.
   * It is shown, never acted on, and it is not the phone's own start refusal: that one is [Snapshot.refusal], which the
   * phone's next start clears; this one only the server's answers move.
   */
  @Test
  fun `a court's refused automatic start is the last waiting answer's, apart from the phone's own refusal`() {
    val rig = MachineRig(request = court())
    rig.codes = { if (rig.phase is Phase.Arming) CodeAnswer.Open("sess_42", "warming", Configs.descriptor(), Configs.waiting().copy(courtName = "Court 2")) else null }
    rig.paired()
    assertNull(rig.autoRefusal, "nothing is known before the first answer")
    rig.heard(Configs.waiting().copy(venueTimezone = "", autoRefusal = AutoRefusal.NO_DESTINATION))
    assertEquals(AutoRefusal.NO_DESTINATION, rig.autoRefusal)
    assertNull(rig.snapshot.refusal, "the phone's own start was never refused")
    assertIs<Phase.Paired>(rig.phase, "shown, never acted on")
    // Four questions (3): a beat that fails says nothing new, so the refusal held stands.
    repeat(240) { if (rig.phase.beating?.heartbeat?.inFlightId == null) rig.advance(500) }
    rig.send(Input.HeartbeatAnswered(rig.phase.beating!!.heartbeat.inFlightId!!, HeartbeatResponse.Answered(503)))
    assertEquals(AutoRefusal.NO_DESTINATION, rig.autoRefusal)
    // The server retries every 60 s: the next answer may name another word, and one with none clears it.
    rig.heard(Configs.waiting().copy(venueTimezone = "", autoRefusal = AutoRefusal.UNAVAILABLE))
    assertEquals(AutoRefusal.UNAVAILABLE, rig.autoRefusal)
    rig.heard(Configs.waiting().copy(venueTimezone = ""))
    assertNull(rig.autoRefusal)
    // A start in flight: the server omits it on the go-live beat, and the session shape at Arming carries none.
    rig.heard(Configs.waiting().copy(venueTimezone = "", autoRefusal = AutoRefusal.NO_CREDIT))
    assertEquals(AutoRefusal.NO_CREDIT, rig.autoRefusal)
    rig.heard(Configs.waiting().copy(venueTimezone = ""), "go-live", "sess_42")
    assertIs<Phase.Armed>(rig.phase)
    assertNull(rig.autoRefusal)
  }

  /**
   * Fix round 1, M2: the operator's own Go live sends no go-live beat, so nothing clears the word before Arming; the
   * session shape at Arming is the answer that lands it, and it carries none.
   */
  @Test
  fun `the operator's own start drops a held refusal when the session shape lands at Arming`() {
    val rig = MachineRig(request = court())
    rig.codes = { if (rig.phase is Phase.Arming) CodeAnswer.Open("sess_42", "warming", Configs.descriptor(), Configs.waiting().copy(courtName = "Court 2")) else null }
    rig.paired()
    rig.heard(Configs.waiting().copy(venueTimezone = "", autoRefusal = AutoRefusal.DESTINATION_IN_USE))
    assertEquals(AutoRefusal.DESTINATION_IN_USE, rig.autoRefusal)
    rig.ready()
    rig.starts = { StartAnswer.Started("sess_42") }
    rig.send(Input.Start)
    assertTrue(rig.phase is Phase.Armed || rig.phase is Phase.Connecting, "the session shape landed: ${rig.phase.name}")
    assertNull(rig.autoRefusal)
  }

  /** A descriptor GET at Arming that answers 409 no_match is no evidence: never the code's end. */
  @Test
  fun `a descriptor 409 no_match at Arming never ends the code`() {
    val rig = MachineRig(request = court())
    rig.codes = { if (rig.phase is Phase.Arming) Bodies.code(409, """{"code":"no_match","message":"m"}""", null, Environment.STAGING) else null }
    rig.paired()
    rig.hear("go-live", sid = "sess_42", startedBy = "automatic")
    assertTrue(rig.sent<Command.FetchCode>().isNotEmpty(), "the descriptor was asked")
    assertTrue(rig.phase !is Phase.Idle, "${rig.phase.name}")
    assertNull(rig.snapshot.unpaired)
    assertTrue(rig.records("unpaired").isEmpty())
    assertTrue(rig.phase.pairing!!.isCourt)
  }
}
