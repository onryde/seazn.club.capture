package com.seazn.capture.engine.core

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertIs
import kotlin.test.assertNull
import kotlin.test.assertTrue

class SessionMachineOutageTest {
  /** Answers every connect with [failure] as soon as it is asked for. */
  private fun MachineRig.failingConnects(ms: Long, failure: ConnectFailure = ConnectFailure.UNRESOLVED) =
    advance(ms) {
      val step = (phase as? Phase.Connecting)?.step
      if (step is ConnectStep.Requested) send(Input.ConnectFailed(step.attemptId, failure, null))
    }

  @Test
  fun `C2 an uplink drop counts down the transport's hold - 38 s of 183`() {
    val rig = MachineRig().live()
    val since = (rig.state as SnapshotState.Publishing).sinceEpochMs
    rig.send(Input.Network(validated = false))
    rig.send(Input.Dropped(1, DropReason.ENDPOINT_CLOSED, null))
    rig.failingConnects(145_000)
    assertEquals(SnapshotState.Reconnecting(ReconnectCause.UPLINK_LOST, 38, 183, since), rig.state)
    assertTrue(rig.connects().all { it.target is SrtTarget }, "a dead network never falls back (F-P5-1)")
  }

  @Test
  fun `the hold's expiry ends the session hold-window-expired`() {
    val rig = MachineRig().live()
    rig.send(Input.Network(validated = false))
    rig.send(Input.Dropped(1, DropReason.ENDPOINT_CLOSED, null))
    rig.failingConnects(182_500)
    assertIs<SnapshotState.Reconnecting>(rig.state)
    rig.failingConnects(500)
    assertEquals(SnapshotState.Ended(EndReason.HOLD_WINDOW_EXPIRED), rig.state)
  }

  @Test
  fun `F-P5-6 connected again after an outage is not LIVE until a frame advances`() {
    // The LIVE gate after a reconnect: the session has a live-since time, and still is not on air.
    val rig = MachineRig().live()
    rig.send(Input.Dropped(1, DropReason.ENDPOINT_CLOSED, null))
    rig.advance(2_000)
    rig.send(Input.Connected(2))
    rig.advance(1_000, feeding = false)
    assertIs<SnapshotState.Reconnecting>(rig.state)
    rig.advance(500)
    assertIs<SnapshotState.Reconnecting>(rig.state, "one reading is a baseline, not an advance")
    rig.advance(500)
    assertIs<SnapshotState.Publishing>(rig.state)
  }

  @Test
  fun `frames after a reconnect clear the outage and keep the live-since time`() {
    val rig = MachineRig().live()
    val since = (rig.state as SnapshotState.Publishing).sinceEpochMs
    rig.send(Input.Dropped(1, DropReason.ENDPOINT_CLOSED, null))
    rig.advance(2_000)
    rig.send(Input.Connected(2))
    rig.advance(1_000)
    assertEquals(SnapshotState.Publishing(Transport.SRT, since), rig.state)
    assertEquals(1, rig.records("resumed").size)
  }

  @Test
  fun `a drop before the first frame is a retry with no hold`() {
    val rig = MachineRig().armed()
    rig.send(Input.Start)
    rig.send(Input.Connected(1))
    rig.send(Input.Dropped(1, DropReason.ENDPOINT_CLOSED, null))
    assertNull((rig.phase as Phase.Connecting).outage)
    assertEquals(SnapshotState.Connecting(Transport.SRT), rig.state)
  }

  @Test
  fun `F-P5-2 short-lived SRT sessions fall back to RTMPS`() {
    val rig = MachineRig().live()
    repeat(3) {
      rig.advance(6_000)
      rig.send(Input.Dropped(rig.attempt!!, DropReason.ENDPOINT_CLOSED, "Connection was broken"))
      rig.advance(2_000)
      rig.send(Input.Connected(rig.attempt!!))
    }
    assertEquals(listOf(Transport.SRT, Transport.SRT, Transport.SRT, Transport.RTMPS), rig.connects().map { it.target.transport })
    rig.advance(1_000)
    assertEquals(listOf(DegradeReason.FELL_BACK_TO_RTMPS), (rig.state as SnapshotState.Degraded).reasons)
    assertEquals(1, rig.records("fell-back").size)
  }

  @Test
  fun `C1 three validated connect failures fall back, and a dead network never does`() {
    val validated = MachineRig().armed(validated = true)
    validated.send(Input.Start)
    validated.failingConnects(6_500, ConnectFailure.TIMEOUT)
    assertEquals(Transport.RTMPS, validated.connects()[3].target.transport)

    val dead = MachineRig().armed(validated = false)
    dead.send(Input.Start)
    dead.failingConnects(40_000, ConnectFailure.TIMEOUT)
    assertTrue(dead.connects().size >= 20)
    assertTrue(dead.connects().all { it.target.transport == Transport.SRT })
  }

  @Test
  fun `every reconnect fetches the descriptor again`() {
    val rig = MachineRig().live()
    rig.send(Input.Dropped(1, DropReason.ENDPOINT_CLOSED, null))
    assertEquals(listOf(Command.FetchDescriptor(1)), rig.sent<Command.FetchDescriptor>())
  }

  @Test
  fun `a descriptor that says the session is over ends stopped-by-organiser`() {
    val rig = MachineRig().live()
    rig.send(Input.Dropped(1, DropReason.ENDPOINT_CLOSED, null))
    rig.send(Input.DescriptorChecked(1, DescriptorCheck.Over("stopped")))
    assertEquals(SnapshotState.Ended(EndReason.STOPPED_BY_ORGANISER), rig.state)
    assertEquals(Command.End(EndReason.STOPPED_BY_ORGANISER), rig.sent<Command.End>().single())
  }

  @Test
  fun `refused ingest asks the descriptor, and a live answer keeps trying`() {
    val rig = MachineRig().armed()
    rig.send(Input.Start)
    rig.send(Input.ConnectFailed(1, ConnectFailure.REFUSED, "publish rejected"))
    assertEquals(1, rig.sent<Command.FetchDescriptor>().size)
    rig.send(Input.DescriptorChecked(1, DescriptorCheck.Live))
    rig.advance(2_000)
    assertEquals(2, rig.connects().size)
  }

  @Test
  fun `F-P5-11 an SRT connect carries SRTO_MAXBW from the target, and RTMPS none`() {
    val srt = MachineRig().armed()
    srt.send(Input.Start)
    assertEquals(468_050, srt.connects().single().maxBwBytesPerSecond)
    assertEquals(1_500_000, srt.connects().single().startBitrateBps)
    val rtmps = MachineRig(Configs.valid(primary = Configs.rtmps, fallback = Configs.srt)).armed()
    rtmps.send(Input.Start)
    assertNull(rtmps.connects().single().maxBwBytesPerSecond)
  }

  /** 4 Mbps on a clean link, with optional trouble from [troubleAtMs] on. */
  private fun cleanLink(troubleAtMs: Long = Long.MAX_VALUE, trouble: (LinkCounters) -> LinkCounters = { it }): (Long) -> LinkCounters {
    var bytes = 0L
    return { t ->
      bytes += 500_000
      val clean = LinkCounters(bytes, t, 0, 0, 0, 20, 50, null)
      if (t >= troubleAtMs) trouble(clean) else clean
    }
  }

  @Test
  fun `a raise sets the bitrate and SRTO_MAXBW together`() {
    val rig = MachineRig()
    rig.link = cleanLink()
    rig.live()
    rig.advance(12_000)
    assertEquals(listOf(Command.SetBitrate(1, 1_600_000)), rig.sent<Command.SetBitrate>())
    // (1_600_000 + 128_000) × 115% × 2 / 8 = 496_800.
    assertEquals(listOf(Command.SetMaxBw(1, 496_800)), rig.sent<Command.SetMaxBw>())
  }

  @Test
  fun `regulator restart - a clean far-end drop reconnects at the last healthy target`() {
    val rig = MachineRig()
    rig.link = cleanLink(troubleAtMs = 15_000) { it.copy(sendBufferMs = 1_200) }
    rig.live()
    rig.advance(14_000)
    assertEquals(1_200_000, rig.sent<Command.SetBitrate>().last().bps, "the fill cut 1600k by a quarter")
    rig.send(Input.Dropped(1, DropReason.ENDPOINT_CLOSED, null))
    rig.advance(2_000)
    assertEquals(1_600_000, rig.connects().last().startBitrateBps)
  }

  @Test
  fun `regulator restart - a link that was losing packets halves`() {
    val rig = MachineRig()
    rig.link = cleanLink(troubleAtMs = 14_000) { it.copy(packetsLost = 5) }
    rig.live()
    rig.advance(13_000)
    rig.send(Input.Dropped(1, DropReason.ENDPOINT_CLOSED, null))
    rig.advance(2_000)
    assertEquals(800_000, rig.connects().last().startBitrateBps)
  }

  @Test
  fun `regulator restart - a clean far-end restart does not show poor uplink`() {
    // Carry 16: the restart undid the cut, so the cut no longer describes the link.
    val rig = MachineRig()
    rig.link = cleanLink(troubleAtMs = 15_000) { it.copy(sendBufferMs = 1_200) }
    rig.live()
    rig.advance(14_000)
    assertEquals(listOf(DegradeReason.POOR_UPLINK), assertIs<SnapshotState.Degraded>(rig.state).reasons, "the cut at 15 s shows")
    rig.send(Input.Dropped(1, DropReason.ENDPOINT_CLOSED, null))
    rig.link = cleanLink()
    rig.advance(2_000)
    rig.send(Input.Connected(2))
    rig.advance(1_000)
    // 18 s: 3 s after the cut, well inside POOR_UPLINK_MS, and publishing at the healthy 1600k.
    assertEquals(SnapshotState.Publishing(Transport.SRT, 1_790_000_001_000), rig.state)
  }

  @Test
  fun `regulator restart - a halving restart still shows poor uplink`() {
    val rig = MachineRig()
    rig.link = cleanLink(troubleAtMs = 14_000) { it.copy(packetsLost = 5) }
    rig.live()
    rig.advance(13_000)
    rig.send(Input.Dropped(1, DropReason.ENDPOINT_CLOSED, null))
    rig.link = cleanLink()
    rig.advance(2_000)
    rig.send(Input.Connected(2))
    rig.advance(1_000)
    assertEquals(listOf(DegradeReason.POOR_UPLINK), assertIs<SnapshotState.Degraded>(rig.state).reasons)
  }

  @Test
  fun `a regulator cut shows poor uplink for 30 s`() {
    val rig = MachineRig()
    var bytes = 0L
    // One backlogged reading at 15 s (1 200 ms of send buffer, over half of SRT's 2 000 ms latency); clean otherwise.
    rig.link = { t ->
      bytes += 500_000
      LinkCounters(bytes, t, 0, 0, 0, 20, if (t == 15_000L) 1_200 else 50, null)
    }
    rig.live()
    rig.advance(14_000)
    assertEquals(1_200_000, rig.sent<Command.SetBitrate>().last().bps, "cut at 15 s")
    rig.advance(29_500)
    assertEquals(listOf(DegradeReason.POOR_UPLINK), assertIs<SnapshotState.Degraded>(rig.state).reasons, "44.5 s: 29.5 s after the cut")
    rig.advance(500)
    assertIs<SnapshotState.Publishing>(rig.state, "45 s: 30 s after the cut")
  }

  @Test
  fun `F-P5-5 a link's first reading after a connect counts from the connect - its drops cut and its bytes count`() {
    // Carry 13: the counters restart at zero on every connect, and the meter starts there.
    val rig = MachineRig().live()
    rig.send(Input.Link(1, LinkCounters(250_000, 400, 0, 3, 0, 20, 40, null)))
    // Three sender drops since the connect: F-P5-5 halves 1500k.
    assertEquals(listOf(Command.SetBitrate(1, 750_000)), rig.sent<Command.SetBitrate>())
    assertEquals(250_000, rig.snapshot.dataUsedBytes)
    // 250 000 bytes in the 1 000 ms since the connect at 0: 2 000 kbps.
    assertEquals(2_000, rig.snapshot.bitrateKbps)
  }

  @Test
  fun `with no link reading the snapshot claims no bitrate and no SRT counters`() {
    val snapshot = MachineRig().live().snapshot
    assertNull(snapshot.bitrateKbps)
    assertNull(snapshot.srt)
    assertEquals(0, snapshot.dataUsedBytes)
    assertEquals(1_500, snapshot.targetBitrateKbps, "the start target (decision 3)")
  }

  /**
   * Answers every connect with a refusal, and every descriptor fetch at once with [answer] (none when
   * null). Returns when each fetch was asked for.
   */
  private fun MachineRig.refusedConnects(ms: Long, answer: DescriptorCheck?): List<Long> {
    val asked = mutableListOf<Long>()
    advance(ms) {
      val step = (phase as? Phase.Connecting)?.step
      if (step is ConnectStep.Requested) {
        val commands = send(Input.ConnectFailed(step.attemptId, ConnectFailure.REFUSED, "publish rejected"))
        val fetch = commands.filterIsInstance<Command.FetchDescriptor>().singleOrNull()
        if (fetch != null) asked += mono
        if (answer != null && fetch != null) send(Input.DescriptorChecked(fetch.requestId, answer))
      }
    }
    return asked
  }

  @Test
  fun `B6 ruling C1 refused connects before the first frame ask the descriptor at most once per 10 s`() {
    val rig = MachineRig().armed()
    rig.send(Input.Start)
    assertEquals(listOf(500L, 10_500L, 20_500L, 30_500L, 40_500L, 50_500L), rig.refusedConnects(60_000, DescriptorCheck.Live))
    assertEquals(30, rig.records("connect-failed").size, "refused every 2 s")
  }

  @Test
  fun `B6 ruling C1 never with an ask in flight - an unanswered ask holds the next until it is given up at 30 s`() {
    val rig = MachineRig().armed()
    rig.send(Input.Start)
    assertEquals(listOf(500L, 30_500L), rig.refusedConnects(60_000, answer = null))
  }

  @Test
  fun `B6 ruling C1 within an outage the drop asks, and the refusals after it keep the spacing`() {
    val rig = MachineRig().live()
    rig.send(Input.Dropped(1, DropReason.ENDPOINT_CLOSED, null))
    assertEquals(listOf(Command.FetchDescriptor(1)), rig.sent<Command.FetchDescriptor>(), "the drop asks at 1 s")
    rig.send(Input.DescriptorChecked(1, DescriptorCheck.Live))
    assertEquals(listOf(11_000L, 21_000L, 31_000L), rig.refusedConnects(30_000, DescriptorCheck.Live))
  }

  @Test
  fun `B6 review I2 a late descriptor answer from the last session changes nothing in the next`() {
    val rig = MachineRig().live()
    rig.send(Input.Dropped(1, DropReason.ENDPOINT_CLOSED, null))
    rig.send(Input.Stop)
    rig.send(Input.Reset)
    rig.armed()
    assertEquals(emptyList(), rig.send(Input.DescriptorChecked(1, DescriptorCheck.Over("no_inbound_timeout"))))
    assertIs<Phase.Armed>(rig.phase)
    rig.send(Input.Start)
    rig.send(Input.ConnectFailed(rig.attempt!!, ConnectFailure.REFUSED, "publish rejected"))
    assertEquals(listOf(1, 2), rig.sent<Command.FetchDescriptor>().map { it.requestId }, "ids carry on across sessions")
    assertEquals(emptyList(), rig.send(Input.DescriptorChecked(1, DescriptorCheck.Over("no_inbound_timeout"))))
    assertIs<Phase.Connecting>(rig.phase)
    rig.send(Input.DescriptorChecked(2, DescriptorCheck.Over("stopped")))
    assertEquals(SnapshotState.Ended(EndReason.STOPPED_BY_ORGANISER), rig.state)
  }

  @Test
  fun `B6 review I2 an answer nobody asked for changes nothing`() {
    val armed = MachineRig().armed()
    assertEquals(emptyList(), armed.send(Input.DescriptorChecked(1, DescriptorCheck.Over("stopped"))))
    assertIs<Phase.Armed>(armed.phase)
    val live = MachineRig().live()
    assertEquals(emptyList(), live.send(Input.DescriptorChecked(1, DescriptorCheck.Over("stopped"))))
    assertIs<SnapshotState.Publishing>(live.state)
  }

  @Test
  fun `B6 review I2 only the latest ask's answer counts, and only once`() {
    val rig = MachineRig().live()
    rig.send(Input.Dropped(1, DropReason.ENDPOINT_CLOSED, null))
    rig.advance(2_000)
    rig.send(Input.Connected(2))
    rig.advance(1_000)
    rig.send(Input.Dropped(2, DropReason.ENDPOINT_CLOSED, null))
    assertEquals(listOf(1, 2), rig.sent<Command.FetchDescriptor>().map { it.requestId }, "a drop asks, whatever is in flight")
    assertEquals(emptyList(), rig.send(Input.DescriptorChecked(1, DescriptorCheck.Over("stopped"))), "superseded")
    rig.send(Input.DescriptorChecked(2, DescriptorCheck.Live))
    assertEquals(1, rig.records("descriptor").size)
    assertEquals(emptyList(), rig.send(Input.DescriptorChecked(2, DescriptorCheck.Over("stopped"))), "a second answer to one ask")
    assertIs<SnapshotState.Reconnecting>(rig.state)
  }

  @Test
  fun `B6 review m5 - F-P5-2 a far-end close mid-connect counts toward the three, and a local stop does not`() {
    val cases = listOf(DropReason.ENDPOINT_CLOSED to true, DropReason.INPUTS_STOPPED to false, DropReason.REQUESTED to false)
    for ((reason, counted) in cases) {
      val rig = MachineRig().armed()
      rig.send(Input.Start)
      repeat(3) {
        rig.send(Input.Dropped(rig.attempt!!, reason, "gone"))
        rig.advance(2_000)
      }
      val failed = rig.records("connect-failed")
      assertEquals(List(3) { counted }, failed.map { it.field("counted") }, "$reason")
      assertEquals(List(3) { reason }, failed.map { it.field("reason") }, "$reason")
      val srt = List(3) { Transport.SRT }
      assertEquals(srt + if (counted) Transport.RTMPS else Transport.SRT, rig.connects().map { it.target.transport }, "$reason")
    }
  }

  @Test
  fun `ruling 15 refused ingest alone never ends a live session - the hold's end does`() {
    for (answer in listOf(null, DescriptorCheck.Live, DescriptorCheck.Unreachable("HTTP 429"))) {
      val rig = MachineRig().live()
      rig.send(Input.Dropped(1, DropReason.ENDPOINT_CLOSED, null))
      rig.refusedConnects(182_500, answer)
      assertIs<SnapshotState.Reconnecting>(rig.state, "answer $answer")
      assertTrue(rig.sent<Command.FetchDescriptor>().size > 1, "refusals keep asking the descriptor, 10 s apart")
      rig.refusedConnects(500, answer)
      assertEquals(SnapshotState.Ended(EndReason.HOLD_WINDOW_EXPIRED), rig.state, "answer $answer")
    }
  }

  @Test
  fun `ruling 15 a refused first connect ends stopped-by-organiser only when the descriptor says so`() {
    val rig = MachineRig().armed()
    rig.send(Input.Start)
    rig.refusedConnects(10_000, DescriptorCheck.Unreachable("timeout"))
    rig.refusedConnects(10_000, DescriptorCheck.Live)
    assertIs<Phase.Connecting>(rig.phase)
    assertEquals(2, rig.sent<Command.FetchDescriptor>().size)
    rig.refusedConnects(10_000, DescriptorCheck.Over("stopped"))
    assertEquals(SnapshotState.Ended(EndReason.STOPPED_BY_ORGANISER), rig.state)
    assertEquals("stopped", rig.records("ended").single().field("endReason"))
  }

  @Test
  fun `ruling 15 a 410 from the heartbeat ends stopped-by-organiser`() {
    val rig = MachineRig().live()
    rig.beats = { HeartbeatResponse.Answered(410, null, null) }
    rig.advance(10_000)
    assertEquals(SnapshotState.Ended(EndReason.STOPPED_BY_ORGANISER), rig.state)
  }

  @Test
  fun `with no fallback target, validated failures keep retrying the primary`() {
    val rig = MachineRig(Configs.valid(fallback = null)).armed()
    rig.send(Input.Start)
    rig.failingConnects(10_000, ConnectFailure.TIMEOUT)
    assertTrue(rig.connects().size >= 5)
    assertTrue(rig.connects().all { it.target.transport == Transport.SRT })
    assertTrue(rig.records("fell-back").isEmpty())
  }

  @Test
  fun `RTMPS preferred falls back to SRT, and never reads fell-back-to-rtmps`() {
    val rig = MachineRig(Configs.valid(primary = Configs.rtmps, fallback = Configs.srt)).armed()
    rig.send(Input.Start)
    rig.failingConnects(4_500, ConnectFailure.TIMEOUT)
    rig.advance(2_000)
    assertEquals(listOf(Transport.RTMPS, Transport.RTMPS, Transport.RTMPS, Transport.SRT), rig.connects().map { it.target.transport })
    rig.send(Input.Connected(4))
    rig.advance(1_000)
    assertIs<SnapshotState.Publishing>(rig.state)
    assertEquals(Transport.SRT, (rig.state as SnapshotState.Publishing).transport)
  }

  @Test
  fun `on RTMPS a drop holds for RTMPS's own window, and the snapshot carries no SRT counters`() {
    val rig = MachineRig(Configs.valid(primary = Configs.rtmps, fallback = Configs.srt))
    var bytes = 0L
    rig.link = { t ->
      bytes += 375_000
      LinkCounters(bytes, t, 0, 0, 0, null, null, null)
    }
    rig.live()
    val since = (rig.state as SnapshotState.Publishing).sinceEpochMs
    assertNull(rig.snapshot.srt)
    assertEquals(3_000, rig.snapshot.bitrateKbps, "375 000 bytes a second")
    rig.send(Input.Network(validated = false))
    rig.send(Input.Dropped(1, DropReason.ENDPOINT_CLOSED, null))
    rig.failingConnects(10_000)
    assertEquals(SnapshotState.Reconnecting(ReconnectCause.UPLINK_LOST, 170, 180, since), rig.state)
  }

  @Test
  fun `on RTMPS a raise sets the bitrate and no SRTO_MAXBW`() {
    val rig = MachineRig(Configs.valid(primary = Configs.rtmps, fallback = Configs.srt))
    var bytes = 0L
    rig.link = { t ->
      bytes += 500_000
      LinkCounters(bytes, t, 0, 0, 0, null, null, null)
    }
    rig.live()
    rig.advance(12_000)
    assertEquals(listOf(Command.SetBitrate(1, 1_600_000)), rig.sent<Command.SetBitrate>())
    assertTrue(rig.sent<Command.SetMaxBw>().isEmpty())
  }

  @Test
  fun `C1 a fallback on connect failures is recorded once, from SRT to RTMPS`() {
    val rig = MachineRig().armed(validated = true)
    rig.send(Input.Start)
    rig.failingConnects(6_500, ConnectFailure.TIMEOUT)
    val fell = rig.records("fell-back").single()
    assertEquals(Transport.SRT, fell.field("from"))
    assertEquals(Transport.RTMPS, fell.field("to"))
  }

  @Test
  fun `only a refused connect asks the descriptor`() {
    val rig = MachineRig().armed()
    rig.send(Input.Start)
    rig.failingConnects(4_000, ConnectFailure.OTHER)
    rig.failingConnects(2_000, ConnectFailure.UNRESOLVED)
    assertTrue(rig.sent<Command.FetchDescriptor>().isEmpty(), "a failure that is not a refusal says nothing about the session")
    rig.failingConnects(2_000, ConnectFailure.REFUSED)
    assertEquals(1, rig.sent<Command.FetchDescriptor>().size)
  }

  @Test
  fun `C2 a second drop before the first frame keeps the first drop's hold`() {
    val rig = MachineRig().live()
    val since = (rig.state as SnapshotState.Publishing).sinceEpochMs
    rig.send(Input.Dropped(1, DropReason.ENDPOINT_CLOSED, null))
    rig.advance(2_000)
    rig.send(Input.Connected(2))
    rig.advance(1_000, feeding = false)
    rig.send(Input.Dropped(2, DropReason.ENDPOINT_CLOSED, null))
    // The hold started at the first drop, at 1 s: 183 − 3 = 180 s left at 4 s.
    assertEquals(SnapshotState.Reconnecting(ReconnectCause.UPLINK_LOST, 180, 183, since), rig.state)
  }

  @Test
  fun `a drop on air is retried 2 s later`() {
    val rig = MachineRig().live()
    rig.send(Input.Dropped(1, DropReason.ENDPOINT_CLOSED, null))
    rig.advance(1_500)
    assertEquals(1, rig.connects().size)
    rig.advance(500)
    assertEquals(listOf(1, 2), rig.connects().map { it.attemptId })
  }

  @Test
  fun `frames after a reconnect end the outage, so its hold never ends a publishing session`() {
    val rig = MachineRig(Configs.valid(holdWindowSeconds = mapOf(Transport.SRT to 5, Transport.RTMPS to 5))).live()
    rig.send(Input.Dropped(1, DropReason.ENDPOINT_CLOSED, null))
    rig.advance(2_000)
    rig.send(Input.Connected(2))
    // The hold from the drop at 1 s would have run out at 6 s.
    rig.advance(10_000)
    assertIs<SnapshotState.Publishing>(rig.state)
    assertEquals(1, rig.records("resumed").size)
  }

  @Test
  fun `C2 the hold ends a reconnected attempt that shows no frame, at the window`() {
    val rig = MachineRig(Configs.valid(holdWindowSeconds = mapOf(Transport.SRT to 5, Transport.RTMPS to 5))).live()
    rig.send(Input.Dropped(1, DropReason.ENDPOINT_CLOSED, null))
    rig.advance(2_000)
    rig.send(Input.Connected(2))
    rig.advance(2_500, feeding = false)
    assertIs<SnapshotState.Reconnecting>(rig.state, "5.5 s: half a second of the 5 s hold from the drop at 1 s")
    rig.advance(500, feeding = false)
    assertEquals(SnapshotState.Ended(EndReason.HOLD_WINDOW_EXPIRED), rig.state)
  }

  @Test
  fun `a stall rebuild during an outage keeps the outage's hold and cause`() {
    val rig = MachineRig().live()
    val since = (rig.state as SnapshotState.Publishing).sinceEpochMs
    rig.send(Input.Dropped(1, DropReason.ENDPOINT_CLOSED, null))
    rig.advance(2_000)
    rig.send(Input.Connected(2))
    rig.advance(5_000, feeding = false)
    assertEquals(1, rig.sent<Command.Rebuild>().size, "attempt 2 had no first frame in 5 s")
    // Still the uplink outage from 1 s: 183 − 7 = 176 s left at 8 s.
    assertEquals(SnapshotState.Reconnecting(ReconnectCause.UPLINK_LOST, 176, 183, since), rig.state)
  }

  @Test
  fun `a link reading the meter cannot rate keeps the last bitrate`() {
    val rig = MachineRig()
    var bytes = 0L
    rig.link = { t ->
      bytes += 500_000
      LinkCounters(bytes, t, 0, 0, 0, 20, 50, null)
    }
    rig.live()
    assertEquals(4_000, rig.snapshot.bitrateKbps)
    // Counters that went backwards (the platform restarted its own): no rate from this reading.
    rig.send(Input.Link(1, LinkCounters(0, 0, 0, 0, 0, 20, 50, null)))
    assertEquals(4_000, rig.snapshot.bitrateKbps)
  }

  @Test
  fun `each attempt restarts the regulator's clean interval`() {
    val rig = MachineRig()
    rig.link = cleanLink()
    rig.live()
    rig.advance(5_000)
    rig.advance(3_000, videoPerStep = 0)
    assertEquals(1, rig.sent<Command.Rebuild>().size, "no video for 3 s at 9 s")
    rig.send(Input.Connected(2))
    // Attempt 2's first clean reading is at 10 s: its raise is due 10 s later, at 20 s.
    rig.advance(10_500)
    assertTrue(rig.sent<Command.SetBitrate>().isEmpty(), "${rig.sent<Command.SetBitrate>()}")
    rig.advance(500)
    assertEquals(listOf(Command.SetBitrate(2, 1_600_000)), rig.sent<Command.SetBitrate>())
  }
}
