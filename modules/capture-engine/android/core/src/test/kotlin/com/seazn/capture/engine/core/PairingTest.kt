package com.seazn.capture.engine.core

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertIs
import kotlin.test.assertNull
import kotlin.test.assertTrue
import org.json.JSONObject

class PairingTest {
  @Test
  fun `A5 pair asks for permissions, then holds the service and sends the claim at once`() {
    val rig = MachineRig()
    rig.permissions = null
    val asked = rig.send(Input.Pair(Configs.pairRequest(), Configs.PHONE, stopped = null))
    assertIs<Phase.Pairing>(rig.phase)
    assertTrue(Command.AskPermissions in asked)
    val granted = rig.send(Input.PermissionsAnswered(granted = true))
    assertIs<Phase.Paired>(rig.phase)
    assertEquals(Command.Hold, granted.first { it !is Command.Record })
    val beat = granted.filterIsInstance<Command.PostHeartbeat>().single()
    assertEquals("new", org.json.JSONObject(beat.body).getString("claim"))
  }

  @Test
  fun `A5 a refused permission does not pair, and says why in Idle`() {
    val rig = MachineRig()
    rig.permissions = false
    rig.send(Input.Pair(Configs.pairRequest(), Configs.PHONE, null))
    val idle = assertIs<Phase.Idle>(rig.phase)
    assertEquals(Unpaired(UnpairReason.PERMISSIONS, Configs.pairRequest().name), idle.unpaired)
    assertTrue(rig.sent<Command.Hold>().isEmpty())
  }

  @Test
  fun `a refused permission is not sticky - the next pair asks again`() {
    val rig = MachineRig()
    rig.permissions = false
    rig.send(Input.Pair(Configs.pairRequest(), Configs.PHONE, null))
    rig.permissions = true
    rig.send(Input.Pair(Configs.pairRequest(), Configs.PHONE, null))
    assertIs<Phase.Paired>(rig.phase)
    assertEquals(2, rig.sent<Command.AskPermissions>().size)
  }

  @Test
  fun `pair is idempotent on the same code, slot and token, while Pairing or Paired`() {
    val rig = MachineRig()
    rig.permissions = null
    rig.send(Input.Pair(Configs.pairRequest(), Configs.PHONE, null))
    rig.send(Input.Pair(Configs.pairRequest(), Configs.PHONE, null))
    assertEquals(1, rig.sent<Command.AskPermissions>().size)
    assertEquals("pair", rig.records("intent-ignored").single().field("intent"))
  }

  @Test
  fun `pair on another code while Paired unpairs first, then pairs`() {
    val rig = MachineRig().paired()
    val other = Configs.pairRequest(slot = 2)
    val commands = rig.send(Input.Pair(other, Configs.PHONE, null))
    assertEquals(listOf(Command.Release, Command.AskPermissions), commands.filter { it == Command.Release || it == Command.AskPermissions })
    assertEquals(other.name, (rig.phase as Phase.Paired).pairing.name)
  }

  @Test
  fun `pair while a broadcast is held is ignored, and so is unpair`() {
    val rig = MachineRig().armed()
    rig.send(Input.Pair(Configs.pairRequest(slot = 2), Configs.PHONE, null))
    rig.send(Input.Unpair)
    assertIs<Phase.Armed>(rig.phase)
    assertEquals(listOf("pair", "unpair"), rig.records("intent-ignored").map { it.field("intent") })
  }

  @Test
  fun `unpair from Paired is Idle with no unpaired reason, and releases the service`() {
    val rig = MachineRig().paired()
    val commands = rig.send(Input.Unpair)
    assertEquals(Phase.Idle(rig.phase.ids, networkValidated = true), rig.phase)
    assertTrue(Command.Release in commands)
  }

  @Test
  fun `a pair request with problems ends fatal-error and never asks for permissions`() {
    val rig = MachineRig()
    rig.send(Input.Pair(Configs.pairRequest(token = ""), Configs.PHONE, null))
    assertEquals(EndReason.FATAL_ERROR, assertIs<Phase.Ended>(rig.phase).reason)
    assertEquals("token is blank", rig.records("pair-refused").single().field("problems"))
    assertTrue(rig.sent<Command.AskPermissions>().isEmpty())
    // Review C0b M4: no Hold went from Idle, so no Release goes with the End.
    assertEquals(listOf(Command.End(EndReason.FATAL_ERROR)), rig.commands.filterNot { it is Command.Record })
  }

  @Test
  fun `Release goes only where a Hold went - a refused re-pair from Paired releases, one from Pairing does not`() {
    val paired = MachineRig().paired()
    val fromPaired = paired.send(Input.Pair(Configs.pairRequest(slot = 2, token = ""), Configs.PHONE, null))
    assertEquals(listOf(Command.End(EndReason.FATAL_ERROR), Command.Release), fromPaired.filterNot { it is Command.Record })
    val pairing = MachineRig().apply { permissions = null }
    pairing.send(Input.Pair(Configs.pairRequest(), Configs.PHONE, null))
    assertIs<Phase.Pairing>(pairing.phase)
    val fromPairing = pairing.send(Input.Pair(Configs.pairRequest(slot = 2, token = ""), Configs.PHONE, null))
    assertEquals(listOf(Command.End(EndReason.FATAL_ERROR)), fromPairing.filterNot { it is Command.Record })
  }

  @Test
  fun `a re-pair while permissions are asked sends no Release - no Hold went yet`() {
    val rig = MachineRig().apply { permissions = null }
    rig.send(Input.Pair(Configs.pairRequest(), Configs.PHONE, null))
    val commands = rig.send(Input.Pair(Configs.pairRequest(slot = 2), Configs.PHONE, null))
    assertEquals(listOf(Command.AskPermissions), commands.filterNot { it is Command.Record })
    assertEquals("re-pair", rig.records("unpaired").single().field("reason"))
  }

  @Test
  fun `a go-live heard while paired arms that sid and fetches the code with the phone's id`() {
    val rig = MachineRig().paired()
    rig.codes = null
    rig.hear("go-live", sid = "sess_42", startedBy = "automatic")
    val arming = assertIs<Phase.Arming>(rig.phase)
    assertEquals("sess_42", arming.sid)
    assertEquals(Cause.AUTOMATIC, arming.cause)
    val fetch = rig.sent<Command.FetchCode>().single()
    assertEquals(Configs.PHONE_ID, fetch.phoneId)
    assertEquals(Configs.pairRequest().codeUrl, fetch.url)
  }

  @Test
  fun `an open session shape for the sid arms, and Armed waits for readiness`() {
    val rig = MachineRig().armed()
    assertIs<Phase.Armed>(rig.phase)
    assertTrue(rig.sent<Command.Connect>().isEmpty())
  }

  @Test
  fun `B6 review I2 at Arming only the fetch in flight is answered - any other answer changes nothing`() {
    val rig = MachineRig()
    rig.codes = null
    rig.armed()
    val arming = assertIs<Phase.Arming>(rig.phase)
    assertEquals(emptyList(), rig.send(Input.CodeAnswered(2, Configs.open())), "fetch 2 was never asked")
    assertEquals(arming, rig.phase)
    rig.send(Input.CodeAnswered(1, Configs.open()))
    assertIs<Phase.Armed>(rig.phase)
  }

  @Test
  fun `A11 ready connects on its own, encoding the side held`() {
    val rig = MachineRig().armed()
    val commands = rig.send(Input.ReadinessChanged(Configs.READY.copy(pose = Pose.Held(Side.RIGHT))))
    assertEquals(Command.Orient(Side.RIGHT), commands.first { it !is Command.Record })
    assertIs<Phase.Connecting>(rig.phase)
  }

  @Test
  fun `A11 the side is read once, when Armed turns to Connecting, and a later turn changes nothing`() {
    val rig = MachineRig().live()
    rig.send(Input.ReadinessChanged(Configs.READY.copy(pose = Pose.Held(Side.RIGHT))))
    assertEquals(listOf(Command.Orient(Side.LEFT)), rig.sent<Command.Orient>())
  }

  @Test
  fun `readiness heard before the go-live is kept, so Armed connects at once`() {
    val rig = MachineRig().paired()
    rig.ready()
    rig.hear("go-live", sid = "sess_42")
    assertIs<Phase.Connecting>(rig.phase)
  }

  @Test
  fun `setAutomatic and setLanguage change the pairing, in any paired phase, and are ignored in Idle`() {
    val rig = MachineRig().paired()
    rig.send(Input.SetAutomatic(on = false))
    rig.send(Input.SetLanguage("fr"))
    val pairing = assertIs<Phase.Paired>(rig.phase).pairing
    assertEquals(false, pairing.automatic)
    assertEquals("fr", pairing.language)
    val idle = MachineRig()
    idle.send(Input.SetAutomatic(on = false))
    assertEquals("set-automatic", idle.records("intent-ignored").single().field("intent"))
  }

  @Test
  fun `beats come from the pairing, every pollSeconds while paired and every 10 s while held`() {
    val rig = MachineRig().paired()
    // The server's word is a 60 s poll, on the beats and on the code's answer alike.
    rig.codes = { Configs.open().copy(waiting = Configs.waiting(pollSeconds = 60)) }
    rig.hear("waiting", pollSeconds = 60)
    rig.advance(59_500)
    assertEquals(1, rig.sent<Command.PostHeartbeat>().size)
    rig.advance(500)
    assertEquals(2, rig.sent<Command.PostHeartbeat>().size)
    rig.hear("go-live", sid = "sess_42", pollSeconds = 60)
    val before = rig.sent<Command.PostHeartbeat>().size
    rig.advance(10_000)
    assertEquals(before + 1, rig.sent<Command.PostHeartbeat>().size)
  }

  @Test
  fun `A9 the claim rides every beat until the first 2xx, and none after it`() {
    val rig = MachineRig().paired()
    rig.hear("waiting", status = 503)
    rig.advance(10_000)
    assertEquals("new", Configs.body(rig.sent<Command.PostHeartbeat>().last()).getString("claim"))
    rig.hear("waiting")
    rig.advance(10_000)
    assertTrue(Configs.body(rig.sent<Command.PostHeartbeat>().last()).isNull("claim"))
  }

  @Test
  fun `the record never carries the token or the code, from the pair on`() {
    val rig = MachineRig().live()
    // The entries as the machine writes them, before any masking: no field names either (field level, M3).
    val lines = rig.sent<Command.Record>().joinToString("\n") { it.entry.toString() }
    assertTrue(Configs.TOKEN !in lines)
    assertTrue(rig.request.name.code !in lines)
    assertTrue(rig.records("pair").single().field("tokenTag") == "c980ff38")
  }

  @Test
  fun `M3 the code is masked in free text, and never inside a closed word that happens to contain it`() {
    val lines = mutableListOf<String>()
    val record = SessionRecord { lines += it }
    val request = Configs.pairRequest(code = "on")
    record.protect(request.secrets(), inTextOnly = request.textSecrets())
    record.append(0, RecordEntry("connecting", listOf("state" to "connecting", "message" to "GET /codes/on/beat failed")))
    val line = JSONObject(lines.single())
    assertEquals("connecting", line.getString("kind"))
    assertEquals("connecting", line.getString("state"))
    assertTrue("/codes/on/" !in line.getString("message"))
  }
}
