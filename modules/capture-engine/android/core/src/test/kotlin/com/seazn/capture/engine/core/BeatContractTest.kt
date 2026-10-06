package com.seazn.capture.engine.core

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue
import org.json.JSONObject

/**
 * The beat the machine sends, against `capture-beat.v1` (contracts-v1-check D1, D2, D14): `device` is
 * always there, `battery` is null or whole, and `audioOk` is null when nothing is publishing.
 */
class BeatContractTest {
  private fun body(command: Command.PostHeartbeat) = JSONObject(command.body)

  private fun beats(rig: MachineRig) = rig.sent<Command.PostHeartbeat>().map(::body)

  @Test fun `D1 the claim carries device with its model, and every later beat carries device null`() {
    val rig = MachineRig().paired()
    rig.hear("waiting")
    rig.hear("waiting")
    val (claim, next) = beats(rig)
    assertEquals("Test Phone", claim.getJSONObject("device").getString("model"))
    assertTrue(next.has("device") && next.isNull("device"), next.toString())
  }

  @Test fun `D2 a paired beat, with no device sample, sends battery null`() {
    val rig = MachineRig().paired()
    val claim = beats(rig).single()
    assertTrue(claim.has("battery") && claim.isNull("battery"), claim.toString())
  }

  @Test fun `D2 a held beat sends the battery whole once it is read, and null while half of it is not`() {
    val rig = MachineRig().live()
    rig.send(Input.Device(DeviceSample(thermalStatus = 0, thermalHeadroom = null, batteryPercent = 64, charging = true, drainPctPerHour = 12.5, shed = null)))
    rig.hear("live", sid = "sess_42")
    val battery = beats(rig).last().getJSONObject("battery")
    assertEquals(64, battery.getInt("percent"))
    assertEquals(true, battery.getBoolean("charging"))
    assertEquals(12.5, battery.getDouble("drainPctPerHour"))
    rig.send(Input.Device(DeviceSample(thermalStatus = 0, thermalHeadroom = null, batteryPercent = 63, charging = null, drainPctPerHour = 12.5, shed = null)))
    rig.hear("live", sid = "sess_42")
    assertTrue(beats(rig).last().isNull("battery"), beats(rig).last().toString())
  }

  @Test fun `D14 audioOk is null while paired, Arming, Armed, connecting and reconnecting, and a boolean only on air`() {
    val rig = MachineRig().paired()
    rig.codes = { CodeAnswer.Unreachable("dns") }
    rig.hear("go-live", sid = "sess_42")
    rig.hear("go-live", sid = "sess_42")
    rig.codes = { if (rig.phase is Phase.Arming) Configs.open() else null }
    rig.advance(10_000)
    assertTrue(rig.phase is Phase.Armed, rig.phase.name)
    // The first answers the beat sent while Arming; the second, one sent while Armed.
    rig.hear("go-live", sid = "sess_42")
    rig.hear("go-live", sid = "sess_42")
    rig.ready()
    rig.hear("go-live", sid = "sess_42")
    val states = beats(rig).map { it.getString("state") to it.get("audioOk") }
    assertEquals(listOf("paired", "arming", "armed", "connecting"), states.map { it.first }.distinct())
    assertTrue(states.all { it.second == JSONObject.NULL }, states.toString())

    val live = MachineRig().live()
    live.hear("live", sid = "sess_42")
    assertEquals(true, beats(live).last().get("audioOk"))
    live.send(Input.Dropped(live.attempt!!, DropReason.ENDPOINT_CLOSED, null))
    live.hear("live", sid = "sess_42")
    val reconnecting = beats(live).last()
    assertEquals("reconnecting", reconnecting.getString("state"))
    assertEquals(JSONObject.NULL, reconnecting.get("audioOk"))
  }

  @Test fun `A8 the final beat says ended and is never a claim, so it carries device null and audioOk null`() {
    val rig = MachineRig().live()
    rig.send(Input.Stop)
    val last = beats(rig).last()
    assertEquals("ended", last.getString("state"))
    assertTrue(last.isNull("claim"), last.toString())
    assertTrue(last.has("device") && last.isNull("device"), last.toString())
    assertEquals(JSONObject.NULL, last.get("audioOk"))
  }
}
