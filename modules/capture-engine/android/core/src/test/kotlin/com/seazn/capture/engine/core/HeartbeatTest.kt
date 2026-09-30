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
      val (next, id) = Heartbeat.due(state, t, wallMs = t)
      state = next
      if (id != null) {
        sent += t
        state = Heartbeat.answered(state, id, HeartbeatResponse.Answered(200, "live", null)).first
      }
    }
    assertEquals(listOf(0L, 10_000L, 20_000L, 30_000L), sent)
  }

  @Test
  fun `ruling 5 a 410 means the session is over`() {
    val (state, id) = Heartbeat.due(HeartbeatState(), 0, 0)
    val (after, over) = Heartbeat.answered(state, id!!, HeartbeatResponse.Answered(410, null, "stopped"))
    assertTrue(over)
    assertEquals(HeartbeatResult.SESSION_OVER, after.lastResult)
  }

  @Test
  fun `ruling 5 a 200 with a finished state means the session is over`() {
    for (finished in listOf("ending", "completed", "failed")) {
      val (state, id) = Heartbeat.due(HeartbeatState(), 0, 0)
      assertTrue(Heartbeat.answered(state, id!!, HeartbeatResponse.Answered(200, finished, "stopped")).second, finished)
    }
  }

  @Test
  fun `a 200 that is live or warming is ok and clears the run of failures`() {
    val failing = HeartbeatState(consecutiveFailures = 4, failures = 4)
    for (live in listOf("live", "warming")) {
      val (state, id) = Heartbeat.due(failing, 0, 0)
      val (after, over) = Heartbeat.answered(state, id!!, HeartbeatResponse.Answered(200, live, null))
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
        HeartbeatResponse.Answered(401, null, null),
        HeartbeatResponse.Answered(500, null, null),
        HeartbeatResponse.Failed("timeout"),
      )
    var state = HeartbeatState()
    var t = 0L
    for (response in responses) {
      val (sent, id) = Heartbeat.due(state, t, t)
      val (after, over) = Heartbeat.answered(sent, id!!, response)
      assertFalse(over)
      state = after
      t += Heartbeat.INTERVAL_MS
    }
    assertEquals(3, state.failures)
    assertEquals(3, state.consecutiveFailures)
    assertEquals(HeartbeatResult.FAILED, state.lastResult)
    val (sent, id) = Heartbeat.due(state, t, t)
    assertFalse(Heartbeat.answered(sent, id!!, HeartbeatResponse.Answered(200, null, null)).second)
  }

  @Test
  fun `ruling 5 a beat that never comes back is failed at 10 s and the next one goes`() {
    val (first, id) = Heartbeat.due(HeartbeatState(), 0, 0)
    assertEquals(1, id)
    val (skipped, none) = Heartbeat.due(first, 5_000, 5_000)
    assertNull(none, "no second beat while one is in flight")
    val (second, next) = Heartbeat.due(skipped, 10_000, 10_000)
    assertEquals(2, next)
    assertEquals(1, second.failures)
  }

  @Test
  fun `a heartbeat that fails forever keeps beating every 10 s`() {
    var state = HeartbeatState()
    var sent = 0
    for (t in 0L until 1_000_000L step 500) {
      val (next, id) = Heartbeat.due(state, t, t)
      state = next
      if (id != null) sent += 1
    }
    assertEquals(100, sent)
    assertEquals(99, state.failures)
  }

  @Test
  fun `an answer to a beat already given up is ignored`() {
    val (first, id) = Heartbeat.due(HeartbeatState(), 0, 0)
    val (second, _) = Heartbeat.due(first, 10_000, 10_000)
    val (after, over) = Heartbeat.answered(second, id!!, HeartbeatResponse.Answered(410, null, null))
    assertFalse(over)
    assertEquals(second, after)
  }
}
