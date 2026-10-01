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
      code = "fx42hmnp7k2q",
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
    assertEquals("fx42hmnp7k2q", body.getString("code"))
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
    """{"code":"fx42hmnp7k2q","slot":1,"phone":"${Configs.PHONE_ID}","claim":null,"sid":"sess_42","at":"2026-09-30T14:32:05.123Z",""" +
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

  // capture-beat.v1 (web 09e87aabd) bounds: a fact outside one is sent as null where null is allowed,
  // so a bad reading never turns a whole beat into a 422.
  private fun body(facts: BeatFacts) = Beats.payload(facts)

  @Test
  fun `R1 a drain outside 0 to 1000 per hour is sent as null, the battery still whole`() {
    fun drain(value: Double) = BeatBattery.of(DeviceSample(thermalStatus = null, thermalHeadroom = null, batteryPercent = 64, charging = true, drainPctPerHour = value, shed = null))
    assertEquals(BeatBattery(64, true, 1000.0), drain(1000.0))
    assertEquals(BeatBattery(64, true, 0.0), drain(0.0))
    val bad = listOf(-0.1, 1000.05, Double.NaN, Double.POSITIVE_INFINITY, Double.NEGATIVE_INFINITY)
    for (value in bad) assertEquals(BeatBattery(64, true, null), drain(value), "$value")
    assertEquals(5, bad.size)
    assertTrue(""""drainPctPerHour":1000.0}""" in body(held.copy(battery = drain(1000.0))))
  }

  @Test
  fun `the model is trimmed, cut to 80 characters, and a blank one sends device null`() {
    fun device(model: String): String? = JSONObject(body(paired.copy(deviceModel = model))).let { if (it.isNull("device")) null else it.getJSONObject("device").getString("model") }
    assertEquals("Pixel 8", device("  Pixel 8\n"))
    assertNull(device("   "))
    assertNull(device(""))
    assertEquals("m".repeat(80), device("m".repeat(80)))
    assertEquals("m".repeat(80), device("m".repeat(81)))
    // Cut by characters, as the schema counts them: never half of a surrogate pair.
    val camera = "\uD83D\uDCF7"
    assertEquals("m".repeat(79) + camera, device("m".repeat(79) + camera + "m"))
  }

  @Test
  fun `bitrateKbps outside 0 to 100000 is sent as null`() {
    assertTrue(""""bitrateKbps":100000,""" in body(held.copy(bitrateKbps = 100_000)))
    assertTrue(""""bitrateKbps":0,""" in body(held.copy(bitrateKbps = 0)))
    for (kbps in listOf(100_001, -1)) assertTrue(""""bitrateKbps":null,""" in body(held.copy(bitrateKbps = kbps)), "$kbps")
  }

  @Test
  fun `deliveredLagS outside 0 to 99999 s is sent as null`() {
    assertTrue(""""deliveredLagS":99999.0,""" in body(held.copy(deliveredLagMs = 99_999_000)))
    assertTrue(""""deliveredLagS":0.0,""" in body(held.copy(deliveredLagMs = 0)))
    for (ms in listOf(99_999_050L, -1L)) assertTrue(""""deliveredLagS":null,""" in body(held.copy(deliveredLagMs = ms)), "$ms")
  }

  @Test
  fun `thermal outside 0 to 6 is sent as null`() {
    assertTrue(""""thermal":6,""" in body(held.copy(thermalStatus = 6)))
    assertTrue(""""thermal":0,""" in body(held.copy(thermalStatus = 0)))
    for (status in listOf(7, -1)) assertTrue(""""thermal":null,""" in body(held.copy(thermalStatus = status)), "$status")
  }

  @Test
  fun `dataUsedMB outside 0 to 1000000 is sent as null`() {
    assertTrue(""""dataUsedMB":1000000.0,""" in body(held.copy(dataUsedBytes = 1_000_000_000_000)), body(held.copy(dataUsedBytes = 1_000_000_000_000)))
    for (bytes in listOf(1_000_000_050_000L, -1L)) assertTrue(""""dataUsedMB":null,""" in body(held.copy(dataUsedBytes = bytes)), "$bytes")
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
