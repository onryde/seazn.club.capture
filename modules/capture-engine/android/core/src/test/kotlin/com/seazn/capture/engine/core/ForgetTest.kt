package com.seazn.capture.engine.core

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertIs
import kotlin.test.assertTrue

/** R6, R7 of the D3 findings design: the notification's Forget, native's own input, acts only while paired and waiting. */
class ForgetTest {
  @Test
  fun `Forget while paired and waiting - Idle, unpaired forgotten, the service released and the marker written`() {
    val rig = MachineRig().paired()
    val name = rig.phase.pairing!!.name
    rig.send(Input.Forget)
    assertEquals(Unpaired(UnpairReason.FORGOTTEN, name), assertIs<Phase.Idle>(rig.phase).unpaired)
    assertEquals(Unpaired(UnpairReason.FORGOTTEN, name), rig.snapshot.unpaired)
    assertEquals(1, rig.sent<Command.Release>().size)
    assertEquals(name, rig.sent<Command.WriteForgotten>().single().name)
    assertEquals(UnpairReason.FORGOTTEN, rig.records("unpaired").last().field("reason"))
  }

  @Test
  fun `Forget while armed is ignored and recorded`() {
    val rig = MachineRig().armed()
    rig.send(Input.Forget)
    assertIs<Phase.Armed>(rig.phase)
    assertEquals("forget", rig.records("intent-ignored").last().field("intent"))
    assertTrue(rig.sent<Command.WriteForgotten>().isEmpty())
    assertTrue(rig.sent<Command.Release>().isEmpty())
  }

  @Test
  fun `Forget while live is ignored - the broadcast runs on`() {
    val rig = MachineRig().live()
    rig.send(Input.Forget)
    assertIs<Phase.OnAir>(rig.phase)
    assertTrue(rig.sent<Command.WriteForgotten>().isEmpty())
  }

  @Test
  fun `Forget before the permissions answer is ignored - no notification exists yet`() {
    val rig = MachineRig()
    rig.permissions = null
    rig.send(Input.Pair(rig.request, Configs.PHONE, stopped = null))
    rig.send(Input.Forget)
    assertIs<Phase.Pairing>(rig.phase)
    assertEquals("forget", rig.records("intent-ignored").last().field("intent"))
  }

  @Test
  fun `a second Forget is ignored - one marker, one release (a second call)`() {
    val rig = MachineRig().paired()
    rig.send(Input.Forget)
    rig.send(Input.Forget)
    assertEquals(1, rig.sent<Command.WriteForgotten>().size)
    assertEquals(1, rig.sent<Command.Release>().size)
    assertEquals("forget", rig.records("intent-ignored").last().field("intent"))
  }

  /** A command prints into a `command-failed` line when the platform throws on it: the marker's prints no code. */
  @Test
  fun `the marker command prints its slot, never the code`() {
    val name = MachineRig().paired().phase.pairing!!.name
    val printed = Command.WriteForgotten(name).toString()
    assertTrue(name.code !in printed && name.tokenTag !in printed, printed)
    assertTrue("slot=${name.slot}" in printed, printed)
  }

  @Test
  fun `a pair after Forget pairs afresh, with no unpaired left`() {
    val rig = MachineRig().paired()
    rig.send(Input.Forget)
    rig.send(Input.Pair(rig.request, Configs.PHONE, stopped = null))
    assertIs<Phase.Paired>(rig.phase)
    assertEquals(null, rig.snapshot.unpaired)
  }
}
