package com.seazn.capture.engine.core

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertIs
import kotlin.test.assertTrue

class SessionMachineLifecycleTest {
  @Test
  fun `arm, start, connect and advancing frames is LIVE`() {
    val rig = MachineRig().live()
    val state = assertIs<SnapshotState.Publishing>(rig.state)
    assertEquals(Transport.SRT, state.transport)
    assertEquals(1_790_000_001_000, state.sinceEpochMs, "live since the first encoded frame")
  }

  @Test
  fun `F-P5-6 connected without an encoded frame is not LIVE, whatever egress says`() {
    // F-P5-3: the spike's sampler said streaming=true, 4.4 Mbps, while nothing was delivered.
    val rig = MachineRig().armed()
    rig.send(Input.Start)
    val attempt = rig.attempt!!
    rig.send(Input.Connected(attempt))
    rig.send(Input.Link(attempt, LinkCounters(0, 0, 0, 0, 0, 20, 50, null)))
    rig.advance(1_000, feeding = false)
    rig.send(Input.Link(attempt, LinkCounters(500_000, 0, 0, 0, 0, 20, 50, null)))
    assertEquals(4_000, rig.snapshot.bitrateKbps)
    assertEquals(SnapshotState.Connecting(Transport.SRT), rig.state)
  }

  @Test
  fun `F-P5-4 audio with video flat is never LIVE, and the first-frame grace ends in a rebuild`() {
    val rig = MachineRig().armed()
    rig.send(Input.Start)
    rig.send(Input.Connected(rig.attempt!!))
    val states = mutableListOf<SnapshotState>()
    rig.advance(5_000, videoPerStep = 0) { states += rig.state }
    assertTrue(states.none { it is SnapshotState.Publishing || it is SnapshotState.Degraded }, "got $states")
    assertEquals(1, rig.sent<Command.Rebuild>().size)
  }

  @Test
  fun `F-P5-6 video stopping for 3 s rebuilds the pipeline and leaves LIVE`() {
    val rig = MachineRig().live()
    rig.advance(2_500, videoPerStep = 0)
    assertIs<SnapshotState.Publishing>(rig.state, "2.5 s without a frame is still inside the window")
    assertTrue(rig.sent<Command.Rebuild>().isEmpty())
    rig.advance(500, videoPerStep = 0)
    val rebuild = rig.sent<Command.Rebuild>().single()
    assertEquals(1, rebuild.previousAttemptId)
    assertEquals(2, rebuild.next.attemptId)
    val state = assertIs<SnapshotState.Reconnecting>(rig.state)
    assertEquals(ReconnectCause.VIDEO_STALLED, state.cause)
    assertEquals(1, rig.records("video-stalled").size)
  }

  @Test
  fun `a double start is one attempt`() {
    val rig = MachineRig().armed()
    rig.send(Input.Start)
    rig.send(Input.Start)
    assertEquals(1, rig.connects().size)
    assertEquals(listOf("start" to "connecting"), rig.records("intent-ignored").map { it.fields[0].second to it.fields[1].second })
  }

  @Test
  fun `stop ends operator-stopped, and a second stop does nothing`() {
    val rig = MachineRig().live()
    rig.send(Input.Stop)
    assertEquals(SnapshotState.Ended(EndReason.OPERATOR_STOPPED), rig.state)
    rig.send(Input.Stop)
    assertEquals(listOf(Command.End(EndReason.OPERATOR_STOPPED)), rig.sent<Command.End>())
  }

  @Test
  fun `stop from armed ends, reset returns to idle, and a new arm works`() {
    val rig = MachineRig().armed()
    rig.send(Input.Stop)
    assertIs<Phase.Ended>(rig.phase)
    rig.send(Input.Reset)
    assertEquals(Phase.Idle, rig.phase)
    rig.send(Input.Arm(Configs.valid()))
    assertIs<Phase.Armed>(rig.phase)
  }

  @Test
  fun `an arm while live is ignored - the engine is the authority`() {
    val rig = MachineRig().live()
    val before = rig.phase
    rig.send(Input.Arm(Configs.valid(primary = Configs.rtmps, fallback = Configs.srt)))
    assertEquals(before, rig.phase)
    assertEquals(1, rig.records("intent-ignored").size)
  }

  @Test
  fun `a reset while live is refused`() {
    val rig = MachineRig().live()
    rig.send(Input.Reset)
    assertIs<Phase.OnAir>(rig.phase)
  }

  @Test
  fun `an arm with an empty descriptor field ends fatal-error and says why`() {
    val empty =
      SessionConfig("sess_42", Configs.TOKEN, Configs.srt, Configs.rtmps, mapOf(Transport.SRT to 183, Transport.RTMPS to 180), "", "https://h/", "1.0.0")
    val rig = MachineRig(empty)
    rig.send(Input.Arm(empty))
    assertEquals(SnapshotState.Ended(EndReason.FATAL_ERROR), rig.state)
    assertEquals("playbackUrl is not https", rig.records("arm-refused").single().fields.single().second)
  }

  @Test
  fun `a fact about an old attempt is ignored, and an old connect is closed`() {
    val rig = MachineRig().live()
    rig.send(Input.Dropped(1, DropReason.ENDPOINT_CLOSED, null))
    rig.advance(2_000)
    val waiting = rig.phase
    rig.send(Input.Dropped(1, DropReason.ENDPOINT_CLOSED, null))
    assertEquals(waiting, rig.phase)
    rig.send(Input.Connected(1))
    assertEquals(Command.Disconnect(1), rig.sent<Command.Disconnect>().single())
    rig.send(Input.Connected(2))
    assertEquals(2, (rig.phase as Phase.OnAir).attemptId)
  }

  @Test
  fun `a drop mid-connect is a failed connect, retried 2 s later`() {
    val rig = MachineRig().armed()
    rig.send(Input.Start)
    rig.send(Input.Dropped(1, DropReason.ENDPOINT_CLOSED, "Connection was broken"))
    assertEquals(1, rig.records("connect-failed").size)
    rig.advance(1_500)
    assertEquals(1, rig.connects().size)
    rig.advance(500)
    assertEquals(listOf(1, 2), rig.connects().map { it.attemptId })
  }

  @Test
  fun `a connect that never answers fails at 15 s`() {
    val rig = MachineRig().armed()
    rig.send(Input.Start)
    rig.advance(14_500)
    assertTrue(rig.sent<Command.Disconnect>().isEmpty())
    rig.advance(500)
    assertEquals(Command.Disconnect(1), rig.sent<Command.Disconnect>().single())
    assertEquals(ConnectFailure.TIMEOUT, rig.records("connect-failed").single().fields.first { it.first == "failure" }.second)
    rig.advance(2_000)
    assertEquals(2, rig.connects().size)
  }

  @Test
  fun `a double arm is one session, and the second is recorded as ignored`() {
    val rig = MachineRig().armed()
    val first = rig.phase
    rig.send(Input.Arm(Configs.valid(primary = Configs.rtmps, fallback = Configs.srt)))
    assertEquals(first, rig.phase)
    assertEquals(listOf("arm" to "armed"), rig.records("intent-ignored").map { it.field("intent") to it.field("phase") })
  }

  @Test
  fun `a repeated connected for the live attempt closes nothing`() {
    val rig = MachineRig().live()
    val before = rig.phase
    assertEquals(emptyList(), rig.send(Input.Connected(1)))
    assertEquals(before, rig.phase)
  }

  @Test
  fun `a repeated network fact is recorded once`() {
    val rig = MachineRig().armed(validated = true)
    rig.send(Input.Network(true))
    assertEquals(listOf<Any?>(true), rig.records("network").map { it.field("validated") })
  }

  @Test
  fun `stop while reconnecting ends operator-stopped, and says it had been live`() {
    val rig = MachineRig().live()
    rig.send(Input.Dropped(1, DropReason.ENDPOINT_CLOSED, null))
    rig.send(Input.Stop)
    assertEquals(SnapshotState.Ended(EndReason.OPERATOR_STOPPED), rig.state)
    assertEquals(true, rig.records("ended").single().field("wasLive"))
  }

  @Test
  fun `facts that land after the end change nothing and ask nothing`() {
    val rig = MachineRig().live()
    rig.send(Input.Stop)
    val facts =
      listOf(
        Input.Frames(1, 99, 99),
        Input.Link(1, LinkCounters(1, 1, 0, 0, 0, 20, 40, null)),
        Input.Dropped(1, DropReason.ENDPOINT_CLOSED, null),
        Input.ConnectFailed(1, ConnectFailure.OTHER, null),
        Input.Network(false),
        Input.CameraContended,
        Input.CameraReleased,
        Input.CameraReopened(true),
        Input.MicSilenced(true),
        Input.Device(DeviceSample(3, null, 50, false, null, null)),
        Input.PlaylistFetched(1, FetchResult.NoContent),
        Input.HeartbeatAnswered(1, HeartbeatResponse.Answered(200, "ending", "stopped")),
        Input.DescriptorChecked(DescriptorCheck.Over("stopped")),
        Input.Tick,
      )
    for (fact in facts) assertEquals(emptyList(), rig.send(fact), "$fact")
    assertEquals(Phase.Ended(EndReason.OPERATOR_STOPPED), rig.phase)
  }

  @Test
  fun `ruling 14 a camera switch asks the platform, and its paused picture is not rebuilt`() {
    val rig = MachineRig().live()
    rig.advance(3_000)
    rig.send(Input.SwitchCamera)
    assertEquals(listOf(Command.SwitchCamera), rig.sent<Command.SwitchCamera>())
    assertEquals(1, rig.records("camera-switched").size)
    // F-P5-9's window over a 2.5 s pause would read 15 frames in 3 s: 5 a second, under the floor.
    // The switch starts a fresh window, so the pause is never rated.
    val states = mutableListOf<SnapshotState>()
    rig.advance(2_500, videoPerStep = 0) { states += rig.state }
    rig.advance(1_000) { states += rig.state }
    assertTrue(rig.sent<Command.Rebuild>().isEmpty(), "rebuilt: ${rig.records("video-stalled")}")
    assertTrue(states.all { it is SnapshotState.Publishing }, "LIVE holds through the operator's own switch: $states")
  }

  @Test
  fun `ruling 14 a switched camera that shows nothing is rebuilt 3 s after the switch`() {
    val rig = MachineRig().live()
    rig.advance(3_000)
    rig.send(Input.SwitchCamera)
    rig.advance(2_500, videoPerStep = 0)
    assertTrue(rig.sent<Command.Rebuild>().isEmpty())
    assertIs<SnapshotState.Publishing>(rig.state)
    rig.advance(500, videoPerStep = 0)
    assertEquals(1, rig.sent<Command.Rebuild>().size)
    assertEquals(ReconnectCause.VIDEO_STALLED, assertIs<SnapshotState.Reconnecting>(rig.state).cause)
    val stalled = rig.records("video-stalled").single()
    assertEquals(StallCause.NO_VIDEO, stalled.field("cause"))
    // Carry 7: the 3 000 ms count from the switch, not from a frame, and the line says so.
    assertEquals(3_000L, stalled.field("msSinceAdvance"))
    assertEquals(true, stalled.field("rebaselined"))
  }

  @Test
  fun `ruling 14 a second switch before the new camera's first frame keeps the first switch's window`() {
    val rig = MachineRig().live()
    rig.advance(3_000)
    rig.send(Input.SwitchCamera)
    rig.advance(2_000, videoPerStep = 0)
    rig.send(Input.SwitchCamera)
    assertEquals(2, rig.sent<Command.SwitchCamera>().size, "each switch is the operator's intent")
    rig.advance(1_000, videoPerStep = 0)
    assertEquals(1, rig.sent<Command.Rebuild>().size, "LIVE with no new frame is bounded by the first switch's 3 s")
  }

  @Test
  fun `ruling 14 a switch before the first frame leaves the first-frame grace alone`() {
    val rig = MachineRig().armed()
    rig.send(Input.Start)
    rig.send(Input.Connected(1))
    rig.send(Input.SwitchCamera)
    assertEquals(listOf(Command.SwitchCamera), rig.sent<Command.SwitchCamera>())
    rig.advance(4_500, videoPerStep = 0)
    assertTrue(rig.sent<Command.Rebuild>().isEmpty(), "the encoders get their 5 s (F-P5-6's grace)")
    rig.advance(500, videoPerStep = 0)
    assertEquals(StallCause.NO_FIRST_FRAME, rig.records("video-stalled").single().field("cause"))
  }

  @Test
  fun `ruling 14 a switch while armed switches the preview camera`() {
    val rig = MachineRig().armed()
    rig.send(Input.SwitchCamera)
    assertEquals(listOf(Command.SwitchCamera), rig.sent<Command.SwitchCamera>())
    assertIs<Phase.Armed>(rig.phase)
  }

  @Test
  fun `ruling 14 a switch with no session, or with the slate on air, is ignored`() {
    val idle = MachineRig()
    idle.send(Input.SwitchCamera)
    assertEquals(listOf("switch-camera" to "idle"), idle.records("intent-ignored").map { it.field("intent") to it.field("phase") })

    val held = MachineRig().live()
    held.send(Input.CameraContended)
    held.send(Input.SwitchCamera)
    held.send(Input.CameraReleased)
    held.send(Input.SwitchCamera)
    assertTrue(held.sent<Command.SwitchCamera>().isEmpty(), "no camera of ours to switch while the slate is up")
    assertEquals(2, held.records("intent-ignored").size)
  }
}
