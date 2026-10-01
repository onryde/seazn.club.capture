package com.seazn.capture.engine.core

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertIs

class EndPathsTest {
  @Test fun `the operator's stop - Ended operator-stopped, the pairing over`() {
    val rig = MachineRig().live()
    rig.send(Input.Stop)
    assertEquals(EndReason.OPERATOR_STOPPED, assertIs<Phase.Ended>(rig.phase).reason)
    assertEquals(true, rig.records("ended").single().field("wasLive"))
  }

  @Test fun `the organiser's over - Paired, stopped-by-organiser`() {
    val rig = MachineRig().live()
    rig.hear("over", sid = "sess_42", endReason = "stopped")
    assertEquals("stopped-by-organiser", (rig.records("broadcast-ended").single().field("lastEnd") as LastEnd).wire)
  }

  @Test fun `the code's over on a reconnect - Paired, its endReason`() {
    val rig = MachineRig().live()
    rig.codes = { CodeAnswer.Over("sess_42", "auto_stopped") }
    rig.send(Input.Dropped(rig.attempt!!, DropReason.ENDPOINT_CLOSED, null))
    assertEquals(LastEnd.STOPPED_AUTOMATICALLY, assertIs<Phase.Paired>(rig.phase).pairing.lastEnd)
  }

  @Test fun `a beat's 410, defensively - Paired, stopped`() {
    val rig = MachineRig().live()
    rig.hear(null, status = 410)
    assertEquals(LastEnd.STOPPED, assertIs<Phase.Paired>(rig.phase).pairing.lastEnd)
  }

  @Test fun `the hold runs out - Paired, hold-window-expired`() {
    val rig = MachineRig().live()
    rig.send(Input.Dropped(rig.attempt!!, DropReason.ENDPOINT_CLOSED, null))
    rig.advance(184_000, feeding = false)
    assertEquals(LastEnd.HOLD_WINDOW_EXPIRED, assertIs<Phase.Paired>(rig.phase).pairing.lastEnd)
  }

  @Test fun `a permanent platform failure - Ended fatal-error, the pairing over`() {
    val rig = MachineRig().live()
    rig.send(Input.PlatformFailed(rig.attempt!!, "codec"))
    assertEquals(EndReason.FATAL_ERROR, assertIs<Phase.Ended>(rig.phase).reason)
  }

  @Test fun `replaced while live - Idle, replaced`() {
    val rig = MachineRig().live()
    rig.hear("replaced")
    assertEquals(UnpairReason.REPLACED, assertIs<Phase.Idle>(rig.phase).unpaired?.reason)
  }
}
