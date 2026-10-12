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
    assertEquals(false, rig.records("unpaired").last().field("wasLive"))
  }

  /**
   * Batch 4 review M1, the controller's ruling (2026-10-12): the operator's own start in flight is not waiting. The
   * shade and the screen can be touched at once, and a start the server accepts after an unpair leaves a broadcast
   * with no phone, so a Forget then is ignored, and recorded, as in any other phase that is not waiting.
   */
  @Test
  fun `Forget while the operator's start is in flight is ignored - no release, no marker`() {
    val rig = MachineRig().paired()
    rig.hear("waiting")
    rig.ready()
    rig.send(Input.Start)
    assertEquals(1, rig.sent<Command.PostStart>().size)
    val commands = rig.send(Input.Forget)
    assertIs<Phase.Paired>(rig.phase)
    assertEquals(listOf("forget", "paired"), rig.records("intent-ignored").last().let { listOf(it.field("intent"), it.field("phase")) })
    assertTrue(commands.none { it == Command.Release || it is Command.WriteForgotten }, "$commands")
  }

  /** One case per state the snapshot can show other than paired, reached as MachineRig reaches it. */
  private val notWaiting: List<Pair<String, () -> MachineRig>> =
    listOf(
      "Idle" to { MachineRig() },
      "Pairing" to { MachineRig().also { it.permissions = null }.also { it.send(Input.Pair(it.request, Configs.PHONE, stopped = null)) } },
      "Arming" to { MachineRig().paired().also { it.codes = null }.also { it.hear("go-live", sid = "sess_42", startedBy = "organiser") } },
      "Armed" to { MachineRig().armed() },
      "Connecting" to { MachineRig().armed().also { it.ready() } },
      "Publishing" to { MachineRig().live() },
      "Degraded" to { MachineRig().live().also { it.send(Input.CameraContended) } },
      "Reconnecting" to { MachineRig().live().also { it.send(Input.Dropped(it.attempt!!, DropReason.ENDPOINT_CLOSED, "cut")) } },
      "Ended" to { MachineRig().live().also { it.send(Input.Stop) } },
    )

  /** Batch 4 review M6: a sweep, not a sample. Spec §9 names arming first: a remote Go live lands there. */
  @Test
  fun `Forget in every state but paired is ignored and recorded - nothing released, written or stopped`() {
    for ((state, reach) in notWaiting) {
      val rig = reach()
      assertEquals(state, rig.state::class.simpleName, "reached $state")
      val before = rig.phase
      val commands = rig.send(Input.Forget)
      assertEquals(before, rig.phase, state)
      val ignored = commands.filterIsInstance<Command.Record>().map { it.entry }
      assertEquals(listOf(listOf<Any?>("intent-ignored", "forget", before.name)), ignored.map { listOf(it.kind, it.field("intent"), it.field("phase")) }, state)
      assertTrue(commands.none { it == Command.Release || it is Command.WriteForgotten || it == Command.StopBroadcast }, "$state: $commands")
    }
    assertEquals(9, notWaiting.size)
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
