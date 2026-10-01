package com.seazn.capture.engine.core

import java.util.Locale
import kotlin.test.AfterTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

class HeartbeatTest {
  private val saved = Locale.getDefault()

  @AfterTest
  fun restoreLocale() = Locale.setDefault(saved)

  private val facts =
    HeartbeatFacts(
      sid = "sess_42",
      atEpochMs = 1_790_778_725_123,
      state = SnapshotState.Degraded(Transport.RTMPS, listOf(DegradeReason.FELL_BACK_TO_RTMPS), 0),
      transport = Transport.RTMPS,
      bitrateKbps = 2_900,
      delivery = Delivery.OK,
      deliveredLagMs = 1_500,
      audioOk = true,
      batteryPercent = 64,
      charging = false,
      drainPctPerHour = 18.04,
      thermalStatus = 2,
      dataUsedBytes = 1_410_000_000,
      appVersion = "1.0.0",
    )

  // The expected body is written out from the spec's _Ask_ → Heartbeat, field by field.
  private val expected =
    """{"sid":"sess_42","at":"2026-09-30T14:32:05.123Z","state":"degraded","transport":"rtmps",""" +
      """"bitrateKbps":2900,"delivery":"ok","deliveredLagS":1.5,"audioOk":true,""" +
      """"battery":{"percent":64,"charging":false,"drainPctPerHour":18.0},"thermal":2,""" +
      """"dataUsedMB":1410.0,"appVersion":"1.0.0"}"""

  @Test
  fun `ruling 5 the payload carries the Ask's fields in its order`() {
    assertEquals(expected, Heartbeat.payload(facts))
  }

  @Test
  fun `the payload is the same on a French, Dutch or Spanish phone`() {
    for (tag in listOf("fr-FR", "nl-NL", "es-ES")) {
      Locale.setDefault(Locale.forLanguageTag(tag))
      assertEquals(expected, Heartbeat.payload(facts))
    }
  }

  @Test
  fun `an armed phone reports no transport, bitrate or lag`() {
    val armed = facts.copy(state = SnapshotState.Armed, transport = null, bitrateKbps = null, deliveredLagMs = null, delivery = Delivery.UNKNOWN)
    val body = Heartbeat.payload(armed)
    assertTrue(""""state":"armed","transport":null,"bitrateKbps":null,"delivery":"unknown","deliveredLagS":null""" in body)
  }

  @Test
  fun `the first beat is due at once, then every 10 s`() {
    var state = HeartbeatState()
    val sent = mutableListOf<Long>()
    for (t in 0L..30_000L step 500) {
      val (next, id) = Heartbeat.due(state, t, wallMs = t, intervalMs = Heartbeat.INTERVAL_MS)
      state = next
      if (id != null) {
        sent += t
        state = Heartbeat.answered(state, id, HeartbeatResponse.Answered(200, BeatReply("live", null, null, null, null)), nowMs = t).first
      }
    }
    assertEquals(listOf(0L, 10_000L, 20_000L, 30_000L), sent)
  }

  @Test
  fun `ruling 5 a 410 means the session is over`() {
    val (state, id) = Heartbeat.due(HeartbeatState(), 0, 0, intervalMs = Heartbeat.INTERVAL_MS)
    val (after, over) = Heartbeat.answered(state, id!!, HeartbeatResponse.Answered(410, BeatReply(null, null, null, "stopped", null)), nowMs = 0)
    assertTrue(over)
    assertEquals(HeartbeatResult.SESSION_OVER, after.lastResult)
  }

  @Test
  fun `ruling 5 a 200 with a finished state means the session is over`() {
    for (finished in listOf("ending", "completed", "failed")) {
      val (state, id) = Heartbeat.due(HeartbeatState(), 0, 0, intervalMs = Heartbeat.INTERVAL_MS)
      assertTrue(Heartbeat.answered(state, id!!, HeartbeatResponse.Answered(200, BeatReply(finished, null, null, "stopped", null)), nowMs = 0).second, finished)
    }
  }

  @Test
  fun `a 200 that is live or warming is ok and clears the run of failures`() {
    val failing = HeartbeatState(consecutiveFailures = 4, failures = 4)
    for (live in listOf("live", "warming")) {
      val (state, id) = Heartbeat.due(failing, 0, 0, intervalMs = Heartbeat.INTERVAL_MS)
      val (after, over) = Heartbeat.answered(state, id!!, HeartbeatResponse.Answered(200, BeatReply(live, null, null, null, null)), nowMs = 0)
      assertFalse(over)
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
      val (sent, id) = Heartbeat.due(state, t, t, intervalMs = Heartbeat.INTERVAL_MS)
      val (after, over) = Heartbeat.answered(sent, id!!, response, nowMs = t)
      assertFalse(over)
      state = after
      t += Heartbeat.INTERVAL_MS
    }
    assertEquals(3, state.failures)
    assertEquals(3, state.consecutiveFailures)
    assertEquals(HeartbeatResult.FAILED, state.lastResult)
    val (sent, id) = Heartbeat.due(state, t, t, intervalMs = Heartbeat.INTERVAL_MS)
    assertFalse(Heartbeat.answered(sent, id!!, HeartbeatResponse.Answered(200), nowMs = t).second)
  }

  @Test
  fun `ruling 5 a beat that never comes back is failed at 10 s and the next one goes`() {
    val (first, id) = Heartbeat.due(HeartbeatState(), 0, 0, intervalMs = Heartbeat.INTERVAL_MS)
    assertEquals(1, id)
    val (skipped, none) = Heartbeat.due(first, 5_000, 5_000, intervalMs = Heartbeat.INTERVAL_MS)
    assertNull(none, "not due until 10 s: the interval holds this, since a 10 s timeout clears a beat in flight first")
    val (second, next) = Heartbeat.due(skipped, 10_000, 10_000, intervalMs = Heartbeat.INTERVAL_MS)
    assertEquals(2, next)
    assertEquals(1, second.failures)
  }

  @Test
  fun `B7 m5 one beat in flight at most - a beat due while one is in flight and not yet given up waits`() {
    // A state `due` never makes while INTERVAL_MS == TIMEOUT_MS: the next beat is due at 5 s (last sent
    // at -5 s), and the one in flight since 0 is not given up until 10 s. The in-flight rule alone holds the next.
    val inFlight = HeartbeatState(lastSentAtMonoMs = -5_000, inFlightId = 1, inFlightSinceMs = 0, nextId = 2)
    val (held, none) = Heartbeat.due(inFlight, 5_000, 5_000, intervalMs = Heartbeat.INTERVAL_MS)
    assertNull(none)
    assertEquals(inFlight, held)
    val (_, next) = Heartbeat.due(inFlight, 10_000, 10_000, intervalMs = Heartbeat.INTERVAL_MS)
    assertEquals(2, next, "given up at 10 s, the next beat goes")
  }

  @Test
  fun `a heartbeat that fails forever keeps beating every 10 s`() {
    var state = HeartbeatState()
    var sent = 0
    for (t in 0L until 1_000_000L step 500) {
      val (next, id) = Heartbeat.due(state, t, t, intervalMs = Heartbeat.INTERVAL_MS)
      state = next
      if (id != null) sent += 1
    }
    assertEquals(100, sent)
    assertEquals(99, state.failures)
  }

  @Test
  fun `an answer to a beat already given up is ignored`() {
    val (first, id) = Heartbeat.due(HeartbeatState(), 0, 0, intervalMs = Heartbeat.INTERVAL_MS)
    val (second, _) = Heartbeat.due(first, 10_000, 10_000, intervalMs = Heartbeat.INTERVAL_MS)
    val (after, over) = Heartbeat.answered(second, id!!, HeartbeatResponse.Answered(410), nowMs = 10_000)
    assertFalse(over)
    assertEquals(second, after)
  }

  // Below: added in B4's mutation pass and for the dispatch's secrets ruling.

  private fun answer(response: HeartbeatResponse): Pair<HeartbeatState, Boolean> {
    val (sent, id) = Heartbeat.due(HeartbeatState(), 0, 0, intervalMs = Heartbeat.INTERVAL_MS)
    return Heartbeat.answered(sent, id!!, response, nowMs = 0)
  }

  @Test
  fun `ruling 5 any 2xx is an answer, and a finished state outside a 2xx is not`() {
    // Only a 410, or a 2xx whose state is ending, completed or failed, ends the session.
    assertTrue(answer(HeartbeatResponse.Answered(202, BeatReply("ending", null, null, null, null))).second)
    val (empty, emptyOver) = answer(HeartbeatResponse.Answered(204))
    assertFalse(emptyOver)
    assertEquals(HeartbeatResult.OK, empty.lastResult)
    val (refused, refusedOver) = answer(HeartbeatResponse.Answered(500, BeatReply("failed", null, null, null, null)))
    assertFalse(refusedOver)
    assertEquals(HeartbeatResult.FAILED, refused.lastResult)
  }

  @Test
  fun `every answer closes its beat, so an answered beat is never later timed out`() {
    val responses =
      listOf(HeartbeatResponse.Answered(200, BeatReply("live", null, null, null, null)), HeartbeatResponse.Answered(410), HeartbeatResponse.Failed("timeout"))
    for (response in responses) assertNull(answer(response).first.inFlightId, response.toString())
    val (answered, _) = answer(HeartbeatResponse.Answered(200, BeatReply("live", null, null, null, null)))
    val (next, id) = Heartbeat.due(answered, 10_000, 10_000, intervalMs = Heartbeat.INTERVAL_MS)
    assertEquals(2, id)
    assertEquals(0, next.failures)
  }

  @Test
  fun `the status reports the last beat's wall time and both failure counts`() {
    val wall = 1_790_778_725_123
    val (sent, id) = Heartbeat.due(HeartbeatState(consecutiveFailures = 2, failures = 5), nowMs = 5_000, wallMs = wall, intervalMs = Heartbeat.INTERVAL_MS)
    val (after, _) = Heartbeat.answered(sent, id!!, HeartbeatResponse.Failed("timeout"), nowMs = 5_000)
    assertEquals(HeartbeatStatus(wall, HeartbeatResult.FAILED, consecutiveFailures = 3, failures = 6), after.status)
  }

  @Test
  fun `a phone that cannot read its battery or thermal state sends nulls`() {
    val unread = facts.copy(batteryPercent = null, charging = null, drainPctPerHour = null, thermalStatus = null)
    val body = Heartbeat.payload(unread)
    assertTrue(""""battery":{"percent":null,"charging":null,"drainPctPerHour":null},"thermal":null,""" in body, body)
  }

  @Test
  fun `ruling 5 the token has no way into a beat - no field for it, and a failure keeps no message`() {
    // The per-session token is the Bearer header plan C sets from SessionConfig.token. The core's heartbeat
    // never holds it: the facts are the Ask's fields and nothing else, and a failed beat's platform
    // message, which could quote the request, is counted and dropped.
    assertEquals(
      setOf(
        "sid", "atEpochMs", "state", "transport", "bitrateKbps", "delivery", "deliveredLagMs", "audioOk",
        "batteryPercent", "charging", "drainPctPerHour", "thermalStatus", "dataUsedBytes", "appVersion",
      ),
      HeartbeatFacts::class.java.declaredFields.filterNot { it.isSynthetic }.map { it.name }.toSet(),
    )
    val (sent, id) = Heartbeat.due(HeartbeatState(), 0, 0, intervalMs = Heartbeat.INTERVAL_MS)
    val (after, _) = Heartbeat.answered(sent, id!!, HeartbeatResponse.Failed("401 for Authorization: Bearer ${Configs.TOKEN}"), nowMs = 0)
    assertFalse(Configs.TOKEN in after.toString())
    assertFalse(Configs.TOKEN in after.status.toString())
  }

  @Test
  fun `a shorter interval brings the next beat forward without a new send`() {
    var state = HeartbeatState()
    state = Heartbeat.due(state, 0, 0, intervalMs = 60_000).first
    state = Heartbeat.answered(state, 1, HeartbeatResponse.Answered(200), nowMs = 100).first
    assertEquals(null, Heartbeat.due(state, 9_999, 9_999, intervalMs = 10_000).second)
    assertEquals(2, Heartbeat.due(state, 10_000, 10_000, intervalMs = 10_000).second)
  }

  @Test
  fun `a 429 delays the next beat by its Retry-After, clamped`() {
    var state = Heartbeat.due(HeartbeatState(), 0, 0, intervalMs = 10_000).first
    state = Heartbeat.answered(state, 1, HeartbeatResponse.Answered(429, retryAfterS = 30), nowMs = 1_000).first
    assertEquals(31_000L, state.notBeforeMs)
    assertEquals(null, Heartbeat.due(state, 30_999, 30_999, intervalMs = 10_000).second)
    assertEquals(2, Heartbeat.due(state, 31_000, 31_000, intervalMs = 10_000).second)
  }

  @Test
  fun `an answer delivered twice is used once`() {
    val (sent, id) = Heartbeat.due(HeartbeatState(), 0, 0, intervalMs = Heartbeat.INTERVAL_MS)
    val (once, _) = Heartbeat.answered(sent, id!!, HeartbeatResponse.Failed("timeout"), nowMs = 0)
    val (twice, over) = Heartbeat.answered(once, id, HeartbeatResponse.Answered(410), nowMs = 0)
    assertFalse(over)
    assertEquals(once, twice)
    assertEquals(1, twice.failures)
  }
}
