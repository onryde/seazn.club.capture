package com.seazn.capture.engine.core

import java.util.Locale
import kotlin.test.AfterTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue
import org.json.JSONObject

class BeatsTest {
  private val saved = Locale.getDefault()

  @AfterTest
  fun restoreLocale() = Locale.setDefault(saved)

  private val paired =
    BeatFacts(
      code = "fx-42",
      slot = 1,
      phoneId = Configs.PHONE_ID,
      claim = Claim.NEW,
      deviceModel = "Test Phone",
      sid = null,
      atEpochMs = 1_790_000_000_000,
      state = "paired",
      cause = null,
      notReady = NotReady.HELD,
      startFailed = null,
      stopped = "sess_41",
      automatic = true,
      transport = null,
      bitrateKbps = null,
      delivery = Delivery.UNKNOWN,
      deliveredLagMs = null,
      audioOk = null,
      battery = BeatBattery(percent = 74, charging = false, drainPctPerHour = null),
      thermalStatus = 0,
      dataUsedBytes = 0,
      appVersion = "1.0.0",
    )

  @Test
  fun `a paired beat carries its claim, device, phone, mode and the stopped sid, and no secret`() {
    val body = JSONObject(Beats.payload(paired))
    assertEquals("fx-42", body.getString("code"))
    assertEquals(Configs.PHONE_ID, body.getString("phone"))
    assertEquals("new", body.getString("claim"))
    assertEquals("Test Phone", body.getJSONObject("device").getString("model"))
    assertTrue(body.isNull("sid"))
    assertEquals("sess_41", body.getString("stopped"))
    assertEquals("automatic", body.getString("mode"))
    assertEquals("held", body.getString("notReady"))
    assertEquals("2026-09-21T14:13:20.000Z", body.getString("at"))
    assertFalse(body.has("endReason"))
    assertFalse(Configs.TOKEN in body.toString())
  }

  @Test
  fun `RR3 a beat that holds a sid never carries stopped, and D1 device is always there - null without a claim`() {
    val held = JSONObject(Beats.payload(paired.copy(sid = "sess_42", state = "armed", cause = Cause.ORGANISER, claim = null)))
    assertEquals("sess_42", held.getString("sid"))
    assertTrue(held.isNull("stopped"))
    assertTrue(held.isNull("claim"))
    // D1: capture-beat.v1 requires the key; {model} only with a claim, null otherwise.
    assertTrue(held.has("device") && held.isNull("device"))
    assertEquals("organiser", held.getString("cause"))
    // A claim whose model the platform could not read sends device null, never a null model.
    val unread = JSONObject(Beats.payload(paired.copy(deviceModel = null)))
    assertTrue(unread.has("device") && unread.isNull("device"))
  }

  @Test
  fun `A8 the final beat says ended, operator-stopped`() {
    val last = JSONObject(Beats.payload(paired.copy(sid = "sess_42", state = "ended", claim = null, endReason = EndReason.OPERATOR_STOPPED)))
    assertEquals("ended", last.getString("state"))
    assertEquals("operator-stopped", last.getString("endReason"))
  }

  @Test
  fun `a beat names its slot, its state, and why the last start failed`() {
    // Written field by field from the amendment's beat body (review C0a, I2): no default value stands in.
    val failed = JSONObject(Beats.payload(paired.copy(slot = 3, startFailed = StartFailure.CRED_HOST)))
    assertEquals(3, failed.getInt("slot"))
    assertEquals("paired", failed.getString("state"))
    assertEquals("cred-host", failed.getString("startFailed"))
    assertTrue(JSONObject(Beats.payload(paired)).isNull("startFailed"))
  }

  @Test
  fun `the operator's mode reads operator`() {
    assertEquals("operator", JSONObject(Beats.payload(paired.copy(automatic = false))).getString("mode"))
  }

  // Moved from HeartbeatTest with Beats.payload (PV4): plan B's degraded RTMPS beat, now held by a pairing.
  private val held =
    paired.copy(
      claim = null,
      sid = "sess_42",
      atEpochMs = 1_790_778_725_123,
      state = "degraded",
      cause = Cause.ORGANISER,
      notReady = null,
      stopped = null,
      transport = Transport.RTMPS,
      bitrateKbps = 2_900,
      delivery = Delivery.OK,
      deliveredLagMs = 1_500,
      audioOk = true,
      battery = BeatBattery(percent = 64, charging = false, drainPctPerHour = 18.04),
      thermalStatus = 2,
      dataUsedBytes = 1_410_000_000,
    )

  // The expected body is written out from the amendment's beat (_Contract shapes_), field by field, in its order.
  private val heldBody =
    """{"code":"fx-42","slot":1,"phone":"${Configs.PHONE_ID}","claim":null,"sid":"sess_42","at":"2026-09-30T14:32:05.123Z",""" +
      """"state":"degraded","cause":"organiser","notReady":null,"startFailed":null,"stopped":null,"device":null,"mode":"automatic",""" +
      """"transport":"rtmps","bitrateKbps":2900,"delivery":"ok","deliveredLagS":1.5,"audioOk":true,""" +
      """"battery":{"percent":64,"charging":false,"drainPctPerHour":18.0},"thermal":2,"dataUsedMB":1410.0,"appVersion":"1.0.0"}"""

  @Test
  fun `ruling 5 a held beat carries the amendment's fields in its order`() {
    assertEquals(heldBody, Beats.payload(held))
  }

  @Test
  fun `the beat is the same on a French, Dutch or Spanish phone`() {
    for (tag in listOf("fr-FR", "nl-NL", "es-ES")) {
      Locale.setDefault(Locale.forLanguageTag(tag))
      assertEquals(heldBody, Beats.payload(held), tag)
    }
  }

  @Test
  fun `an armed phone reports no transport, bitrate or lag`() {
    val armed = held.copy(state = "armed", transport = null, bitrateKbps = null, deliveredLagMs = null, delivery = Delivery.UNKNOWN)
    val body = Beats.payload(armed)
    assertTrue(""""state":"armed",""" in body, body)
    assertTrue(""""transport":null,"bitrateKbps":null,"delivery":"unknown","deliveredLagS":null""" in body, body)
  }

  @Test
  fun `D2 a phone that cannot read its battery or thermal state sends null for each, never an object of nulls`() {
    val unread = held.copy(battery = null, thermalStatus = null)
    val body = Beats.payload(unread)
    assertTrue(""""battery":null,"thermal":null,""" in body, body)
  }

  @Test
  fun `D2 a battery is known only with both its percent, 0 to 100, and whether it charges`() {
    fun sample(percent: Int?, charging: Boolean?) = DeviceSample(thermalStatus = null, thermalHeadroom = null, batteryPercent = percent, charging = charging, drainPctPerHour = 12.5, shed = null)
    assertEquals(BeatBattery(64, true, 12.5), BeatBattery.of(sample(64, true)))
    assertEquals(BeatBattery(0, false, 12.5), BeatBattery.of(sample(0, false)))
    assertEquals(BeatBattery(100, false, 12.5), BeatBattery.of(sample(100, false)))
    val unknown = listOf(null to true, 64 to null, null to null, -1 to true, 101 to false)
    for ((percent, charging) in unknown) assertNull(BeatBattery.of(sample(percent, charging)), "$percent $charging")
    assertEquals(5, unknown.size)
  }

  @Test
  fun `D14 audioOk is null when nothing is publishing`() {
    assertTrue(""""audioOk":null,""" in Beats.payload(paired), Beats.payload(paired))
  }

  @Test
  fun `POST start carries the phone's id only`() {
    assertEquals("""{"phone":"${Configs.PHONE_ID}"}""", Beats.startBody(Configs.PHONE_ID))
  }
}
