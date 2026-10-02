package com.seazn.capture.engine.adapter

import com.seazn.capture.engine.core.Command
import com.seazn.capture.engine.core.Configs
import com.seazn.capture.engine.core.EndReason
import com.seazn.capture.engine.core.Input
import com.seazn.capture.engine.core.MachineRig
import com.seazn.capture.engine.core.PairingName
import com.seazn.capture.engine.core.Phase
import com.seazn.capture.engine.core.StoppedRecord
import com.seazn.capture.engine.core.field
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertIs
import kotlin.test.assertTrue

class IntentMappingTest {
  private val none: (PairingName) -> StoppedRecord? = { null }

  private fun input(vararg pairs: Pair<String, Any?>) = IntentMapping.input(mapOf(*pairs), Configs.PHONE, none)

  @Test
  fun `each intent kind maps to its input`() {
    assertEquals(Input.Start, input("kind" to "start"))
    assertEquals(Input.Stop, input("kind" to "stop"))
    assertEquals(Input.Unpair, input("kind" to "unpair"))
    assertEquals(Input.Reset, input("kind" to "reset"))
    assertEquals(Input.SetAutomatic(false), input("kind" to "setAutomatic", "on" to false))
    assertEquals(Input.SetAutomatic(true), input("kind" to "setAutomatic", "on" to true))
    assertEquals(Input.SetLanguage("nl"), input("kind" to "setLanguage", "language" to "nl"))
  }

  @Test
  fun `pair carries the phone's facts and this code and slot's stopped record`() {
    val record = StoppedRecord("fx42hmnp7k2q", 1, "sess_41", 0, Long.MAX_VALUE)
    val pair =
      IntentMapping.input(mapOf("kind" to "pair", "code" to "fx42hmnp7k2q", "slot" to 1.0), Configs.PHONE) {
        if (it.code == "fx42hmnp7k2q" && it.slot == 1) record else null
      }
    val mapped = assertIs<Input.Pair>(pair)
    assertEquals(Configs.PHONE, mapped.phone)
    assertEquals(record, mapped.stopped)
  }

  @Test
  fun `spec 5 an empty pair is still a pair - the machine refuses it by name, never ignores it`() {
    val pair = assertIs<Input.Pair>(input("kind" to "pair"))
    val rig = MachineRig()
    rig.send(pair)
    assertEquals(EndReason.FATAL_ERROR, assertIs<Phase.Ended>(rig.phase).reason)
    val problems = rig.records("pair-refused").single().field("problems") as String
    assertTrue("token is blank" in problems, problems)
    assertTrue(rig.sent<Command.AskPermissions>().isEmpty())
  }

  @Test
  fun `a setAutomatic with no flag is no input`() {
    assertEquals(null, input("kind" to "setAutomatic"))
    assertEquals(null, input("kind" to "setAutomatic", "on" to "false"))
  }

  @Test
  fun `P3 a setLanguage with no language is the empty one - the phone's language, then English`() {
    assertEquals(Input.SetLanguage(""), input("kind" to "setLanguage"))
    assertEquals(Input.SetLanguage(""), input("kind" to "setLanguage", "language" to 1.0))
  }

  @Test
  fun `carry 10 switchCamera is mapped through, reserved with no control in S1`() {
    assertEquals(Input.SwitchCamera, input("kind" to "switchCamera"))
  }

  @Test
  fun `an unknown or missing kind is no input, and arm is no longer one`() {
    assertEquals(null, input("kind" to "explode"))
    assertEquals(null, input("kind" to "arm"))
    assertEquals(null, input("kind" to 1.0))
    assertEquals(null, IntentMapping.input(emptyMap(), Configs.PHONE, none))
  }
}
