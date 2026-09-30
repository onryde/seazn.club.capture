package com.seazn.capture.engine.core

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertIs
import kotlin.test.assertTrue

class SessionMachineDeviceTest {
  @Test
  fun `F-P5-10 a taken camera puts the slate on air and holds, with no rebuild`() {
    val rig = MachineRig().live()
    rig.send(Input.CameraContended)
    assertEquals(listOf(Command.Slate(on = true)), rig.sent<Command.Slate>())
    rig.advance(10_000, videoPerStep = 0)
    assertTrue(rig.sent<Command.Rebuild>().isEmpty(), "a rebuild buys nothing while another app holds the camera")
    assertEquals(listOf(DegradeReason.CAMERA_TAKEN), assertIs<SnapshotState.Degraded>(rig.state).reasons)
  }

  @Test
  fun `F-P5-10 the slate's own frames keep the session degraded camera-taken`() {
    val rig = MachineRig().live()
    rig.send(Input.CameraContended)
    rig.advance(5_000, videoPerStep = 1)
    assertEquals(listOf(DegradeReason.CAMERA_TAKEN), assertIs<SnapshotState.Degraded>(rig.state).reasons)
    assertTrue(rig.sent<Command.Rebuild>().isEmpty())
  }

  @Test
  fun `F-P5-10 on release the camera is reopened, then the slate comes off with a fresh stall window`() {
    val rig = MachineRig().live()
    rig.send(Input.CameraContended)
    rig.advance(10_000, videoPerStep = 0)
    rig.send(Input.CameraReleased)
    assertEquals(listOf(Command.ReopenCamera), rig.sent<Command.ReopenCamera>())
    rig.send(Input.CameraReopened(ok = true))
    assertEquals(listOf(Command.Slate(true), Command.Slate(false)), rig.sent<Command.Slate>())
    rig.advance(2_500, videoPerStep = 0)
    assertTrue(rig.sent<Command.Rebuild>().isEmpty(), "the reopened camera gets 3 s")
    rig.advance(1_000)
    assertIs<SnapshotState.Publishing>(rig.state)
  }

  @Test
  fun `F-P5-10 a failed reopen rebuilds`() {
    val rig = MachineRig().live()
    rig.send(Input.CameraContended)
    rig.send(Input.CameraReleased)
    rig.send(Input.CameraReopened(ok = false))
    assertEquals(1, rig.sent<Command.Rebuild>().size)
  }

  @Test
  fun `a second contended is one slate, and a release without a take does nothing`() {
    val rig = MachineRig().live()
    rig.send(Input.CameraReleased)
    rig.send(Input.CameraContended)
    rig.send(Input.CameraContended)
    assertEquals(1, rig.sent<Command.Slate>().size)
    assertTrue(rig.sent<Command.ReopenCamera>().isEmpty())
  }

  @Test
  fun `F-P5-8 a silenced mic is degraded mic-silenced until it is restored`() {
    val rig = MachineRig().live()
    rig.send(Input.MicSilenced(true))
    rig.advance(1_000)
    assertEquals(listOf(DegradeReason.MIC_SILENCED), assertIs<SnapshotState.Degraded>(rig.state).reasons)
    rig.send(Input.MicSilenced(false))
    assertIs<SnapshotState.Publishing>(rig.state)
    assertEquals(1, rig.records("mic-silenced").size)
    assertEquals(1, rig.records("mic-restored").size)
  }

  @Test
  fun `AGENTS 8 - thermal travels as shed and is never a degrade reason`() {
    val rig = MachineRig().live()
    rig.send(Input.Device(DeviceSample(3, 0.9, 51, true, 18.0, ShedStep.OVERLAY_PREVIEW)))
    rig.advance(1_000)
    assertIs<SnapshotState.Publishing>(rig.state)
    assertEquals(ShedStep.OVERLAY_PREVIEW, rig.snapshot.shed)
    assertEquals(3, rig.records("thermal").single().fields.first { it.first == "status" }.second)
  }

  @Test
  fun `a thermal reading is recorded only when it changes`() {
    val rig = MachineRig().live()
    val sample = DeviceSample(2, null, 70, true, null, null)
    repeat(5) { rig.send(Input.Device(sample)) }
    rig.send(Input.Device(sample.copy(thermalStatus = 3)))
    assertEquals(2, rig.records("thermal").size)
  }

  /**
   * P5's phone call answered on 2026-09-28 evening: "delivery-starved videoFps=9.7 audioFps=15.2".
   * After [MachineRig.live] (30 video and 46 audio frames at 1 s), readings 2 s apart: 39 video and
   * 61 audio frames over the 4 s from 1 s to 5 s, 9.75 and 15.25 a second, shown as 9.7 and 15.2.
   */
  private fun MachineRig.callDip() =
    advance(4_000, feeding = false) {
      when (mono) {
        3_000L -> send(Input.Frames(1, 30 + 20, 46 + 30))
        5_000L -> send(Input.Frames(1, 30 + 39, 46 + 61))
      }
    }

  @Test
  fun `F-P5-8 a silenced mic is not rebuilt for P5's call dip, and Diagnostics still shows the rates`() {
    val rig = MachineRig().live()
    rig.send(Input.MicSilenced(true))
    rig.callDip()
    assertTrue(rig.sent<Command.Rebuild>().isEmpty(), "a rebuild cannot end the call")
    assertEquals(9.7, rig.snapshot.encodedVideoFps)
    assertEquals(15.2, rig.snapshot.audioPacketsPerSecond)
    assertEquals(listOf(DegradeReason.MIC_SILENCED), assertIs<SnapshotState.Degraded>(rig.state).reasons)
  }

  @Test
  fun `F-P5-9 the same dip with the mic live is a rate-floor rebuild`() {
    val rig = MachineRig().live()
    rig.callDip()
    val stalled = rig.records("video-stalled").single()
    assertEquals(StallCause.BELOW_FLOOR, stalled.field("cause"))
    assertEquals(9.7, stalled.field("videoFps"))
    assertEquals(15.2, stalled.field("audioFps"))
    assertEquals(1, rig.sent<Command.Rebuild>().size)
  }

  @Test
  fun `F-P5-8 while the mic is silenced a frozen picture is still rebuilt no-video`() {
    val rig = MachineRig().live()
    rig.send(Input.MicSilenced(true))
    rig.advance(2_500, videoPerStep = 0)
    assertTrue(rig.sent<Command.Rebuild>().isEmpty())
    rig.advance(500, videoPerStep = 0)
    assertEquals(StallCause.NO_VIDEO, rig.records("video-stalled").single().field("cause"))
    assertEquals(1, rig.sent<Command.Rebuild>().size)
  }

  @Test
  fun `a repeated mic fact is recorded once`() {
    val rig = MachineRig().live()
    rig.send(Input.MicSilenced(true))
    rig.send(Input.MicSilenced(true))
    assertEquals(1, rig.records("mic-silenced").size)
  }

  @Test
  fun `F-P5-10 between the reopen and its first frame the state holds degraded camera-taken, never connecting`() {
    // Carry 6: our own reopen is not a frame (the gate stays shut), and the camera is not back until one arrives.
    val rig = MachineRig().live()
    rig.send(Input.CameraContended)
    rig.advance(10_000, videoPerStep = 0)
    rig.send(Input.CameraReleased)
    rig.send(Input.CameraReopened(ok = true))
    val states = mutableListOf<SnapshotState>()
    rig.advance(2_500, videoPerStep = 0) { states += rig.state }
    val held = SnapshotState.Degraded(Transport.SRT, listOf(DegradeReason.CAMERA_TAKEN), 1_790_000_001_000)
    assertEquals(List<SnapshotState>(5) { held }, states)
    rig.advance(500)
    assertIs<SnapshotState.Publishing>(rig.state, "the reopened camera's first frame at 14 s")
    assertEquals(1, rig.records("camera-resumed").size)
  }

  @Test
  fun `F-P5-10 a reopened camera that shows nothing is rebuilt 3 s after the reopen, and the record says so`() {
    val rig = MachineRig().live()
    rig.send(Input.CameraContended)
    rig.advance(10_000, videoPerStep = 0)
    rig.send(Input.CameraReleased)
    rig.send(Input.CameraReopened(ok = true))
    rig.advance(3_000, videoPerStep = 0)
    val stalled = rig.records("video-stalled").single()
    assertEquals(StallCause.NO_VIDEO, stalled.field("cause"))
    // Carry 7: 3 000 ms since the reopen at 11 s; the last real frame was at 1 s.
    assertEquals(3_000L, stalled.field("msSinceAdvance"))
    assertEquals(true, stalled.field("rebaselined"))
    assertEquals(ReconnectCause.VIDEO_STALLED, assertIs<SnapshotState.Reconnecting>(rig.state).cause)
  }

  @Test
  fun `a stall after frames is counted from the last frame`() {
    val rig = MachineRig().live()
    rig.advance(3_000, videoPerStep = 0)
    val stalled = rig.records("video-stalled").single()
    assertEquals(3_000L, stalled.field("msSinceAdvance"))
    assertEquals(false, stalled.field("rebaselined"))
  }

  @Test
  fun `a second release and a second reopen answer do nothing`() {
    val rig = MachineRig().live()
    rig.send(Input.CameraContended)
    rig.send(Input.CameraReleased)
    rig.send(Input.CameraReleased)
    assertEquals(listOf(Command.ReopenCamera), rig.sent<Command.ReopenCamera>())
    rig.send(Input.CameraReopened(ok = true))
    rig.send(Input.CameraReopened(ok = true))
    assertEquals(listOf(Command.Slate(true), Command.Slate(false)), rig.sent<Command.Slate>())
  }

  @Test
  fun `a take during the reopen keeps the slate up, and the late reopen answer is ignored`() {
    val rig = MachineRig().live()
    rig.send(Input.CameraContended)
    rig.send(Input.CameraReleased)
    rig.send(Input.CameraContended)
    assertEquals(listOf(Command.Slate(true)), rig.sent<Command.Slate>(), "the slate never came down")
    assertEquals(2, rig.records("camera-taken").size)
    rig.send(Input.CameraReopened(ok = true))
    assertEquals(listOf(Command.Slate(true)), rig.sent<Command.Slate>(), "another app holds the camera again")
    rig.send(Input.CameraReleased)
    assertEquals(2, rig.sent<Command.ReopenCamera>().size)
  }

  @Test
  fun `a camera taken across a reconnect holds the new attempt too`() {
    val rig = MachineRig().live()
    rig.send(Input.CameraContended)
    rig.send(Input.Dropped(1, DropReason.ENDPOINT_CLOSED, null))
    rig.advance(2_000)
    rig.send(Input.Connected(2))
    rig.advance(10_000, videoPerStep = 0)
    assertTrue(rig.sent<Command.Rebuild>().isEmpty(), "no first frame while the slate is up is held, not rebuilt")
    rig.advance(1_000, videoPerStep = 1)
    assertEquals(listOf(DegradeReason.CAMERA_TAKEN), assertIs<SnapshotState.Degraded>(rig.state).reasons)
  }

  @Test
  fun `an empty device sample records nothing and is relayed as it is`() {
    val rig = MachineRig().live()
    val empty = DeviceSample(null, null, null, null, null, null)
    assertTrue(rig.send(Input.Device(empty)).isEmpty())
    assertEquals(empty, rig.snapshot.device)
    assertIs<SnapshotState.Publishing>(rig.state)
  }
}
