package com.seazn.capture.engine.adapter

import com.seazn.capture.engine.core.*
import java.net.URLEncoder
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertIs
import kotlin.test.assertNull
import kotlin.test.assertTrue
import org.json.JSONObject

class BodiesTest {
  private val waiting = Shared.read("wire/waiting-vectors.json")
  private val sessions = Shared.read("wire/session-vectors.json")
  private val base = sessions.getJSONObject("base").toString()

  @Suppress("UNCHECKED_CAST") private fun JSONObject.plain(): Map<String, Any?> = JsonReader.parse(toString()) as Map<String, Any?>

  @Test
  fun `the waiting fields, every shared case`() {
    val cases = waiting.getJSONArray("cases")
    // The file's rows: 28, of which 3 are JS's alone (PV12: a truncated file cannot pass).
    assertEquals(28, cases.length())
    var read = 0
    var beats = 0
    for (i in 0 until cases.length()) {
      val case = cases.getJSONObject(i)
      if (case.optBoolean("jsOnly")) continue
      read += 1
      if (case.optBoolean("kotlinOnly")) beats += 1
      val why = case.getString("why")
      val got = Bodies.waiting(case.getJSONObject("fields").plain(), Environment.of(case.getString("env")))
      if (case.isNull("expected")) {
        assertNull(got, why)
        continue
      }
      val e = case.getJSONObject("expected")
      val expected =
        WaitingFields(
          e.getString("label"),
          e.getString("venueTimezone"),
          if (e.isNull("scheduledStart")) null else e.getLong("scheduledStart"),
          e.getBoolean("autoAllowed"),
          if (e.isNull("destinationName")) null else e.getString("destinationName"),
          if (e.isNull("overlayUrl")) null else e.getString("overlayUrl"),
          e.getInt("pollSeconds"),
        )
      assertEquals(expected, got, why)
    }
    assertEquals(25, read)
    assertEquals(2, beats)
  }

  @Test
  fun `the waiting fields' lower edges are read - a scheduled start of 1 and a poll of 5`() {
    val fields = JSONObject(base).put("scheduledStart", 1).put("pollSeconds", 5).plain()
    val read = Bodies.waiting(fields, Environment.STAGING)
    assertEquals(1L, read?.scheduledStartEpochS)
    assertEquals(5, read?.pollSeconds)
    // Past the schema's 2^53 - 1: a whole number, and still out of bounds.
    assertNull(Bodies.waiting(JSONObject(base).put("scheduledStart", 9_007_199_254_740_992L).plain(), Environment.STAGING))
  }

  @Test
  fun `the session shape, every shared case`() {
    val cases = sessions.getJSONArray("cases")
    // The file's rows (PV12).
    assertEquals(39, cases.length())
    val seen = mutableMapOf<String, Int>()
    for (i in 0 until cases.length()) {
      val case = cases.getJSONObject(i)
      val e = case.getJSONObject("expected")
      val why = case.getString("why")
      val env = Environment.of(case.optString("env", sessions.getString("env")))
      val answer = Bodies.code(200, body(case), null, env)
      seen.merge(e.getString("answer"), 1, Int::plus)
      // The whole expected object against the answer read the same way: no key unchecked, none extra.
      assertEquals(e.toMap(), decisive(answer), why)
    }
    assertEquals(mapOf("open" to 8, "unreadable" to 22, "not-current" to 1, "foreign-ingest" to 4, "over" to 3, "waiting" to 1), seen)
  }

  @Test
  fun `the session shape's bounds, edge for edge`() {
    fun srt(url: String) = JSONObject(base).also { it.getJSONObject("cred").getJSONObject("srt").put("url", url) }.toString()
    // The ingest-host rule reads the scheme and host in either case; the shape is srt://host:port and nothing after.
    for (url in listOf("SRT://LIVE.STG.SEAZN.CLUB:778", "srt://live.stg.seazn.club:1", "srt://live.stg.seazn.club:65535")) {
      assertIs<CodeAnswer.Open>(Bodies.code(200, srt(url), null, Environment.STAGING), url)
    }
    for (url in listOf("srt://live.stg.seazn.club:65536", "srt://live.stg.seazn.club:778#x", "srt://live.stg.seazn.club:778?latency=2000")) {
      assertEquals(CodeAnswer.Unreadable("cred.srt"), Bodies.code(200, srt(url), null, Environment.STAGING), url)
    }
    // A host the host rule cannot read at all is refused there first, as any foreign host is.
    for (url in listOf("srt://live.stg.seazn.club:778 ", "srt://live.stg.seazn.club:")) {
      assertEquals(CodeAnswer.ForeignIngest(SID), Bodies.code(200, srt(url), null, Environment.STAGING), url)
    }
    // The upper and lower edges the schema allows are read.
    val edges = JSONObject(base).put("holdWindowSeconds", JSONObject().put("srt", 999).put("rtmps", 1)).put("maxDurationMinutes", 1)
    edges.getJSONObject("cred").getJSONObject("srt").put("latencyMs", 1)
    val open = assertIs<CodeAnswer.Open>(Bodies.code(200, edges.toString(), null, Environment.STAGING))
    assertEquals(mapOf(Transport.SRT to 999, Transport.RTMPS to 1), open.descriptor.holdWindowSeconds)
    assertEquals(1, open.descriptor.maxDurationMinutes)
    assertEquals(1, (open.descriptor.primary as SrtTarget).latencyMs)
    // The broadcast's label is shown, never acted on: outside 1 to 200 characters it is "", and the broadcast still opens.
    for (label in listOf("", "L".repeat(201))) {
      assertEquals("", assertIs<CodeAnswer.Open>(Bodies.code(200, JSONObject(base).put("label", label).toString(), null, Environment.STAGING)).descriptor.label)
    }
    assertEquals("🏏".repeat(200), assertIs<CodeAnswer.Open>(Bodies.code(200, JSONObject(base).put("label", "🏏".repeat(200)).toString(), null, Environment.STAGING)).descriptor.label)
  }

  @Test
  fun `an open answer carries the session shape's waiting fields too`() {
    val open = assertIs<CodeAnswer.Open>(Bodies.code(200, base, null, Environment.STAGING))
    assertEquals(WaitingFields("Example Town v Sample CC", "Europe/London", 1_790_003_600, true, "YouTube · Example Town CC", "https://stg.seazn.club/overlay/fixtures/f1", 10), open.waiting)
    assertEquals("warming", open.state)
    val d = open.descriptor
    assertEquals(mapOf(Transport.SRT to 183, Transport.RTMPS to 180), d.holdWindowSeconds)
    assertEquals(Configs.PLAYBACK_URL, d.playbackUrl)
    assertEquals(300, d.maxDurationMinutes)
    assertEquals(1_790_000_600L, d.warmingDeadlineEpochS)
    val srt = assertIs<SrtTarget>(d.primary)
    assertEquals(listOf("srt://live.stg.seazn.club:778", Configs.STREAM_ID, Configs.PASSPHRASE, 2_000), listOf(srt.url, srt.streamId, srt.passphrase, srt.latencyMs))
    val rtmps = assertIs<RtmpsTarget>(d.fallback)
    assertEquals(listOf("rtmps://live.stg.seazn.club:443/live/", Configs.STREAM_KEY), listOf(rtmps.url, rtmps.streamKey))
    // A production build refuses the staging ingest hosts.
    assertEquals(CodeAnswer.ForeignIngest(SID), Bodies.code(200, base, null, Environment.PRODUCTION))
  }

  @Test
  fun `a foreign overlay on the session shape is dropped from the broadcast and the waiting fields, the rest kept`() {
    val open = assertIs<CodeAnswer.Open>(Bodies.code(200, JSONObject(base).put("overlayUrl", "https://evil.example/overlay").toString(), null, Environment.STAGING))
    assertNull(open.descriptor.overlayUrl)
    assertNull(open.waiting?.overlayUrl)
    assertEquals("Example Town v Sample CC", open.descriptor.label)
    assertEquals("https://stg.seazn.club/overlay/fixtures/f1", assertIs<CodeAnswer.Open>(Bodies.code(200, base, null, Environment.STAGING)).descriptor.overlayUrl)
  }

  /**
   * Final review I-2: the drop above reaches JS as no overlay, which is the server's answer for an org not
   * entitled to one. [Bodies.foreignOverlay] is how native tells them apart, for its own record line.
   */
  @Test
  fun `final I-2 an overlay off the build's Seazn host is foreign, and no overlay or Seazn's own is not`() {
    val foreign = JSONObject(base).put("overlayUrl", "https://evil.example/overlay").toString()
    assertTrue(Bodies.foreignOverlay(foreign, Environment.STAGING))
    assertNull(assertIs<CodeAnswer.Open>(Bodies.code(200, foreign, null, Environment.STAGING)).descriptor.overlayUrl, "and it is the one dropped")
    // Staging's own overlay host is foreign to a production build.
    assertFalse(Bodies.foreignOverlay(base, Environment.STAGING))
    assertTrue(Bodies.foreignOverlay(base, Environment.PRODUCTION))
    assertTrue(Bodies.foreignOverlay(JSONObject(base).put("overlayUrl", "http://stg.seazn.club/overlay/fixtures/f1").toString(), Environment.STAGING), "not https")
    assertFalse(Bodies.foreignOverlay(JSONObject(base).put("overlayUrl", JSONObject.NULL).toString(), Environment.STAGING), "null is not entitled")
    assertFalse(Bodies.foreignOverlay(JSONObject(base).apply { remove("overlayUrl") }.toString(), Environment.STAGING), "absent")
    assertFalse(Bodies.foreignOverlay(PairWire.beat(), Environment.STAGING), "a beat with none")
    assertTrue(Bodies.foreignOverlay(JSONObject(PairWire.beat()).put("overlayUrl", "https://evil.example/o").toString(), Environment.STAGING), "a beat")
    assertFalse(Bodies.foreignOverlay("not json", Environment.STAGING))
  }

  @Test
  fun `non-2xx code answers keep their status, only a 429 its Retry-After, only a 410 its endReason`() {
    assertEquals(CodeAnswer.Status(401, null, null), Bodies.code(401, refusal("code_ended"), null, Environment.STAGING))
    assertEquals(CodeAnswer.Status(429, 30, null), Bodies.code(429, refusal("rate_limited"), 30, Environment.STAGING))
    assertEquals(CodeAnswer.Status(503, null, null), Bodies.code(503, refusal("unavailable"), 30, Environment.STAGING))
    assertEquals(CodeAnswer.Status(410, null, "stopped"), Bodies.code(410, gone410("stopped"), null, Environment.STAGING))
    assertEquals(CodeAnswer.Status(410, null, null), Bodies.code(410, gone410("lunch"), null, Environment.STAGING))
    // An endReason on any other status is not the server's word about a broadcast: none is read.
    assertEquals(CodeAnswer.Status(401, null, null), Bodies.code(401, """{"code":"code_ended","message":"m","endReason":"stopped"}""", null, Environment.STAGING))
    // Any 2xx is the body's: a 201 reads as a 200 does.
    assertEquals(decisive(Bodies.code(200, base, null, Environment.STAGING)), decisive(Bodies.code(201, base, null, Environment.STAGING)))
  }

  @Test
  fun `a 2xx that is not a JSON object is no answer - transient on the code, the beat and the start, never the server's word`() {
    // I1: a captive portal's page at the ground, or a body cut short. Transient: the code is fetched
    // again, the beat counted failed, the start the operator's to try again. Never a bad config.
    val pages = listOf(PORTAL, "", "[]", "\"warming\"", "42", "null", base.dropLast(1))
    assertEquals(7, pages.size)
    for (page in pages) {
      val code = Bodies.code(200, page, null, Environment.STAGING)
      assertEquals(CodeAnswer.Unreachable("not-json"), code, page)
      assertEquals(ServerWord.NoEvidence, ServerWord.ofCode(code, named = SID), page)
      val beat = Bodies.beat(200, page, null, Environment.STAGING)
      assertEquals(HeartbeatResponse.Failed("not-json"), beat, page)
      assertEquals(ServerWord.NoEvidence, ServerWord.ofBeat(beat, named = SID), page)
      assertEquals(StartAnswer.Failed("not-json"), Bodies.start(200, page), page)
    }
    // A JSON object is the server's, even one that breaks a rule: a bad code still refuses, a bare beat answer is heard.
    assertEquals(CodeAnswer.Unreadable("state"), Bodies.code(200, "{}", null, Environment.STAGING))
    assertEquals(HeartbeatResponse.Answered(200, NO_REPLY, null), Bodies.beat(200, "{}", null, Environment.STAGING))
    assertEquals(StartAnswer.Failed("200"), Bodies.start(200, "{}"))
  }

  @Test
  fun `I1 a captive portal's 200 to the claim beat keeps the claim and the stopped record`() {
    val record = StoppedRecord.of(Configs.pairRequest().name, OTHER, 1_790_000_000_000, null)
    val rig = MachineRig()
    rig.send(Input.Pair(Configs.pairRequest(), Configs.PHONE, record))
    rig.send(Input.Network(true))
    val claim = Configs.body(rig.sent<Command.PostHeartbeat>().single())
    assertEquals(listOf("new", OTHER), listOf(claim.getString("claim"), claim.getString("stopped")))
    rig.answerBeat(Bodies.beat(200, PORTAL, null, Environment.STAGING))
    val kept = assertIs<Phase.Paired>(rig.phase).pairing
    assertEquals(Claim.NEW, kept.claim)
    assertEquals(record, kept.stopped)
    assertTrue(rig.sent<Command.DeleteStopped>().isEmpty())
    assertEquals(HeartbeatResult.FAILED, kept.heartbeat.lastResult)
    // The next beat carries both again, and the server's own answer then clears the claim and delivers the record (A17).
    rig.answerBeat(Bodies.beat(200, beat("waiting"), null, Environment.STAGING))
    val again = Configs.body(rig.sent<Command.PostHeartbeat>()[1])
    assertEquals(listOf("new", OTHER), listOf(again.getString("claim"), again.getString("stopped")))
    val heard = assertIs<Phase.Paired>(rig.phase).pairing
    assertNull(heard.claim)
    assertNull(heard.stopped)
    assertEquals(listOf(Command.DeleteStopped("fx42hmnp7k2q", 1)), rig.sent<Command.DeleteStopped>())
  }

  @Test
  fun `I1 a captive portal's 200 to the code at Arming retries, and never refuses the broadcast`() {
    val rig = MachineRig()
    var portal = true
    rig.codes = { if (rig.phase is Phase.Arming) Bodies.code(200, if (portal) PORTAL else base, null, Environment.STAGING) else null }
    rig.paired()
    rig.answerBeat(Bodies.beat(200, beat("go-live", "sid" to SID, "startedBy" to "organiser"), null, Environment.STAGING))
    val arming = assertIs<Phase.Arming>(rig.phase)
    assertTrue(arming.retrying)
    assertTrue(SID !in arming.pairing.refused)
    assertNull(arming.pairing.startFailed)
    assertEquals("not-json", rig.records("code").single().field("message"))
    assertTrue(rig.records("start-failed").isEmpty())
    portal = false
    rig.advance(10_000)
    assertIs<Phase.Armed>(rig.phase)
  }

  @Test
  fun `the refusal statuses (D5, D7, D18), read through ServerWord - code, beat and start`() {
    // Status, the schema's refusal word, the code's verdict, the beat's verdict. 429 alone keeps Retry-After.
    val rows =
      listOf(
        listOf(401, "code_ended", ServerWord.CodeEnded, ServerWord.CodeEnded),
        listOf(404, "not_a_stream_code", ServerWord.NotFound, ServerWord.NotFound),
        listOf(422, "invalid", ServerWord.NoEvidence, ServerWord.NoEvidence),
        listOf(429, "rate_limited", ServerWord.NoEvidence, ServerWord.NoEvidence),
        listOf(503, "unavailable", ServerWord.NoEvidence, ServerWord.NoEvidence),
      )
    assertEquals(5, rows.size)
    for ((status, word, code, beatWord) in rows) {
      status as Int
      val body = refusal(word as String)
      val retry = if (status == 429) 12 else null
      val fetched = Bodies.code(status, body, 12, Environment.STAGING)
      assertEquals(CodeAnswer.Status(status, retry, null), fetched, word)
      assertEquals(code, ServerWord.ofCode(fetched, named = SID), word)
      val answered = Bodies.beat(status, body, 12, Environment.STAGING)
      assertEquals(HeartbeatResponse.Answered(status, NO_REPLY, retry), answered, word)
      assertEquals(beatWord, ServerWord.ofBeat(answered, named = SID), word)
      // POST start: a 401 ends the code, as a beat's does (amendment:41, D5); any other fails the
      // start, the operator's to try again; never a refusal line.
      val started = if (status == 401) StartAnswer.CodeEnded else StartAnswer.Failed("$status")
      assertEquals(started, Bodies.start(status, body), word)
      // X1: with no body, a 401 is not the server's code_ended, so it ends nothing.
      val bare = if (status == 401) StartAnswer.Failed("401-not-refusal") else StartAnswer.Failed("$status")
      assertEquals(bare, Bodies.start(status, ""), "$word, no body")
    }
    // A beat's 410 is never sent (ask 8) and is still read: Over for the sid the beat named.
    assertEquals(ServerWord.Over(SID, "stopped"), ServerWord.ofBeat(Bodies.beat(410, gone410("stopped"), null, Environment.STAGING), named = SID))
  }

  @Test
  fun `a beat's answer - its state, sid, startedBy, endReason and waiting fields`() {
    val goLive = Bodies.beat(200, beat("go-live", "sid" to SID, "startedBy" to "automatic"), null, Environment.STAGING)
    val reply = BeatReply("go-live", SID, "automatic", null, WaitingFields("L", "", null, true, null, null, 10))
    assertEquals(HeartbeatResponse.Answered(200, reply, null), goLive)
    val over = Bodies.beat(200, beat("over", "sid" to SID, "endReason" to "phone_lost"), null, Environment.STAGING)
    assertEquals(ServerWord.Over(SID, "phone_lost"), ServerWord.ofBeat(over, named = null))
    val taken = answeredBeat(200, """{"state":"taken"}""")
    assertEquals(BeatReply("taken", null, null, null, null), taken.reply)
    assertEquals(ServerWord.Taken, ServerWord.ofBeat(taken, named = null))
    // Any 2xx is the body's: a 204 reads as a 200 does.
    assertEquals(HeartbeatResponse.Answered(204, reply, null), Bodies.beat(204, beat("go-live", "sid" to SID, "startedBy" to "automatic"), null, Environment.STAGING))
  }

  @Test
  fun `a beat answer outside 2xx is an answer whatever its body, a 401 or 404 aside, and only a 429 keeps Retry-After`() {
    assertEquals(HeartbeatResponse.Answered(429, NO_REPLY, 12), Bodies.beat(429, "", 12, Environment.STAGING))
    assertEquals(HeartbeatResponse.Answered(503, NO_REPLY, null), Bodies.beat(503, PORTAL, 12, Environment.STAGING))
    assertEquals(HeartbeatResponse.Answered(401, NO_REPLY, null), Bodies.beat(401, refusal("code_ended"), 12, Environment.STAGING))
  }

  @Test
  fun `X1 a 401, a 404 or a 410 ends something only on the server's refusal - any other body is no answer`() {
    // Not the server's: an edge's page, nothing, a cut body, an object with no code or a code that is no
    // string, and a refusal naming another status's word.
    val pages = listOf(PORTAL, "", refusal("code_ended").dropLast(1), """{"message":"m"}""", """{"code":7,"message":"m"}""")
    assertEquals(5, pages.size)
    for ((status, other) in listOf(401 to "not_a_stream_code", 404 to "code_ended")) {
      for (page in pages + refusal(other)) {
        assertEquals(CodeAnswer.Unreachable("$status-not-refusal"), Bodies.code(status, page, null, Environment.STAGING), "$status $page")
        assertEquals(HeartbeatResponse.Failed("$status-not-refusal"), Bodies.beat(status, page, null, Environment.STAGING), "$status $page")
      }
    }
    for (page in pages + refusal("not_a_stream_code") + refusal("no_credit")) {
      assertEquals(StartAnswer.Failed("401-not-refusal"), Bodies.start(401, page), page)
    }
    // Fix round 2 (N1): a 410 ends a held broadcast, and delivers a stopped record, only as the server's
    // refusal. Neither route sends one (ask 8), so any word will do, but an endReason alone is not one.
    for (page in pages + """{"endReason":"stopped"}""") {
      assertEquals(CodeAnswer.Unreachable("410-not-refusal"), Bodies.code(410, page, null, Environment.STAGING), page)
      assertEquals(HeartbeatResponse.Failed("410-not-refusal"), Bodies.beat(410, page, null, Environment.STAGING), page)
    }
    assertEquals(HeartbeatResponse.Answered(410, BeatReply(null, null, null, "stopped", null), null), Bodies.beat(410, gone410("stopped"), null, Environment.STAGING))
    // The server's refusal acts, its message aside (the schema requires one; the word is what is read).
    assertEquals(CodeAnswer.Status(401, null, null), Bodies.code(401, """{"code":"code_ended"}""", null, Environment.STAGING))
    assertEquals(CodeAnswer.Status(404, null, null), Bodies.code(404, refusal("not_a_stream_code"), null, Environment.STAGING))
    assertEquals(HeartbeatResponse.Answered(401, NO_REPLY, null), Bodies.beat(401, """{"code":"code_ended"}""", null, Environment.STAGING))
    assertEquals(HeartbeatResponse.Answered(404, NO_REPLY, null), Bodies.beat(404, refusal("not_a_stream_code"), null, Environment.STAGING))
    assertEquals(StartAnswer.CodeEnded, Bodies.start(401, """{"code":"code_ended"}"""))
    // A start's 404 ends nothing (a start error), so it needs no refusal, and a 403 is unchanged.
    assertEquals(StartAnswer.Failed("404"), Bodies.start(404, PORTAL))
    assertEquals(CodeAnswer.Status(403, null, null), Bodies.code(403, PORTAL, null, Environment.STAGING))
    assertEquals(HeartbeatResponse.Answered(403, NO_REPLY, null), Bodies.beat(403, PORTAL, null, Environment.STAGING))
  }

  @Test
  fun `a sid outside the schema's uuid pattern is no sid - a beat's go-live is no evidence, a start failed`() {
    for (sid in listOf("sess_43", "", "3F9A2C7E-8B14-4D5E-A6F7-0C1D2E3F4A5B\n")) {
      val read = answeredBeat(200, beat("go-live", "sid" to sid, "startedBy" to "organiser"))
      assertNull(read.reply?.sid, sid)
      assertEquals(ServerWord.NoEvidence, ServerWord.ofBeat(read, named = null), sid)
      assertEquals(StartAnswer.Failed("200"), Bodies.start(200, """{"sid":${JSONObject.quote(sid)}}"""), sid)
      assertEquals(StartAnswer.Failed("409"), Bodies.start(409, """{"code":"already_live","message":"m","sid":${JSONObject.quote(sid)},"startedBy":"organiser"}"""), sid)
    }
    // A sid that is not a string at all.
    assertNull(answeredBeat(200, beat("live", "sid" to 42.0)).reply?.sid)
  }

  @Test
  fun `the uuid pattern is the schema's, edge for edge`() {
    val ok = listOf(SID, SID.uppercase(), "00000000-0000-0000-0000-000000000000", "ffffffff-ffff-ffff-ffff-ffffffffffff", "3f9a2c7e-8b14-8d5e-b6f7-0c1d2e3f4a5b")
    val refused =
      listOf(
        "3f9a2c7e-8b14-0d5e-a6f7-0c1d2e3f4a5b", // version 0
        "3f9a2c7e-8b14-9d5e-a6f7-0c1d2e3f4a5b", // version 9
        "3f9a2c7e-8b14-4d5e-c6f7-0c1d2e3f4a5b", // variant c
        "3f9a2c7e8b144d5ea6f70c1d2e3f4a5b", // no dashes
        "{3f9a2c7e-8b14-4d5e-a6f7-0c1d2e3f4a5b}",
        "urn:uuid:3f9a2c7e-8b14-4d5e-a6f7-0c1d2e3f4a5b", // ajv's uuid format allows it; the pattern does not
        "3f9a2c7e-8b14-4d5e-a6f7-0c1d2e3f4a5b\n",
        " 3f9a2c7e-8b14-4d5e-a6f7-0c1d2e3f4a5b",
        "FFFFFFFF-FFFF-FFFF-FFFF-FFFFFFFFFFFF", // the pattern's max is lowercase only
        "3f9a2c7e-8b14-4d5e-a6f7-0c1d2e3f4a5ｂ", // a fullwidth letter
      )
    assertEquals(5 + 10, ok.size + refused.size)
    for (sid in ok) assertEquals(sid, Bodies.start(200, """{"sid":${JSONObject.quote(sid)}}""").let { (it as? StartAnswer.Started)?.sid }, sid)
    for (sid in refused) assertEquals(StartAnswer.Failed("200"), Bodies.start(200, """{"sid":${JSONObject.quote(sid)}}"""), sid)
  }

  @Test
  fun `a stopped key in a beat's answer is never read as its sid - stopped belongs to the beat, and only a paired one`() {
    // The answer schema has no `stopped`; the beat's `stopped` rides only a beat with no sid (RR3,
    // Beats.kt, pinned by BeatsTest). An answer that carried one anyway is read by its sid alone.
    val both = answeredBeat(200, beat("over", "sid" to SID, "endReason" to "stopped", "stopped" to OTHER))
    assertEquals(SID, both.reply?.sid)
    assertEquals(ServerWord.Over(SID, "stopped"), ServerWord.ofBeat(both, named = SID))
    val stoppedOnly = answeredBeat(200, beat("over", "endReason" to "stopped", "stopped" to OTHER))
    assertNull(stoppedOnly.reply?.sid)
    assertEquals(ServerWord.NoEvidence, ServerWord.ofBeat(stoppedOnly, named = SID))
    // A 410 to a beat that held SID names SID, whatever its body says.
    val gone = Bodies.beat(410, """{"code":"gone","message":"m","sid":"$OTHER","stopped":"$OTHER","endReason":"stopped"}""", null, Environment.STAGING)
    assertEquals(ServerWord.Over(SID, "stopped"), ServerWord.ofBeat(gone, named = SID))
  }

  @Test
  fun `a beat's words are closed - an unknown state, startedBy or endReason is null`() {
    val odd = answeredBeat(200, beat("paused", "sid" to SID, "startedBy" to "robot", "endReason" to "lunch"))
    assertEquals(BeatReply(null, SID, null, null, WaitingFields("L", "", null, true, null, null, 10)), odd.reply)
    val known = answeredBeat(200, beat("over", "sid" to SID, "startedBy" to "operator", "endReason" to "no_inbound_timeout"))
    assertEquals(listOf("over", "operator", "no_inbound_timeout"), listOf(known.reply?.state, known.reply?.startedBy, known.reply?.endReason))
    // An over state's endReason on the code is closed the same way.
    val over = JSONObject(base).put("state", "completed").put("endReason", "lunch").also { it.remove("cred") }
    assertEquals(CodeAnswer.Over(SID, null), Bodies.code(200, over.toString(), null, Environment.STAGING))
  }

  @Test
  fun `the closed words are the schema's, every one read as itself`() {
    // capture-beat.v1 $defs.answer's states, startedBy, and the one endReason vocabulary (web 09e87aabd).
    val states = listOf("waiting", "go-live", "live", "over", "replaced", "taken")
    val startedBy = listOf("organiser", "automatic", "operator")
    val endReasons = listOf("stopped", "auto_stopped", "no_inbound_timeout", "target_rejected", "max_duration", "phone_lost", "failed")
    assertEquals(16, states.size + startedBy.size + endReasons.size)
    for (state in states) assertEquals(state, answeredBeat(200, beat(state)).reply?.state)
    for (who in startedBy) {
      assertEquals(who, answeredBeat(200, beat("go-live", "sid" to SID, "startedBy" to who)).reply?.startedBy)
      assertEquals(StartAnswer.AlreadyLive(SID, who), Bodies.start(409, """{"code":"already_live","message":"m","sid":"$SID","startedBy":"$who"}"""))
    }
    for (why in endReasons) {
      assertEquals(why, answeredBeat(200, beat("over", "sid" to SID, "endReason" to why)).reply?.endReason)
      assertEquals(CodeAnswer.Over(SID, why), Bodies.code(200, JSONObject(base).put("state", "ending").put("endReason", why).toString(), null, Environment.STAGING))
      assertEquals(CodeAnswer.Status(410, null, why), Bodies.code(410, gone410(why), null, Environment.STAGING))
    }
  }

  @Test
  fun `POST start's answers, each by status and code`() {
    assertEquals(StartAnswer.Started(SID), Bodies.start(200, """{"sid":"$SID"}"""))
    // Any 2xx is the body's: a 201 reads as a 200 does.
    assertEquals(StartAnswer.Started(SID), Bodies.start(201, """{"sid":"$SID"}"""))
    // 401 code_ended: the code is over (amendment:41, D5). Only the server's refusal naming it says so (X1).
    assertEquals(StartAnswer.CodeEnded, Bodies.start(401, refusal("code_ended")))
    assertEquals(StartAnswer.Failed("401-not-refusal"), Bodies.start(401, """{"code":"no_credit","message":"m"}"""))
    assertEquals(StartAnswer.AlreadyLive(OTHER, "organiser"), Bodies.start(409, """{"code":"already_live","message":"m","sid":"$OTHER","startedBy":"organiser"}"""))
    assertEquals(StartAnswer.AlreadyLive(OTHER, null), Bodies.start(409, """{"code":"already_live","message":"m","sid":"$OTHER","startedBy":"robot"}"""))
    assertEquals(StartAnswer.Replaced, Bodies.start(409, """{"code":"replaced","message":"m"}"""))
    assertEquals(StartAnswer.Refused(Refusal.NO_DESTINATION, "Pick a destination"), Bodies.start(409, """{"code":"no_destination","message":"Pick a destination"}"""))
    assertEquals(StartAnswer.Refused(Refusal.NO_CREDIT, "m"), Bodies.start(402, """{"code":"no_credit","message":"m"}"""))
    assertEquals(StartAnswer.Refused(Refusal.NOT_ENTITLED, "m"), Bodies.start(403, """{"code":"not_entitled","message":"m"}"""))
    // An unknown code: the generic refusal, "Can't go live — ask the organiser", its message for the record.
    assertEquals(StartAnswer.Refused(Refusal.UNKNOWN, "Club suspended"), Bodies.start(403, """{"code":"club_suspended","message":"Club suspended"}"""))
    assertEquals(StartAnswer.Refused(Refusal.UNKNOWN, "This match is already live."), Bodies.start(409, """{"code":"active_session","message":"This match is already live."}"""))
    assertEquals(StartAnswer.Refused(Refusal.UNKNOWN, null), Bodies.start(400, """{"code":"bad_request"}"""))
    // The line is the code's, never the status's: a known code reads the same under another 4xx.
    assertEquals(StartAnswer.Refused(Refusal.NO_CREDIT, "m"), Bodies.start(403, """{"code":"no_credit","message":"m"}"""))
    assertEquals(StartAnswer.Failed("404"), Bodies.start(404, ""))
    assertEquals(StartAnswer.Failed("200"), Bodies.start(200, "{}"))
    assertEquals(StartAnswer.Failed("500"), Bodies.start(500, """{"code":"no_credit","message":"m"}"""))
    assertEquals(StartAnswer.Failed("409"), Bodies.start(409, "<html>"))
    assertEquals(StartAnswer.Failed("409"), Bodies.start(409, """{"code":7,"message":"m"}"""))
    assertEquals(StartAnswer.Failed("302"), Bodies.start(302, """{"code":"no_credit","message":"m"}"""))
  }

  @Test
  fun `Retry-After is whole seconds or nothing`() {
    assertEquals(30, Bodies.retryAfter("30"))
    assertEquals(0, Bodies.retryAfter("0"))
    assertEquals(30, Bodies.retryAfter(" 30 "))
    assertNull(Bodies.retryAfter("Wed, 21 Oct 2026 07:28:00 GMT"))
    assertNull(Bodies.retryAfter("-1"))
    assertNull(Bodies.retryAfter("+30"))
    assertNull(Bodies.retryAfter("30.5"))
    assertNull(Bodies.retryAfter("99999999999"))
    assertNull(Bodies.retryAfter("３０")) // fullwidth digits: Kotlin's toIntOrNull reads them
    assertNull(Bodies.retryAfter(""))
    assertNull(Bodies.retryAfter(null))
  }

  @Test
  fun `scoreUpdates outside its closed set is null for that field alone, never the whole body`() {
    for (word in listOf("push", "Realtime", "")) {
      val open = assertIs<CodeAnswer.Open>(Bodies.code(200, JSONObject(base).put("scoreUpdates", word).toString(), null, Environment.STAGING), word)
      // No word at all, so no server text rides the descriptor; the snapshot crosses it as null.
      assertEquals("", open.descriptor.scoreUpdates, word)
      assertNull(ScoreUpdates.of(open.descriptor.scoreUpdates), word)
      assertEquals(SID, open.sid, word)
    }
    val absent = assertIs<CodeAnswer.Open>(Bodies.code(200, JSONObject(base).also { it.remove("scoreUpdates") }.toString(), null, Environment.STAGING))
    assertEquals("", absent.descriptor.scoreUpdates)
  }

  @Test
  fun `a cred sent as null reads as no cred - not the current phone`() {
    // The schema refuses an explicit null (it omits cred instead); the phone reads it as absent, a claim and a second fetch.
    assertEquals(CodeAnswer.NotCurrent(SID), Bodies.code(200, JSONObject(base).put("cred", JSONObject.NULL).toString(), null, Environment.STAGING))
  }

  @Test
  fun `a number that no whole Int or Long holds exactly is no whole number`() {
    val huge = JSONObject(base).put("maxDurationMinutes", 1e10).toString()
    assertEquals(CodeAnswer.Unreadable("maxDurationMinutes"), Bodies.code(200, huge, null, Environment.STAGING))
    val fields = JSONObject(base).put("scheduledStart", 1e300).plain()
    assertNull(Bodies.waiting(fields, Environment.STAGING))
    val far = JSONObject(base).put("scheduledStart", 9_007_199_254_740_991L).plain()
    assertEquals(9_007_199_254_740_991L, Bodies.waiting(far, Environment.STAGING)?.scheduledStartEpochS)
  }

  @Test
  fun `a second read is the first's, whatever came between - and an empty map reads as nothing`() {
    val first = Bodies.code(200, base, null, Environment.STAGING)
    assertEquals(CodeAnswer.Unreachable("not-json"), Bodies.code(200, base.dropLast(1), null, Environment.STAGING))
    assertEquals(StartAnswer.Failed("not-json"), Bodies.start(200, "{\"sid\":"))
    val second = Bodies.code(200, base, null, Environment.STAGING)
    assertEquals((first as CodeAnswer.Open).waiting, (second as CodeAnswer.Open).waiting)
    assertEquals(decisive(first), decisive(second))
    assertEquals(Bodies.beat(200, beat("live", "sid" to SID), null, Environment.STAGING), Bodies.beat(200, beat("live", "sid" to SID), null, Environment.STAGING))
    assertNull(Bodies.waiting(emptyMap(), Environment.STAGING))
  }

  @Test
  fun `a body cut short at any length is no answer, never a throw`() {
    // A dropped connection hands over a prefix. Every prefix but the whole is malformed JSON.
    for (end in 0 until base.length) {
      val cut = base.substring(0, end)
      assertEquals(CodeAnswer.Unreachable("not-json"), Bodies.code(200, cut, null, Environment.STAGING), "cut at $end")
      assertEquals(HeartbeatResponse.Failed("not-json"), Bodies.beat(200, cut, null, Environment.STAGING), "cut at $end")
      assertEquals(StartAnswer.Failed("not-json"), Bodies.start(200, cut), "cut at $end")
    }
  }

  @Test
  fun `no answer prints a secret`() {
    val cases = sessions.getJSONArray("cases")
    val answers = (0 until cases.length()).map { Bodies.code(200, body(cases.getJSONObject(it)), null, Environment.STAGING) } + Bodies.code(200, base, null, Environment.STAGING)
    assertEquals(40, answers.size)
    assertTrue(answers.any { it is CodeAnswer.Open }, "an open answer, whose descriptor holds every secret")
    for (answer in answers) for (secret in SECRETS + Configs.STREAM_ID) assertFalse(secret in answer.toString(), "$secret in $answer")
  }

  @Test
  fun `no cred value reaches a record line or the snapshot - on air, on four refused starts, and when not current`() {
    val entries = mutableListOf<RecordEntry>()
    val wires = mutableListOf<String>()
    // On air on the parsed descriptor, a drop, then the operator's Stop.
    val live = MachineRig()
    live.codes = { if (live.phase is Phase.Arming) Bodies.code(200, base, null, Environment.STAGING) else null }
    live.paired()
    live.answerBeat(Bodies.beat(200, beat("go-live", "sid" to SID, "startedBy" to "organiser"), null, Environment.STAGING))
    wires += wire(live)
    live.ready()
    live.send(Input.Connected(live.attempt!!))
    live.advance(2_000)
    assertIs<SnapshotState.Publishing>(live.state)
    wires += wire(live)
    live.send(Input.Dropped(live.attempt!!, DropReason.ENDPOINT_CLOSED, null))
    live.advance(1_000)
    wires += wire(live)
    live.send(Input.Stop)
    wires += wire(live)
    entries += live.sent<Command.Record>().map { it.entry }
    // A refused start each: a foreign ingest host; an SRT block that holds a passphrase but no latency;
    // an SRT url that carries the passphrase in its query; a passphrase libsrt refuses (SessionConfig.problems).
    // And a session shape with no cred: not the current phone, a claim and a second fetch.
    val foreign = JSONObject(base).also { it.getJSONObject("cred").getJSONObject("srt").put("url", "srt://live.cloudflare.com.evil.example:778") }
    val unread = JSONObject(base).also { it.getJSONObject("cred").getJSONObject("srt").remove("latencyMs") }
    val query = JSONObject(base).also { it.getJSONObject("cred").getJSONObject("srt").put("url", "srt://live.stg.seazn.club:778?passphrase=${Configs.PASSPHRASE}") }
    val short = JSONObject(base).also { it.getJSONObject("cred").getJSONObject("srt").put("passphrase", SHORT) }
    val notCurrent = JSONObject(base).also { it.remove("cred") }
    for (body in listOf(foreign, unread, query, short, notCurrent)) {
      val rig = MachineRig()
      rig.codes = { if (rig.phase is Phase.Arming) Bodies.code(200, body.toString(), null, Environment.STAGING) else null }
      rig.paired()
      rig.answerBeat(Bodies.beat(200, beat("go-live", "sid" to SID, "startedBy" to "organiser"), null, Environment.STAGING))
      wires += wire(rig)
      entries += rig.sent<Command.Record>().map { it.entry }
    }
    // Each path reached the line that would carry a leak.
    for (kind in listOf("armed", "cred-host-refused", "code-unreadable", "start-failed", "not-current")) assertTrue(entries.any { it.kind == kind }, kind)
    // Four refused starts, two of them unreadable; the fourth, the problems() path, has no line of its own.
    val counts = listOf("start-failed", "code-unreadable", "cred-host-refused", "not-current").map { kind -> entries.count { it.kind == kind } }
    assertEquals(listOf(4, 2, 1, 1), counts)
    assertTrue(wires.any { "\"broadcast\":{" in it }, "a snapshot that carried the broadcast")
    for (entry in entries) {
      for ((key, value) in entry.fields) {
        val text = value?.toString() ?: continue
        for (secret in SECRETS + SHORT) assertFalse(secret in text, "${entry.kind}.$key")
        // The stream id is a path segment of the public playback URL, and only there (the scrub's notInUrls).
        if (key != "playbackUrl") assertFalse(Configs.STREAM_ID in text, "${entry.kind}.$key")
      }
    }
    for (json in wires) {
      for (secret in SECRETS + SHORT) assertFalse(secret in json, json)
      assertFalse(Configs.STREAM_ID in json.replace(Configs.PLAYBACK_URL, ""), json)
    }
  }

  /** An answer as the session vectors' `expected` names it. */
  private fun decisive(answer: CodeAnswer): Map<String, Any?> =
    when (answer) {
      is CodeAnswer.Open ->
        mapOf(
          "answer" to "open",
          "sid" to answer.sid,
          "primary" to answer.descriptor.primary.transport.wire,
          "fallback" to answer.descriptor.fallback?.transport?.wire,
          "srtOffered" to answer.descriptor.srtOffered,
          "scoreUpdates" to answer.descriptor.scoreUpdates,
          "overlayUrl" to answer.descriptor.overlayUrl,
        )
      is CodeAnswer.Over -> mapOf("answer" to "over", "sid" to answer.sid, "endReason" to answer.endReason)
      is CodeAnswer.NotCurrent -> mapOf("answer" to "not-current", "sid" to answer.sid)
      is CodeAnswer.ForeignIngest -> mapOf("answer" to "foreign-ingest", "sid" to answer.sid)
      is CodeAnswer.Waiting -> mapOf("answer" to "waiting")
      is CodeAnswer.Unreadable -> mapOf("answer" to "unreadable", "problem" to answer.problem)
      is CodeAnswer.Unreachable -> mapOf("answer" to "unreachable", "message" to answer.message)
      is CodeAnswer.Status -> mapOf("answer" to "status", "status" to answer.status)
    }

  private fun body(case: JSONObject): String {
    val body = JSONObject(base)
    val override = case.getJSONObject("override")
    for (key in override.keySet()) body.put(key, override.get(key))
    val remove = case.optJSONArray("remove")
    if (remove != null) for (i in 0 until remove.length()) body.remove(remove.getString(i))
    return body.toString()
  }

  private fun MachineRig.answerBeat(answered: HeartbeatResponse) {
    repeat(240) { if (phase.beating?.heartbeat?.inFlightId == null) advance(500) }
    send(Input.HeartbeatAnswered(phase.beating!!.heartbeat.inFlightId!!, answered))
  }

  /** A beat's answer that [Bodies.beat] read as an answer (any status but a 2xx that is no JSON object). */
  private fun answeredBeat(status: Int, body: String): HeartbeatResponse.Answered = assertIs<HeartbeatResponse.Answered>(Bodies.beat(status, body, null, Environment.STAGING))

  private fun wire(rig: MachineRig): String = WireJson.encode(SnapshotWire.of(rig.snapshot, PlatformFacts(), RecordCounters(0, 0)))

  private companion object {
    const val SID = "3f9a2c7e-8b14-4d5e-a6f7-0c1d2e3f4a5b"
    const val OTHER = "7e2f9c1d-5b3a-4d4e-8f60-1b2c3d4e5f60"
    val NO_REPLY = BeatReply(null, null, null, null, null)

    /** A captive portal's sign-in page, answered 200 to any request (I1). */
    const val PORTAL = "<!doctype html><html><body><form action=\"/login\">Sign in to Ground Wi-Fi</form></body></html>"

    /** A made-up passphrase of 9 characters: Bodies reads it, and SessionConfig.problems refuses it (libsrt wants 10 to 79). */
    const val SHORT = "pw-3e7a91"

    /** The passphrase and the key, their URL-encoded forms, and the full ingest URLs that carry them. */
    val SECRETS =
      listOf(
        Configs.PASSPHRASE,
        URLEncoder.encode(Configs.PASSPHRASE, "UTF-8"),
        Configs.STREAM_KEY,
        "rtmps://live.stg.seazn.club:443/live/${Configs.STREAM_KEY}",
        "srt://live.stg.seazn.club:778?streamid=${Configs.STREAM_ID}",
      )

    /** A beat's 200, shaped as capture-beat.v1's answer: [fields] and the common fields. */
    fun beat(state: String, vararg fields: Pair<String, Any?>): String =
      WireJson.encode(
        linkedMapOf<String, Any?>("state" to state) +
          fields +
          linkedMapOf("label" to "L", "scheduledStart" to null, "autoAllowed" to true, "destinationName" to null, "overlayUrl" to null, "pollSeconds" to 10.0)
      )

    /** A refusal body, as `$defs.refusal` shapes it. */
    fun refusal(code: String): String = """{"code":"$code","message":"m"}"""

    /** A 410 shaped as the server's refusal, with an [endReason]. Neither route sends one (ask 8); the word is made up. */
    fun gone410(endReason: String): String = """{"code":"gone","message":"m","endReason":"$endReason"}"""
  }
}
