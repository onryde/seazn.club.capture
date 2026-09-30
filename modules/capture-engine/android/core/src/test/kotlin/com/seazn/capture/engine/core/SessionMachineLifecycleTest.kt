package com.seazn.capture.engine.core

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
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
    assertIs<Phase.Idle>(rig.phase)
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
    val ended = rig.phase
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
        Input.DescriptorChecked(1, DescriptorCheck.Over("stopped")),
        Input.Tick,
      )
    for (fact in facts) assertEquals(emptyList(), rig.send(fact), "$fact")
    assertEquals(EndReason.OPERATOR_STOPPED, assertIs<Phase.Ended>(ended).reason)
    assertEquals(ended, rig.phase)
  }

  @Test
  fun `ruling 14 a camera switch asks the platform, and its paused picture is not rebuilt`() {
    val rig = MachineRig().live()
    rig.advance(3_000, videoPerStep = 12)
    rig.send(Input.SwitchCamera)
    assertEquals(listOf(Command.SwitchCamera), rig.sent<Command.SwitchCamera>())
    assertEquals(1, rig.records("camera-switched").size)
    // At 24 fps, F-P5-9's window over the switch's 2.5 s gap (the new camera's first frame at 6.5 s)
    // would read 24 frames in 3 s: 8 a second, under the floor. The switch starts a fresh window, so
    // the pause is never rated. A first frame 3 s after the switch would be late (C2).
    val states = mutableListOf<SnapshotState>()
    rig.advance(2_000, videoPerStep = 0) { states += rig.state }
    rig.advance(1_000, videoPerStep = 12) { states += rig.state }
    assertTrue(rig.sent<Command.Rebuild>().isEmpty(), "rebuilt: ${rig.records("video-stalled")}")
    assertTrue(states.all { it is SnapshotState.Publishing }, "LIVE holds through the operator's own switch: $states")
  }

  @Test
  fun `ruling 14 a switched camera that shows nothing is rebuilt 3 s after its last frame`() {
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
    // Carry 7: the 3 000 ms count from the last frame before the switch (here the same instant), and the
    // line says the window was re-baselined.
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

  @Test
  fun `a stop or a reset with no session is recorded as ignored`() {
    val rig = MachineRig()
    rig.send(Input.Stop)
    rig.send(Input.Reset)
    assertEquals(Phase.Idle(), rig.phase)
    assertEquals(listOf("stop" to "idle", "reset" to "idle"), rig.records("intent-ignored").map { it.field("intent") to it.field("phase") })
    assertTrue(rig.sent<Command.End>().isEmpty())
  }

  @Test
  fun `facts about an old attempt are ignored while the next one connects and once it is on air`() {
    val rig = MachineRig().live()
    rig.send(Input.Dropped(1, DropReason.ENDPOINT_CLOSED, null))
    rig.advance(2_000)
    val requested = rig.phase
    assertEquals(emptyList(), rig.send(Input.ConnectFailed(1, ConnectFailure.OTHER, null)))
    assertEquals(requested, rig.phase, "attempt 2 is still asked for")
    rig.send(Input.Connected(2))
    val onAir = rig.phase
    val old = listOf(Input.Frames(1, 999, 999), Input.Link(1, LinkCounters(9_000_000, 1, 0, 0, 0, 20, 50, null)), Input.Dropped(1, DropReason.ENDPOINT_CLOSED, null))
    for (fact in old) {
      assertEquals(emptyList(), rig.send(fact), "$fact")
      assertEquals(onAir, rig.phase, "$fact")
    }
  }

  /** Live, the picture stopped at 1 s, and time moved to 4 s with no input: the tick at 4 s has not run. */
  private fun gateJustClosed(): MachineRig {
    val rig = MachineRig().live()
    rig.advance(2_500, videoPerStep = 0)
    assertIs<SnapshotState.Publishing>(rig.state, "3.5 s: 2.5 s since the last frame at 1 s")
    rig.mono += 500
    rig.wall += 500
    return rig
  }

  @Test
  fun `B6 ruling C2 the LIVE gate closes 3 s after the last frame, and the next input of any kind is judged a rebuild first`() {
    val inputs =
      listOf(
        Input.Frames(1, 30, 999),
        Input.Link(1, LinkCounters(1, 1, 0, 0, 0, 20, 40, null)),
        Input.Network(false),
        Input.MicSilenced(true),
        Input.Device(DeviceSample(1, null, 50, false, null, null)),
        Input.PlaylistFetched(1, FetchResult.NoContent),
        Input.HeartbeatAnswered(1, HeartbeatResponse.Failed("timeout")),
        Input.DescriptorChecked(1, DescriptorCheck.Live),
        Input.CameraContended,
        Input.Start,
        Input.Reset,
      )
    for (input in inputs) {
      val rig = gateJustClosed()
      val state = rig.state
      assertFalse(state is SnapshotState.Publishing || state is SnapshotState.Degraded, "the gate alone, with no input: $state")
      rig.send(input)
      val reconnecting = assertIs<SnapshotState.Reconnecting>(rig.state, "$input")
      assertEquals(ReconnectCause.VIDEO_STALLED, reconnecting.cause, "$input")
      assertEquals(StallCause.NO_VIDEO, rig.records("video-stalled").single().field("cause"), "$input")
      assertEquals(1, rig.sent<Command.Rebuild>().size, "$input")
    }
  }

  @Test
  fun `B6 ruling C2 the tick keeps its own order - a hold that ends as a rebuild falls due ends without it`() {
    val rig = MachineRig(Configs.valid(holdWindowSeconds = mapOf(Transport.SRT to 7, Transport.RTMPS to 7))).live()
    rig.send(Input.Dropped(1, DropReason.ENDPOINT_CLOSED, null))
    rig.advance(2_000)
    // 3 s: the first-frame grace runs out at 8 s, the moment the 7 s hold from the drop at 1 s does.
    rig.send(Input.Connected(2))
    rig.advance(4_500, feeding = false)
    assertIs<SnapshotState.Reconnecting>(rig.state)
    rig.advance(500, feeding = false)
    assertEquals(SnapshotState.Ended(EndReason.HOLD_WINDOW_EXPIRED), rig.state)
    assertTrue(rig.sent<Command.Rebuild>().isEmpty(), "the session is over: nothing to rebuild")
  }

  @Test
  fun `B6 ruling C2 a frame that lands after the window closed is late - the rebuild was judged first`() {
    val rig = gateJustClosed()
    rig.send(Input.Frames(1, 45, 999))
    assertEquals(3_000L, rig.records("video-stalled").single().field("msSinceAdvance"))
    assertTrue(rig.records("resumed").isEmpty())
    assertIs<SnapshotState.Reconnecting>(rig.state)
  }

  @Test
  fun `B6 review I1 a switch after the LIVE gate closed cannot re-open LIVE`() {
    val rig = gateJustClosed()
    rig.send(Input.SwitchCamera)
    assertEquals(ReconnectCause.VIDEO_STALLED, assertIs<SnapshotState.Reconnecting>(rig.state).cause)
    assertEquals(listOf(Command.SwitchCamera), rig.sent<Command.SwitchCamera>(), "the operator's switch still goes")
    assertTrue(rig.commands.indexOfFirst { it is Command.Rebuild } < rig.commands.indexOf(Command.SwitchCamera), "judged first")
    val states = mutableListOf<SnapshotState>()
    rig.advance(3_000, videoPerStep = 0) { states += rig.state }
    assertTrue(states.none { it is SnapshotState.Publishing || it is SnapshotState.Degraded }, "$states")
  }

  /**
   * Live with frames to 4 s, then a switch at 4.2 s. The ticks then fall at 4.8, 5.3 … s, so the 3 s
   * from the last frame (7.0 s) lands between two ticks.
   */
  private fun switchedOffGrid(): MachineRig {
    val rig = MachineRig().live()
    rig.advance(3_000)
    rig.mono += 200
    rig.wall += 200
    rig.send(Input.SwitchCamera)
    rig.mono += 100
    rig.wall += 100
    return rig
  }

  @Test
  fun `B6 review m4 a switch holds LIVE for 3 s plus at most one tick`() {
    val rig = switchedOffGrid()
    val states = mutableListOf<SnapshotState>()
    rig.advance(2_500, feeding = false) { states += rig.state }
    assertEquals(5, states.size)
    assertTrue(states.all { it is SnapshotState.Publishing }, "ticks at 4.8 to 6.8 s: $states")
    // 7.0 s is 3 s after the last frame. With no other input, the tick at 7.3 s is the first to judge it.
    rig.advance(500, feeding = false)
    assertEquals(ReconnectCause.VIDEO_STALLED, assertIs<SnapshotState.Reconnecting>(rig.state).cause)
    assertEquals(3_300L, rig.records("video-stalled").single().field("msSinceAdvance"))
  }

  @Test
  fun `B6 review m4 any input from 3 s after the last frame closes LIVE without waiting for the tick`() {
    val rig = switchedOffGrid()
    rig.advance(2_500, feeding = false)
    rig.mono += 200
    rig.wall += 200
    assertIs<SnapshotState.Publishing>(rig.state, "7.0 s, projected with no input")
    rig.send(Input.Network(true))
    assertEquals(ReconnectCause.VIDEO_STALLED, assertIs<SnapshotState.Reconnecting>(rig.state).cause)
    assertEquals(3_000L, rig.records("video-stalled").single().field("msSinceAdvance"))
  }

  @Test
  fun `B6 fix 2 (T2) a switch mid-stall cannot stretch LIVE past 3 s from the last frame`() {
    val rig = MachineRig().live()
    rig.advance(2_500, videoPerStep = 0)
    rig.send(Input.SwitchCamera)
    assertEquals(listOf(Command.SwitchCamera), rig.sent<Command.SwitchCamera>())
    assertIs<SnapshotState.Publishing>(rig.state, "3.5 s: 2.5 s since the last frame at 1 s")
    rig.advance(500, feeding = false)
    assertEquals(ReconnectCause.VIDEO_STALLED, assertIs<SnapshotState.Reconnecting>(rig.state).cause, "4 s: 3 s since the last frame")
    val stalled = rig.records("video-stalled").single()
    assertEquals(3_000L, stalled.field("msSinceAdvance"))
    assertEquals(true, stalled.field("rebaselined"))
  }

  @Test
  fun `B6 fix 2 a stop in the C2 gap ends the session and sends no rebuild first`() {
    val rig = gateJustClosed()
    val commands = rig.send(Input.Stop)
    assertEquals(listOf(Command.End(EndReason.OPERATOR_STOPPED)), commands.filterNot { it is Command.Record })
    assertTrue(rig.records("video-stalled").isEmpty())
    assertEquals(SnapshotState.Ended(EndReason.OPERATOR_STOPPED), rig.state)
    assertEquals(true, rig.records("ended").single().field("wasLive"))
  }

  @Test
  fun `B6 review m3 attempt ids never repeat across sessions, so a late connect from the last one is closed`() {
    val rig = MachineRig().armed()
    rig.send(Input.Start)
    rig.send(Input.Stop)
    rig.send(Input.Reset)
    rig.armed()
    rig.send(Input.Start)
    assertEquals(listOf(1, 2), rig.connects().map { it.attemptId })
    rig.send(Input.Connected(1))
    assertEquals(listOf(Command.Disconnect(1)), rig.sent<Command.Disconnect>(), "the first session's late answer")
    assertEquals(ConnectStep.Requested(2, 0), assertIs<Phase.Connecting>(rig.phase).step)
    rig.send(Input.Connected(2))
    assertIs<Phase.OnAir>(rig.phase)
  }

  @Test
  fun `B6 review m3 ids outlive a refused arm too`() {
    val rig = MachineRig().armed()
    rig.send(Input.Start)
    rig.send(Input.Stop)
    rig.send(Input.Reset)
    val refused =
      SessionConfig("sess_42", Configs.TOKEN, Configs.srt, Configs.rtmps, mapOf(Transport.SRT to 183, Transport.RTMPS to 180), "", "https://h/", "1.0.0")
    rig.send(Input.Arm(refused))
    assertEquals(SnapshotState.Ended(EndReason.FATAL_ERROR), rig.state, "refused")
    rig.send(Input.Reset)
    rig.armed()
    rig.send(Input.Start)
    assertEquals(listOf(1, 2), rig.connects().map { it.attemptId })
  }

  @Test
  fun `B6 review m3 a late heartbeat answer from the last session changes nothing in the next`() {
    val rig = MachineRig().armed()
    rig.advance(500)
    rig.send(Input.Stop)
    rig.send(Input.Reset)
    rig.armed()
    rig.advance(500)
    assertEquals(listOf(1, 2), rig.sent<Command.PostHeartbeat>().map { it.beatId })
    assertEquals(emptyList(), rig.send(Input.HeartbeatAnswered(1, HeartbeatResponse.Answered(410, null, null))))
    assertIs<Phase.Armed>(rig.phase)
    rig.send(Input.HeartbeatAnswered(2, HeartbeatResponse.Answered(410, null, null)))
    assertEquals(SnapshotState.Ended(EndReason.STOPPED_BY_ORGANISER), rig.state)
  }

  @Test
  fun `B6 review m3 playlist request ids carry on into the next session`() {
    val rig = MachineRig().live()
    rig.advance(1_000)
    val first = rig.sent<Command.FetchPlaylist>().map { it.requestId }
    rig.send(Input.Stop)
    rig.send(Input.Reset)
    rig.live()
    rig.advance(1_000)
    val second = rig.sent<Command.FetchPlaylist>().map { it.requestId } - first.toSet()
    assertTrue(first.isNotEmpty() && second.isNotEmpty(), "$first / $second")
    assertTrue(second.all { it > first.max() }, "$first then $second")
  }

  @Test
  fun `ruling 14 a switch after the new camera is back starts a window of its own`() {
    val rig = MachineRig().live()
    rig.advance(3_000)
    rig.send(Input.SwitchCamera)
    // 4.5 s is the new camera's baseline, 5 s its first advance: the camera is ours again.
    rig.advance(1_000)
    assertEquals(1, rig.records("camera-resumed").size)
    rig.send(Input.SwitchCamera)
    rig.advance(3_000, videoPerStep = 0)
    val stalled = rig.records("video-stalled").single()
    assertEquals(3_000L, stalled.field("msSinceAdvance"))
    assertEquals(true, stalled.field("rebaselined"), "counted from the second switch at 5 s")
  }

  @Test
  fun `F-P5-4 a no-first-frame rebuild counts from the connect, and is not re-baselined`() {
    val rig = MachineRig().armed()
    rig.send(Input.Start)
    rig.send(Input.Connected(1))
    rig.advance(5_000, videoPerStep = 0)
    val stalled = rig.records("video-stalled").single()
    assertEquals(StallCause.NO_FIRST_FRAME, stalled.field("cause"))
    assertEquals(5_000L, stalled.field("msSinceAdvance"))
    assertEquals(false, stalled.field("rebaselined"))
  }
}
