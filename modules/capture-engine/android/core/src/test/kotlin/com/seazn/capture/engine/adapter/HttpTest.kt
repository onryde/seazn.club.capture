package com.seazn.capture.engine.adapter

import com.seazn.capture.engine.core.*
import java.io.IOException
import java.io.InterruptedIOException
import java.net.SocketTimeoutException
import java.net.UnknownHostException
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertIs
import kotlin.test.assertNull
import kotlin.test.assertTrue

class HttpTest {
  private val fetch = Command.FetchCode(12, CODE_URL, Configs.TOKEN, Configs.PHONE_ID, 1, Environment.STAGING)
  private val beat = Command.PostHeartbeat(7, BEATS_URL, Configs.TOKEN, BEAT_BODY)
  private val post = Command.PostStart(4, START_URL, Configs.TOKEN, """{"phone":"${Configs.PHONE_ID}"}""")

  /** An open session shape, `cred` on staging's ingest host (the shared vectors' base). */
  private val session = Shared.read("wire/session-vectors.json").getJSONObject("base").toString()

  @Test
  fun `F-P5-13 every playlist fetch is fresh`() {
    val command = Command.FetchPlaylist(3, Configs.PLAYBACK_URL)
    val request = HttpRequests.playlist(command)
    assertEquals("GET", request.method)
    assertEquals(Configs.PLAYBACK_URL, request.url)
    // Exactly these: no cache may answer, and the code's bearer never goes to Cloudflare.
    assertEquals(listOf("Cache-Control" to "no-cache", "Pragma" to "no-cache"), request.headers)
    assertNull(request.body)
    // A second identical fetch is built fresh again: the builder keeps nothing between calls.
    assertEquals(listOf("Cache-Control" to "no-cache", "Pragma" to "no-cache"), HttpRequests.playlist(command).headers)
  }

  @Test
  fun `carry 20 a 204 maps to NoContent although OkHttp counts it successful`() {
    assertEquals(Input.PlaylistFetched(3, FetchResult.NoContent), HttpAnswers.playlist(3, HttpOutcome.Answered(204, "")))
    // A body on a 204 is not read: the status says no variant is live.
    assertEquals(FetchResult.NoContent, HttpAnswers.playlist(3, HttpOutcome.Answered(204, "#EXTM3U")).result)
  }

  @Test
  fun `a 2xx with a body is the body, any other status is an HTTP error, and IO is a failure`() {
    assertEquals(FetchResult.Body("#EXTM3U"), HttpAnswers.playlist(1, HttpOutcome.Answered(200, "#EXTM3U")).result)
    assertEquals(FetchResult.Body("#EXTM3U"), HttpAnswers.playlist(1, HttpOutcome.Answered(299, "#EXTM3U")).result)
    for (status in listOf(199, 300, 304, 401, 403, 404, 429, 500, 503)) {
      assertEquals(FetchResult.HttpError(status), HttpAnswers.playlist(1, HttpOutcome.Answered(status, "denied", retryAfter = "30")).result, "$status")
    }
    assertEquals(FetchResult.Failed("timeout"), HttpAnswers.playlist(1, HttpOutcome.Failed("timeout")).result)
  }

  @Test
  fun `the watch reads a 204 as nothing live, and a 403, a portal's page or an empty 200 as no evidence`() {
    // Publishing, the head frozen for the whole not-delivered span, and the master asked for.
    val pending = PlaylistRequest(1, DeliveryWatch.hinted(Configs.PLAYBACK_URL))
    val frozen = DeliveryWatch(Configs.PLAYBACK_URL, pending = pending, onAir = true, sinceAdvanceMs = DeliveryWatch.NOT_DELIVERED_MS)
    val nothingLive = frozen.fetched(1, HttpAnswers.playlist(1, HttpOutcome.Answered(204, "")).result, 0).third
    assertEquals(NotDeliveredCause.STALLED, nothingLive?.cause)
    val noEvidence =
      listOf(HttpOutcome.Answered(403, "denied"), HttpOutcome.Answered(401, ""), HttpOutcome.Answered(200, PORTAL), HttpOutcome.Answered(200, ""), HttpOutcome.Failed("reset"))
    for (outcome in noEvidence) {
      val (watch, asked, verdict) = frozen.fetched(1, HttpAnswers.playlist(1, outcome).result, 0)
      assertNull(verdict, "$outcome")
      assertEquals(Delivery.UNKNOWN, watch.delivery, "$outcome")
      assertTrue(asked.isEmpty(), "$outcome")
    }
  }

  @Test
  fun `the heartbeat carries the bearer and its body, no-store`() {
    val request = HttpRequests.heartbeat(beat)
    assertEquals("POST", request.method)
    assertEquals("https://stg.seazn.club/api/v1/capture/codes/fx42hmnp7k2q/beats", request.url)
    assertEquals(listOf("Authorization" to "Bearer ${Configs.TOKEN}", "Content-Type" to "application/json", "Cache-Control" to "no-store"), request.headers)
    assertEquals(BEAT_BODY, request.body)
  }

  @Test
  fun `a heartbeat answer is read by Bodies, its Retry-After with it`() {
    val answered = HttpAnswers.heartbeat(7, HttpOutcome.Answered(200, """{"state":"over","sid":"$SID","endReason":"phone_lost"}"""), Environment.STAGING)
    assertEquals(7, answered.beatId)
    val reply = assertIs<HeartbeatResponse.Answered>(answered.response).reply
    assertEquals(SID, reply?.sid)
    assertEquals("phone_lost", reply?.endReason)
    val busy = HttpAnswers.heartbeat(8, HttpOutcome.Answered(429, "", retryAfter = "30"), Environment.STAGING)
    assertEquals(HeartbeatResponse.Answered(429, NO_REPLY, 30), busy.response)
    // Only a 429 keeps it, and only as whole seconds.
    assertEquals(HeartbeatResponse.Answered(503, NO_REPLY, null), HttpAnswers.heartbeat(8, HttpOutcome.Answered(503, "", retryAfter = "30"), Environment.STAGING).response)
    val dated = HttpOutcome.Answered(429, "", retryAfter = "Wed, 21 Oct 2026 07:28:00 GMT")
    assertEquals(HeartbeatResponse.Answered(429, NO_REPLY, null), HttpAnswers.heartbeat(8, dated, Environment.STAGING).response)
    assertEquals(Input.HeartbeatAnswered(9, HeartbeatResponse.Failed("reset")), HttpAnswers.heartbeat(9, HttpOutcome.Failed("reset"), Environment.STAGING))
  }

  @Test
  fun `a beat's 401 and 404 are answers only as the server's refusals, a 403 always, and a portal's page or an empty 2xx is none`() {
    // X1: a 401 or 404 with no refusal body is not the server's word, and ends nothing.
    for (status in listOf(401, 404)) {
      assertEquals(HeartbeatResponse.Failed("$status-not-refusal"), HttpAnswers.heartbeat(9, HttpOutcome.Answered(status, ""), Environment.STAGING).response, "$status")
    }
    assertEquals(HeartbeatResponse.Answered(403, NO_REPLY, null), HttpAnswers.heartbeat(9, HttpOutcome.Answered(403, ""), Environment.STAGING).response)
    val ended = HttpAnswers.heartbeat(9, HttpOutcome.Answered(401, refusal("code_ended")), Environment.STAGING)
    assertEquals(ServerWord.CodeEnded, ServerWord.ofBeat(ended.response, named = SID))
    val notFound = HttpAnswers.heartbeat(9, HttpOutcome.Answered(404, refusal("not_a_stream_code")), Environment.STAGING)
    assertEquals(ServerWord.NotFound, ServerWord.ofBeat(notFound.response, named = SID))
    val denied = HttpAnswers.heartbeat(9, HttpOutcome.Answered(403, "denied"), Environment.STAGING)
    assertEquals(ServerWord.NoEvidence, ServerWord.ofBeat(denied.response, named = SID))
    for (outcome in listOf(HttpOutcome.Answered(200, PORTAL), HttpOutcome.Answered(200, ""), HttpOutcome.Answered(204, ""))) {
      assertEquals(Input.HeartbeatAnswered(9, HeartbeatResponse.Failed("not-json")), HttpAnswers.heartbeat(9, outcome, Environment.STAGING), "$outcome")
    }
  }

  @Test
  fun `D3 and G0-d the code is fetched at its path with its slot and the phone's id, with the bearer, never cached`() {
    val request = HttpRequests.code(fetch)
    assertEquals("GET", request.method)
    assertEquals("https://stg.seazn.club/api/v1/capture/codes/fx42hmnp7k2q?slot=1&phone=phone-7f1e0c2a9b3d", request.url)
    assertEquals(listOf("Authorization" to "Bearer ${Configs.TOKEN}", "Accept" to "application/json", "Cache-Control" to "no-store"), request.headers)
    assertNull(request.body)
  }

  @Test
  fun `G0-d slot 0 is sent, never left to the server's default`() {
    assertEquals("https://stg.seazn.club/api/v1/capture/codes/fx42hmnp7k2q?slot=0&phone=phone-7f1e0c2a9b3d", HttpRequests.code(fetch.copy(slot = 0)).url)
    assertEquals("https://stg.seazn.club/api/v1/capture/codes/fx42hmnp7k2q?slot=3&phone=phone-7f1e0c2a9b3d", HttpRequests.code(fetch.copy(slot = 3)).url)
  }

  @Test
  fun `a phone id is query-encoded, whatever it holds`() {
    // Off the schema on purpose: the encoding is under test, not the id's rules.
    assertEquals("$CODE_URL?slot=1&phone=a%20b%26c", HttpRequests.code(fetch.copy(phoneId = "a b&c")).url)
    assertEquals("$CODE_URL?slot=1&phone=%2B%3D%23%3F%2F%C3%A9", HttpRequests.code(fetch.copy(phoneId = "+=#?/é")).url)
  }

  @Test
  fun `carry 17 the code's answer echoes its request id, read by Bodies against the pairing's environment`() {
    val gone = HttpAnswers.code(12, HttpOutcome.Answered(410, GONE), Environment.STAGING)
    assertEquals(Input.CodeAnswered(12, CodeAnswer.Status(410, null, "stopped")), gone)
    // N1: an endReason alone is not the server's refusal, so it ends nothing.
    assertEquals(Input.CodeAnswered(11, CodeAnswer.Unreachable("410-not-refusal")), HttpAnswers.code(11, HttpOutcome.Answered(410, """{"endReason":"stopped"}"""), Environment.STAGING))
    assertEquals(Input.CodeAnswered(13, CodeAnswer.Unreachable("dns")), HttpAnswers.code(13, HttpOutcome.Failed("dns"), Environment.STAGING))
    // The pairing's environment reaches Bodies; both environments open the same session shape.
    val open = HttpAnswers.code(14, HttpOutcome.Answered(200, session), Environment.STAGING)
    assertEquals(14, open.requestId)
    assertEquals(SID, assertIs<CodeAnswer.Open>(open.answer).sid)
    val production = HttpAnswers.code(15, HttpOutcome.Answered(200, session), Environment.PRODUCTION)
    assertEquals(15, production.requestId)
    val opened = assertIs<CodeAnswer.Open>(production.answer)
    assertEquals(SID, opened.sid)
  }

  @Test
  fun `the code's 401, 403, 429 and 5xx keep their status, and a portal's page, an empty 200 or a 204 is no answer`() {
    fun code(id: Int, outcome: HttpOutcome) = HttpAnswers.code(id, outcome, Environment.STAGING)
    assertEquals(Input.CodeAnswered(20, CodeAnswer.Status(401, null, null)), code(20, HttpOutcome.Answered(401, refusal("code_ended"))))
    assertEquals(Input.CodeAnswered(27, CodeAnswer.Status(404, null, null)), code(27, HttpOutcome.Answered(404, refusal("not_a_stream_code"))))
    // X1: an edge's 401 or 404 page is not the server's refusal: no answer, fetched again.
    assertEquals(Input.CodeAnswered(28, CodeAnswer.Unreachable("401-not-refusal")), code(28, HttpOutcome.Answered(401, PORTAL)))
    assertEquals(Input.CodeAnswered(29, CodeAnswer.Unreachable("404-not-refusal")), code(29, HttpOutcome.Answered(404, "")))
    assertEquals(Input.CodeAnswered(21, CodeAnswer.Status(403, null, null)), code(21, HttpOutcome.Answered(403, "")))
    assertEquals(Input.CodeAnswered(22, CodeAnswer.Status(429, 30, null)), code(22, HttpOutcome.Answered(429, "", retryAfter = "30")))
    assertEquals(Input.CodeAnswered(23, CodeAnswer.Status(503, null, null)), code(23, HttpOutcome.Answered(503, "", retryAfter = "30")))
    val none = listOf(24 to HttpOutcome.Answered(200, PORTAL), 25 to HttpOutcome.Answered(200, ""), 26 to HttpOutcome.Answered(204, ""))
    for ((id, outcome) in none) assertEquals(Input.CodeAnswered(id, CodeAnswer.Unreachable("not-json")), code(id, outcome), "$outcome")
  }

  @Test
  fun `a second identical ask is answered on its own id, on every endpoint`() {
    val outcome = HttpOutcome.Answered(503, "")
    assertEquals(listOf(31, 32), listOf(31, 32).map { HttpAnswers.playlist(it, outcome).requestId })
    assertEquals(listOf(33, 34), listOf(33, 34).map { HttpAnswers.heartbeat(it, outcome, Environment.STAGING).beatId })
    assertEquals(listOf(35, 36), listOf(35, 36).map { HttpAnswers.code(it, outcome, Environment.STAGING).requestId })
    assertEquals(listOf(37, 38), listOf(37, 38).map { HttpAnswers.start(it, outcome).requestId })
  }

  @Test
  fun `POST start carries the bearer and the phone, no-store, and its answer its id`() {
    val request = HttpRequests.start(post)
    assertEquals("POST", request.method)
    assertEquals("https://stg.seazn.club/api/v1/capture/codes/fx42hmnp7k2q/start", request.url)
    assertEquals(listOf("Authorization" to "Bearer ${Configs.TOKEN}", "Content-Type" to "application/json", "Cache-Control" to "no-store"), request.headers)
    assertEquals("""{"phone":"phone-7f1e0c2a9b3d"}""", request.body)
    assertEquals(Input.StartAnswered(4, StartAnswer.Started(SID)), HttpAnswers.start(4, HttpOutcome.Answered(200, """{"sid":"$SID"}""")))
    assertEquals(Input.StartAnswered(5, StartAnswer.Failed("no answer: reset")), HttpAnswers.start(5, HttpOutcome.Failed("reset")))
  }

  @Test
  fun `start's 401 ends the code, a 403 is its refusal, a 429 fails, and a portal's page, an empty 200 or a 204 is no answer`() {
    fun start(outcome: HttpOutcome) = HttpAnswers.start(6, outcome).answer
    assertEquals(StartAnswer.CodeEnded, start(HttpOutcome.Answered(401, refusal("code_ended"))))
    // X1: only the server's code_ended ends the code. An edge's 401 page fails the start, the operator's to try again.
    assertEquals(StartAnswer.Failed("401-not-refusal"), start(HttpOutcome.Answered(401, PORTAL)))
    // A start's 404 ends nothing, refusal or not.
    assertEquals(StartAnswer.Failed("404"), start(HttpOutcome.Answered(404, refusal("not_a_stream_code"))))
    assertEquals(StartAnswer.Failed("404"), start(HttpOutcome.Answered(404, PORTAL)))
    assertEquals(StartAnswer.Refused(Refusal.NOT_ENTITLED, "m"), start(HttpOutcome.Answered(403, """{"code":"not_entitled","message":"m"}""")))
    assertEquals(StartAnswer.Failed("403"), start(HttpOutcome.Answered(403, "")))
    // A start is the operator's to try again: a 429 fails it, and its Retry-After is not kept.
    assertEquals(StartAnswer.Failed("429"), start(HttpOutcome.Answered(429, """{"code":"rate_limited","message":"m"}""", retryAfter = "30")))
    for (outcome in listOf(HttpOutcome.Answered(200, PORTAL), HttpOutcome.Answered(200, ""), HttpOutcome.Answered(204, ""))) {
      assertEquals(StartAnswer.Failed("not-json"), start(outcome), "$outcome")
    }
  }

  @Test
  fun `C0b a timeout, a reset or any throw is an answer on every endpoint, named by its class alone`() {
    val thrown =
      listOf(
        SocketTimeoutException("timeout") to "SocketTimeoutException",
        InterruptedIOException("timeout") to "InterruptedIOException",
        IOException("unexpected end of stream") to "IOException",
        UnknownHostException("stg.seazn.club") to "UnknownHostException",
        IllegalStateException("closed") to "IllegalStateException",
        // Review 16 m3: an anonymous class has no simple name; its nearest named class stands in, never "".
        object : IOException("cut") {} to "IOException",
      )
    for ((failure, name) in thrown) {
      val outcome = HttpOutcome.failed(failure)
      assertEquals(HttpOutcome.Failed(name), outcome)
      assertEquals(Input.StartAnswered(4, StartAnswer.Failed("no answer: $name")), HttpAnswers.start(4, outcome))
      assertEquals(Input.CodeAnswered(12, CodeAnswer.Unreachable(name)), HttpAnswers.code(12, outcome, Environment.STAGING))
      assertEquals(Input.HeartbeatAnswered(7, HeartbeatResponse.Failed(name)), HttpAnswers.heartbeat(7, outcome, Environment.STAGING))
      assertEquals(Input.PlaylistFetched(3, FetchResult.Failed(name)), HttpAnswers.playlist(3, outcome))
    }
  }

  @Test
  fun `C0b a start that timed out frees the hold - the operator's next hold posts again`() {
    val rig = readyRig()
    rig.starts = { id -> HttpAnswers.start(id, HttpOutcome.failed(SocketTimeoutException("timeout"))).answer }
    rig.send(Input.Start)
    assertEquals(Refusal.START_FAILED, assertIs<Phase.Paired>(rig.phase).pairing.refusal)
    rig.send(Input.Start)
    assertEquals(2, rig.sent<Command.PostStart>().size)
  }

  @Test
  fun `N1 an edge's 410 on a live beat leaves the broadcast on air, and the server's 410 refusal ends it`() {
    for (page in NOT_REFUSALS_410) {
      val rig = MachineRig().live()
      rig.send(HttpAnswers.heartbeat(inFlight(rig), HttpOutcome.Answered(410, page), Environment.STAGING))
      assertIs<Phase.OnAir>(rig.phase, page)
      assertTrue(rig.sent<Command.StopBroadcast>().isEmpty(), page)
    }
    val rig = MachineRig().live()
    rig.send(HttpAnswers.heartbeat(inFlight(rig), HttpOutcome.Answered(410, GONE), Environment.STAGING))
    assertEquals(LastEnd.STOPPED_BY_ORGANISER, assertIs<Phase.Paired>(rig.phase).pairing.lastEnd)
    assertEquals(1, rig.sent<Command.StopBroadcast>().size)
  }

  @Test
  fun `N1 an edge's 410 on a Paired beat keeps the stopped record, and the server's 410 refusal delivers it`() {
    for (page in NOT_REFUSALS_410) {
      val (rig, id) = pairedWithRecord()
      rig.send(HttpAnswers.heartbeat(id, HttpOutcome.Answered(410, page), Environment.STAGING))
      assertEquals(RECORD, assertIs<Phase.Paired>(rig.phase, page).pairing.stopped, page)
      assertTrue(rig.sent<Command.DeleteStopped>().isEmpty(), page)
    }
    val (rig, id) = pairedWithRecord()
    rig.send(HttpAnswers.heartbeat(id, HttpOutcome.Answered(410, GONE), Environment.STAGING))
    assertNull(assertIs<Phase.Paired>(rig.phase).pairing.stopped)
    assertEquals(listOf(Command.DeleteStopped(CODE, 1)), rig.sent<Command.DeleteStopped>())
  }

  @Test
  fun `N1 an edge's 410 on GET code at Arming fetches again, and the server's 410 refusal ends S with its endReason`() {
    for (page in NOT_REFUSALS_410) {
      val rig = armingRig()
      rig.send(HttpAnswers.code(asked(rig), HttpOutcome.Answered(410, page), Environment.STAGING))
      assertTrue(assertIs<Phase.Arming>(rig.phase, page).retrying, page)
    }
    val rig = armingRig()
    rig.send(HttpAnswers.code(asked(rig), HttpOutcome.Answered(410, GONE), Environment.STAGING))
    assertEquals(LastEnd.STOPPED_BY_ORGANISER, assertIs<Phase.Paired>(rig.phase).pairing.lastEnd)
  }

  @Test
  fun `a 3xx is transient on every endpoint, whatever its body - never the server's word`() {
    // Review 16, I1: a portal's page and a body shaped as the server's, under each redirect status.
    val over = """{"state":"over","sid":"$SID"}"""
    val media = "#EXTM3U\n#EXT-X-TARGETDURATION:2\n#EXT-X-MEDIA-SEQUENCE:1\n#EXTINF:2.000,\nseg1.ts\n"
    var rows = 0
    for (status in listOf(301, 302, 303, 307, 308)) {
      for (body in listOf(PORTAL, media)) {
        assertEquals(FetchResult.HttpError(status), HttpAnswers.playlist(1, HttpOutcome.Answered(status, body)).result, "$status")
        rows += 1
      }
      for (body in listOf(PORTAL, session)) {
        assertEquals(CodeAnswer.Status(status, null, null), HttpAnswers.code(2, HttpOutcome.Answered(status, body), Environment.STAGING).answer, "$status")
        rows += 1
      }
      for ((body, reply) in listOf(PORTAL to NO_REPLY, over to BeatReply("over", SID, null, null, null))) {
        val response = HttpAnswers.heartbeat(3, HttpOutcome.Answered(status, body), Environment.STAGING).response
        assertEquals(HeartbeatResponse.Answered(status, reply, null), response, "$status")
        assertEquals(ServerWord.NoEvidence, ServerWord.ofBeat(response, named = SID), "$status")
        rows += 1
      }
      for (body in listOf(PORTAL, """{"sid":"$SID"}""")) {
        assertEquals(StartAnswer.Failed("$status"), HttpAnswers.start(4, HttpOutcome.Answered(status, body)).answer, "$status")
        rows += 1
      }
    }
    assertEquals(40, rows)
  }

  @Test
  fun `a beat's 302 with an over body at Paired keeps the claim, the stopped record and the phase, and counts a failure`() {
    val (rig, id) = pairedWithRecord()
    rig.send(HttpAnswers.heartbeat(id, HttpOutcome.Answered(302, """{"state":"over","sid":"$STOPPED_SID"}"""), Environment.STAGING))
    val pairing = assertIs<Phase.Paired>(rig.phase).pairing
    // SessionMachine's 2xx test for the claim: a 3xx read as 2xx would clear it.
    assertEquals(Claim.NEW, pairing.claim)
    // StoppedRecord.delivered: a 3xx read as delivered would delete the record.
    assertEquals(RECORD, pairing.stopped)
    assertTrue(rig.sent<Command.DeleteStopped>().isEmpty())
    // Heartbeat's 2xx test and ServerWord.ofBeat's: an OK or a session-over answer counts no failure.
    assertEquals(1, pairing.heartbeat.consecutiveFailures)
  }

  @Test
  fun `the code's 302 with an open session at Arming stays Arming, fetching again, S not refused`() {
    val rig = armingRig()
    rig.send(HttpAnswers.code(asked(rig), HttpOutcome.Answered(302, session), Environment.STAGING))
    val arming = assertIs<Phase.Arming>(rig.phase)
    assertTrue(arming.retrying)
    assertTrue(SID !in arming.pairing.refused)
    assertNull(arming.pairing.startFailed)
  }

  @Test
  fun `X1 an edge's 401 on GET code at Arming keeps the code and fetches again, and the server's code_ended forgets it`() {
    for (page in NOT_REFUSALS) {
      val rig = armingRig()
      rig.send(HttpAnswers.code(asked(rig), HttpOutcome.Answered(401, page), Environment.STAGING))
      assertTrue(assertIs<Phase.Arming>(rig.phase, page).retrying, page)
      rig.advance(10_000)
      assertEquals(2, rig.sent<Command.FetchCode>().size, page)
    }
    val rig = armingRig()
    rig.send(HttpAnswers.code(asked(rig), HttpOutcome.Answered(401, refusal("code_ended")), Environment.STAGING))
    assertEquals(UnpairReason.CODE_ENDED, assertIs<Phase.Idle>(rig.phase).unpaired?.reason)
  }

  @Test
  fun `X1 an edge's 401 on a beat keeps the code and the stopped record, and the next beat goes - the server's code_ended forgets both`() {
    for (page in NOT_REFUSALS) {
      val (rig, id) = pairedWithRecord()
      rig.send(HttpAnswers.heartbeat(id, HttpOutcome.Answered(401, page), Environment.STAGING))
      assertEquals(RECORD, assertIs<Phase.Paired>(rig.phase, page).pairing.stopped, page)
      assertTrue(rig.sent<Command.DeleteStopped>().isEmpty(), page)
      assertTrue(inFlight(rig) > id, page)
    }
    val (rig, id) = pairedWithRecord()
    rig.send(HttpAnswers.heartbeat(id, HttpOutcome.Answered(401, refusal("code_ended")), Environment.STAGING))
    assertEquals(UnpairReason.CODE_ENDED, assertIs<Phase.Idle>(rig.phase).unpaired?.reason)
    assertEquals(listOf(Command.DeleteStopped(CODE, 1)), rig.sent<Command.DeleteStopped>())
  }

  @Test
  fun `X1 an edge's 401 on POST start keeps the code, and the next hold posts again - the server's code_ended forgets it`() {
    for (page in NOT_REFUSALS) {
      val rig = readyRig()
      rig.starts = { id -> HttpAnswers.start(id, HttpOutcome.Answered(401, page)).answer }
      rig.send(Input.Start)
      assertEquals(StartFailure.START_ERROR, assertIs<Phase.Paired>(rig.phase, page).pairing.startFailed, page)
      rig.send(Input.Start)
      assertEquals(2, rig.sent<Command.PostStart>().size, page)
    }
    val rig = readyRig()
    rig.starts = { id -> HttpAnswers.start(id, HttpOutcome.Answered(401, refusal("code_ended"))).answer }
    rig.send(Input.Start)
    assertEquals(UnpairReason.CODE_ENDED, assertIs<Phase.Idle>(rig.phase).unpaired?.reason)
  }

  @Test
  fun `X1 an edge's 404 on GET code or a beat at Arming keeps S, and the server's not_a_stream_code refuses it`() {
    for (page in NOT_REFUSALS) {
      val fetched = armingRig()
      fetched.send(HttpAnswers.code(asked(fetched), HttpOutcome.Answered(404, page), Environment.STAGING))
      assertTrue(assertIs<Phase.Arming>(fetched.phase, page).retrying, page)
      val beaten = armingRig()
      beaten.send(HttpAnswers.heartbeat(inFlight(beaten), HttpOutcome.Answered(404, page), Environment.STAGING))
      assertTrue(SID !in assertIs<Phase.Arming>(beaten.phase, page).pairing.refused, page)
    }
    val fetched = armingRig()
    fetched.send(HttpAnswers.code(asked(fetched), HttpOutcome.Answered(404, refusal("not_a_stream_code")), Environment.STAGING))
    assertEquals(StartFailure.NOT_FOUND, assertIs<Phase.Paired>(fetched.phase).pairing.startFailed)
    val beaten = armingRig()
    beaten.send(HttpAnswers.heartbeat(inFlight(beaten), HttpOutcome.Answered(404, refusal("not_a_stream_code")), Environment.STAGING))
    assertEquals(StartFailure.NOT_FOUND, assertIs<Phase.Paired>(beaten.phase).pairing.startFailed)
  }

  @Test
  fun `a start's 404 ends nothing, refusal or not - a start error, and the next hold posts again`() {
    for (body in NOT_REFUSALS + refusal("not_a_stream_code")) {
      val rig = readyRig()
      rig.starts = { id -> HttpAnswers.start(id, HttpOutcome.Answered(404, body)).answer }
      rig.send(Input.Start)
      assertEquals(StartFailure.START_ERROR, assertIs<Phase.Paired>(rig.phase, body).pairing.startFailed, body)
      rig.send(Input.Start)
      assertEquals(2, rig.sent<Command.PostStart>().size, body)
    }
  }

  @Test
  fun `the client's timeout is under each of the core's give-ups`() {
    assertEquals(8_000L, HttpRequests.TIMEOUT_MS)
    // The core abandons a beat and a playlist fetch at 10 s and a code fetch at 30 s; a start never.
    // That the client answers by then is the glue's call timeout (Task 33), not proven here.
    assertTrue(HttpRequests.TIMEOUT_MS < Heartbeat.TIMEOUT_MS)
    assertTrue(HttpRequests.TIMEOUT_MS < DeliveryWatch.REQUEST_TIMEOUT_MS)
    assertTrue(HttpRequests.TIMEOUT_MS < DescriptorAsks.GIVE_UP_MS)
  }

  @Test
  fun `no request prints its bearer, its code, its phone or its body`() {
    val requests = listOf(HttpRequests.playlist(Command.FetchPlaylist(3, Configs.PLAYBACK_URL)), HttpRequests.heartbeat(beat), HttpRequests.code(fetch), HttpRequests.start(post))
    for (request in requests) {
      val printed = request.toString()
      // Not vacuous: the method and the header names are printed.
      assertTrue(printed.startsWith("HttpRequest(${request.method}"), printed)
      for ((name, _) in request.headers) assertTrue(name in printed, printed)
      for (secret in SECRETS) assertFalse(secret in printed, "${request.method} ${request.headers.map { it.first }} prints a secret")
    }
  }

  @Test
  fun `no outcome prints its body, and no thrown message reaches an answer`() {
    val open = HttpOutcome.Answered(200, session, retryAfter = "30")
    assertTrue(open.toString().startsWith("Answered(status=200"), "$open")
    for (secret in CRED) assertFalse(secret in open.toString(), "the outcome prints cred")
    for (secret in CRED) assertFalse(secret in HttpAnswers.code(12, open, Environment.STAGING).toString(), "the answer prints cred")
    // A client's message may name the URL, the bearer or the body. None of it reaches an answer or the record.
    val leaky = IOException("unexpected end of stream on $CODE_URL?slot=1&phone=${Configs.PHONE_ID} Bearer ${Configs.TOKEN} $BEAT_BODY")
    val outcome = HttpOutcome.failed(leaky)
    val answers = listOf(outcome, HttpAnswers.playlist(3, outcome), HttpAnswers.heartbeat(7, outcome, Environment.STAGING), HttpAnswers.code(12, outcome, Environment.STAGING), HttpAnswers.start(4, outcome))
    for (answer in answers) for (secret in SECRETS) assertFalse(secret in answer.toString(), "$answer")
  }

  /** Paired with a stopped record held, the claim beat in flight carrying the record's sid (RR3). */
  private fun pairedWithRecord(): Pair<MachineRig, Int> {
    val rig = MachineRig()
    rig.send(Input.Pair(Configs.pairRequest(), Configs.PHONE, RECORD))
    rig.send(Input.Network(true))
    val id = inFlight(rig)
    assertEquals(STOPPED_SID, rig.phase.pairing?.stoppedInFlight, "the beat in flight carries the record")
    assertEquals(Claim.NEW, rig.phase.pairing?.claim, "the beat in flight is the claim")
    return rig to id
  }

  /** Arming for [SID] after the organiser's go-live, its code fetch left in flight. */
  private fun armingRig(): MachineRig {
    val rig = MachineRig().paired()
    rig.codes = null
    rig.hear("go-live", sid = SID, startedBy = "organiser")
    assertIs<Phase.Arming>(rig.phase)
    return rig
  }

  /** Paired, waiting and ready: the operator's hold posts start. */
  private fun readyRig(): MachineRig {
    val rig = MachineRig().paired()
    rig.hear("waiting")
    rig.ready()
    return rig
  }

  private fun asked(rig: MachineRig): Int = rig.sent<Command.FetchCode>().last().requestId

  /** The id of the beat in flight, ticking until one is. */
  private fun inFlight(rig: MachineRig): Int {
    repeat(240) {
      rig.phase.beating?.heartbeat?.inFlightId?.let { return it }
      rig.advance(500)
    }
    error("no beat in flight in ${rig.phase.name}")
  }

  private companion object {
    // capture-beat.v1's sid pattern and the 12-character codes (review 15, I3): no `sess_42`, no `fx-42`.
    const val SID = "3f9a2c7e-8b14-4d5e-a6f7-0c1d2e3f4a5b"
    const val STOPPED_SID = "7e2f9c1d-5b3a-4d4e-8f60-1b2c3d4e5f60"
    const val CODE = "fx42hmnp7k2q"

    /** A broadcast this phone stopped before its first frame (A17), for this code and slot. */
    val RECORD = StoppedRecord.of(Configs.pairRequest().name, STOPPED_SID, 1_790_000_000_000, null)

    /** The server's refusal body (`$defs.refusal`): its word and a developer message. */
    fun refusal(code: String): String = """{"code":"$code","message":"m"}"""

    /** A 410 shaped as the server's refusal (neither route sends one, ask 8: the word is made up), with its endReason. */
    const val GONE = """{"code":"gone","message":"m","endReason":"stopped"}"""

    /** Bodies a 410 may carry that are not the server's refusal (N1): an edge's page, nothing, an endReason with no code. */
    val NOT_REFUSALS_410 = listOf(PORTAL, "", """{"endReason":"stopped"}""")

    /** Bodies a 401 or 404 may carry that are not the server's refusal (X1): an edge's page, nothing, no code, another word. */
    val NOT_REFUSALS = listOf(PORTAL, "", """{"message":"m"}""", refusal("invalid"))

    // D3: the schema's paths.
    const val CODE_URL = "https://stg.seazn.club/api/v1/capture/codes/$CODE"
    const val BEATS_URL = "$CODE_URL/beats"
    const val START_URL = "$CODE_URL/start"

    /** In a beat's body alone, so a printed body is seen even where the code would not be. */
    const val BODY_MARK = "body-5d2c8e1a7f30"
    const val BEAT_BODY = """{"code":"$CODE","slot":1,"phone":"${Configs.PHONE_ID}","note":"$BODY_MARK"}"""

    /** A captive portal's sign-in page, answered 200 to any request (review 15, I1). */
    const val PORTAL = "<!doctype html><html><body><form action=\"/login\">Sign in to Ground Wi-Fi</form></body></html>"

    val NO_REPLY = BeatReply(null, null, null, null, null)

    /** The tok (sent as the bearer), the code, the phone's id, a body, and the playback URL's stream id. */
    val SECRETS = listOf(Configs.TOKEN, CODE, Configs.PHONE_ID, BODY_MARK, Configs.STREAM_ID)

    /** What an open session shape's `cred` holds. */
    val CRED = listOf(Configs.PASSPHRASE, Configs.STREAM_KEY, Configs.STREAM_ID)
  }
}
