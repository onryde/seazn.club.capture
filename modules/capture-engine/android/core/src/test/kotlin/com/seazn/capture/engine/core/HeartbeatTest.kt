package com.seazn.capture.engine.core

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull

/**
 * The beat's own bookkeeping. Its body's tests moved to [BeatsTest] with `Beats.payload` (PV4), and
 * what an answer means to the broadcast is the answer table's ([ServerWord], `AnswerTableTest`).
 */
class HeartbeatTest {
  @Test
  fun `the first beat is due at once, then every 10 s`() {
    var state = HeartbeatState()
    val sent = mutableListOf<Long>()
    for (t in 0L..30_000L step 500) {
      val (next, id) = Heartbeat.due(state, t, wallMs = t, intervalMs = BeatCadence.HELD_MAX_MS)
      state = next
      if (id != null) {
        sent += t
        state = Heartbeat.answered(state, id, HeartbeatResponse.Answered(200, BeatReply("live", null, null, null, null)), nowMs = t)
      }
    }
    assertEquals(listOf(0L, 10_000L, 20_000L, 30_000L), sent)
  }

  @Test
  fun `ruling 5 a 410 reads session-over`() {
    val (state, id) = Heartbeat.due(HeartbeatState(), 0, 0, intervalMs = BeatCadence.HELD_MAX_MS)
    val after = Heartbeat.answered(state, id!!, HeartbeatResponse.Answered(410, BeatReply(null, null, null, "stopped", null)), nowMs = 0)
    assertEquals(HeartbeatResult.SESSION_OVER, after.lastResult)
  }

  @Test
  fun `a 200 over naming a sid reads session-over`() {
    // The amendment's beat answer: `{state:"over", sid, endReason}` (ask 8). Plan B's descriptor states
    // (ending, completed, failed) are no beat state any more; ServerWordTest reads them as no evidence.
    val (state, id) = Heartbeat.due(HeartbeatState(), 0, 0, intervalMs = BeatCadence.HELD_MAX_MS)
    val after = Heartbeat.answered(state, id!!, HeartbeatResponse.Answered(200, BeatReply("over", "sess_42", null, "stopped", null)), nowMs = 0)
    assertEquals(HeartbeatResult.SESSION_OVER, after.lastResult)
  }

  @Test
  fun `a 200 that is live or warming is ok and clears the run of failures`() {
    val failing = HeartbeatState(consecutiveFailures = 4, failures = 4)
    for (live in listOf("live", "warming")) {
      val (state, id) = Heartbeat.due(failing, 0, 0, intervalMs = BeatCadence.HELD_MAX_MS)
      val after = Heartbeat.answered(state, id!!, HeartbeatResponse.Answered(200, BeatReply(live, null, null, null, null)), nowMs = 0)
      assertEquals(HeartbeatResult.OK, after.lastResult)
      assertEquals(0, after.consecutiveFailures)
      assertEquals(4, after.failures)
    }
  }

  @Test
  fun `a 401, a 500 and a network failure are counted and never over, and a bare 200 is ok`() {
    val responses =
      listOf(
        HeartbeatResponse.Answered(401),
        HeartbeatResponse.Answered(500),
        HeartbeatResponse.Failed("timeout"),
      )
    var state = HeartbeatState()
    var t = 0L
    for (response in responses) {
      val (sent, id) = Heartbeat.due(state, t, t, intervalMs = BeatCadence.HELD_MAX_MS)
      val after = Heartbeat.answered(sent, id!!, response, nowMs = t)
      assertEquals(HeartbeatResult.FAILED, after.lastResult, response.toString())
      state = after
      t += BeatCadence.HELD_MAX_MS
    }
    assertEquals(3, state.failures)
    assertEquals(3, state.consecutiveFailures)
    assertEquals(HeartbeatResult.FAILED, state.lastResult)
    val (sent, id) = Heartbeat.due(state, t, t, intervalMs = BeatCadence.HELD_MAX_MS)
    assertEquals(HeartbeatResult.OK, Heartbeat.answered(sent, id!!, HeartbeatResponse.Answered(200), nowMs = t).lastResult)
  }

  @Test
  fun `ruling 5 a beat that never comes back is failed at 10 s and the next one goes`() {
    val (first, id) = Heartbeat.due(HeartbeatState(), 0, 0, intervalMs = BeatCadence.HELD_MAX_MS)
    assertEquals(1, id)
    val (skipped, none) = Heartbeat.due(first, 5_000, 5_000, intervalMs = BeatCadence.HELD_MAX_MS)
    assertNull(none, "not due until 10 s: the interval holds this, since a 10 s timeout clears a beat in flight first")
    val (second, next) = Heartbeat.due(skipped, 10_000, 10_000, intervalMs = BeatCadence.HELD_MAX_MS)
    assertEquals(2, next)
    assertEquals(1, second.failures)
  }

  @Test
  fun `B7 m5 one beat in flight at most - a beat due while one is in flight and not yet given up waits`() {
    // A state `due` never makes while HELD_MAX_MS == TIMEOUT_MS: the next beat is due at 5 s (last sent
    // at -5 s), and the one in flight since 0 is not given up until 10 s. The in-flight rule alone holds the next.
    val inFlight = HeartbeatState(lastSentAtMonoMs = -5_000, inFlightId = 1, inFlightSinceMs = 0, nextId = 2)
    val (held, none) = Heartbeat.due(inFlight, 5_000, 5_000, intervalMs = BeatCadence.HELD_MAX_MS)
    assertNull(none)
    assertEquals(inFlight, held)
    val (_, next) = Heartbeat.due(inFlight, 10_000, 10_000, intervalMs = BeatCadence.HELD_MAX_MS)
    assertEquals(2, next, "given up at 10 s, the next beat goes")
  }

  @Test
  fun `a heartbeat that fails forever keeps beating every 10 s`() {
    var state = HeartbeatState()
    var sent = 0
    for (t in 0L until 1_000_000L step 500) {
      val (next, id) = Heartbeat.due(state, t, t, intervalMs = BeatCadence.HELD_MAX_MS)
      state = next
      if (id != null) sent += 1
    }
    assertEquals(100, sent)
    assertEquals(99, state.failures)
  }

  @Test
  fun `an answer to a beat already given up is ignored`() {
    val (first, id) = Heartbeat.due(HeartbeatState(), 0, 0, intervalMs = BeatCadence.HELD_MAX_MS)
    val (second, _) = Heartbeat.due(first, 10_000, 10_000, intervalMs = BeatCadence.HELD_MAX_MS)
    val after = Heartbeat.answered(second, id!!, HeartbeatResponse.Answered(410), nowMs = 10_000)
    assertEquals(second, after)
  }

  // Below: added in B4's mutation pass and for the dispatch's secrets ruling.

  private fun answer(response: HeartbeatResponse): HeartbeatState {
    val (sent, id) = Heartbeat.due(HeartbeatState(), 0, 0, intervalMs = BeatCadence.HELD_MAX_MS)
    return Heartbeat.answered(sent, id!!, response, nowMs = 0)
  }

  @Test
  fun `ruling 5 any 2xx is an answer, and an over state outside a 2xx is not`() {
    // Only a 410, or a 2xx whose state is over for a sid, reads session-over.
    assertEquals(HeartbeatResult.SESSION_OVER, answer(HeartbeatResponse.Answered(202, BeatReply("over", "sess_42", null, null, null))).lastResult)
    assertEquals(HeartbeatResult.OK, answer(HeartbeatResponse.Answered(204)).lastResult)
    assertEquals(HeartbeatResult.FAILED, answer(HeartbeatResponse.Answered(500, BeatReply("over", "sess_42", null, null, null))).lastResult)
  }

  @Test
  fun `every answer closes its beat, so an answered beat is never later timed out`() {
    val responses =
      listOf(HeartbeatResponse.Answered(200, BeatReply("live", null, null, null, null)), HeartbeatResponse.Answered(410), HeartbeatResponse.Failed("timeout"))
    for (response in responses) assertNull(answer(response).inFlightId, response.toString())
    val answered = answer(HeartbeatResponse.Answered(200, BeatReply("live", null, null, null, null)))
    val (next, id) = Heartbeat.due(answered, 10_000, 10_000, intervalMs = BeatCadence.HELD_MAX_MS)
    assertEquals(2, id)
    assertEquals(0, next.failures)
  }

  @Test
  fun `the status reports the last beat's wall time and both failure counts`() {
    val wall = 1_790_778_725_123
    val (sent, id) = Heartbeat.due(HeartbeatState(consecutiveFailures = 2, failures = 5), nowMs = 5_000, wallMs = wall, intervalMs = BeatCadence.HELD_MAX_MS)
    val after = Heartbeat.answered(sent, id!!, HeartbeatResponse.Failed("timeout"), nowMs = 5_000)
    assertEquals(HeartbeatStatus(wall, HeartbeatResult.FAILED, consecutiveFailures = 3, failures = 6), after.status)
  }

  @Test
  fun `ruling 5 the token has no way into a beat - no field for it, and a failure keeps no message`() {
    // The token is the Bearer header plan C sets from the pairing. The beat's facts never hold it: they
    // are the amendment's beat body (_Contract shapes_) and nothing else, and a failed beat's platform
    // message, which could quote the request, is counted and dropped.
    assertEquals(
      setOf(
        "code", "slot", "phoneId", "claim", "deviceModel", "sid", "atEpochMs", "state", "cause", "notReady",
        "startFailed", "stopped", "automatic", "transport", "bitrateKbps", "delivery", "deliveredLagMs", "audioOk",
        "battery", "thermalStatus", "dataUsedBytes", "appVersion", "endReason",
      ),
      BeatFacts::class.java.declaredFields.filterNot { it.isSynthetic }.map { it.name }.toSet(),
    )
    val (sent, id) = Heartbeat.due(HeartbeatState(), 0, 0, intervalMs = BeatCadence.HELD_MAX_MS)
    val after = Heartbeat.answered(sent, id!!, HeartbeatResponse.Failed("401 for Authorization: Bearer ${Configs.TOKEN}"), nowMs = 0)
    assertFalse(Configs.TOKEN in after.toString())
    assertFalse(Configs.TOKEN in after.status.toString())
  }

  @Test
  fun `a shorter interval brings the next beat forward without a new send`() {
    var state = HeartbeatState()
    state = Heartbeat.due(state, 0, 0, intervalMs = 60_000).first
    state = Heartbeat.answered(state, 1, HeartbeatResponse.Answered(200), nowMs = 100)
    // At 60 s the next beat waits the full minute (review C0a, I1)…
    assertEquals(null, Heartbeat.due(state, 59_999, 59_999, intervalMs = 60_000).second)
    assertEquals(2, Heartbeat.due(state, 60_000, 60_000, intervalMs = 60_000).second)
    // …and shortened to 10 s, the same state is due at 10 s.
    assertEquals(null, Heartbeat.due(state, 9_999, 9_999, intervalMs = 10_000).second)
    assertEquals(2, Heartbeat.due(state, 10_000, 10_000, intervalMs = 10_000).second)
  }

  @Test
  fun `the next beat waits its whole interval, from the 5 s floor to the 300 s ceiling`() {
    // BeatCadence's clamp edges, passed straight through: due neither caps nor floors the interval.
    for (intervalMs in listOf(5_000L, 300_000L)) {
      var state = Heartbeat.due(HeartbeatState(), 0, 0, intervalMs).first
      state = Heartbeat.answered(state, 1, HeartbeatResponse.Answered(200), nowMs = 100)
      assertEquals(null, Heartbeat.due(state, intervalMs - 1, intervalMs - 1, intervalMs).second, "$intervalMs")
      assertEquals(2, Heartbeat.due(state, intervalMs, intervalMs, intervalMs).second, "$intervalMs")
    }
  }

  @Test
  fun `a 429 delays the next beat by its Retry-After, clamped`() {
    var state = Heartbeat.due(HeartbeatState(), 0, 0, intervalMs = 10_000).first
    state = Heartbeat.answered(state, 1, HeartbeatResponse.Answered(429, retryAfterS = 30), nowMs = 1_000)
    assertEquals(31_000L, state.notBeforeMs)
    assertEquals(null, Heartbeat.due(state, 30_999, 30_999, intervalMs = 10_000).second)
    assertEquals(2, Heartbeat.due(state, 31_000, 31_000, intervalMs = 10_000).second)
  }

  @Test
  fun `an answer delivered twice is used once`() {
    val (sent, id) = Heartbeat.due(HeartbeatState(), 0, 0, intervalMs = BeatCadence.HELD_MAX_MS)
    val once = Heartbeat.answered(sent, id!!, HeartbeatResponse.Failed("timeout"), nowMs = 0)
    val twice = Heartbeat.answered(once, id, HeartbeatResponse.Answered(410), nowMs = 0)
    assertEquals(once, twice)
    assertEquals(1, twice.failures)
  }
}
