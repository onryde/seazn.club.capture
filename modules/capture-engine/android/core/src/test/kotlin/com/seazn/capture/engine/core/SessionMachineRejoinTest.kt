package com.seazn.capture.engine.core

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertIs
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * N29, R10 (controller's): a broadcast whose hold ran out may be rejoined by a later `live` beat for the same sid.
 * The rejoin reads Reconnecting with cause hold-expired, backs off 2, 4, 8, 16, then 30 s, and never ends itself.
 */
class SessionMachineRejoinTest {
  private val sevenSecondHolds = Configs.descriptor(holdWindowSeconds = mapOf(Transport.SRT to 7, Transport.RTMPS to 7))

  /** Live on sess_42, dropped, and the 7 s hold run out: Paired, the broadcast marked lapsed. Returns its live time. */
  private fun lapsed(rig: MachineRig): Long {
    rig.live()
    val since = rig.session.liveSinceEpochMs!!
    rig.send(Input.Dropped(rig.attempt!!, DropReason.ENDPOINT_CLOSED, null))
    rig.advance(10_000, feeding = false)
    assertEquals(LastEnd.HOLD_WINDOW_EXPIRED, assertIs<Phase.Paired>(rig.phase).pairing.lastEnd)
    return since
  }

  /** The server's `live` for [sid], answered open at Arming, then ready: the rejoin's first connect is requested. */
  private fun rejoined(rig: MachineRig, sid: String = "sess_42") {
    rig.codes = { if (rig.phase is Phase.Arming) Configs.open(sid = sid, descriptor = sevenSecondHolds) else null }
    rig.hear("live", sid = sid)
    rig.ready()
  }

  private fun waitingMs(rig: MachineRig): Long =
    ((rig.phase as Phase.Connecting).step as ConnectStep.Waiting).connectAtMs - rig.mono

  @Test
  fun `the hold runs out - Paired, the broadcast marked lapsed with its sid and live time`() {
    val rig = MachineRig(descriptor = sevenSecondHolds)
    val since = lapsed(rig)
    assertEquals(Lapsed("sess_42", since), assertIs<Phase.Paired>(rig.phase).pairing.lapsed)
  }

  @Test
  fun `a live beat for the lapsed sid rejoins it, marked as a rejoin of the broadcast that was live`() {
    val rig = MachineRig(descriptor = sevenSecondHolds)
    val since = lapsed(rig)
    rejoined(rig)
    assertEquals(Cause.REJOIN, rig.session.cause)
    assertEquals(Rejoin(since), rig.session.rejoin)
  }

  @Test
  fun `the rejoin projects as Reconnecting with cause hold-expired and the first live time, never a bare Connecting`() {
    val rig = MachineRig(descriptor = sevenSecondHolds)
    val since = lapsed(rig)
    rejoined(rig)
    val state = assertIs<SnapshotState.Reconnecting>(rig.state)
    assertEquals(ReconnectCause.HOLD_EXPIRED, state.cause)
    assertEquals(since, state.sinceEpochMs)
    assertEquals(0, state.holdRemainingSeconds)
    assertEquals(0, state.holdWindowSeconds)
    // Connected but no frame yet: still Reconnecting, on air.
    rig.send(Input.Connected(rig.attempt!!))
    assertEquals(ReconnectCause.HOLD_EXPIRED, assertIs<SnapshotState.Reconnecting>(rig.state).cause)
  }

  @Test
  fun `the rejoin's connects back off 2, 4, 8, 16, then 30 s, and the 30 s repeats`() {
    val rig = MachineRig(descriptor = sevenSecondHolds)
    lapsed(rig)
    rejoined(rig)
    for ((index, expected) in listOf(2_000L, 4_000L, 8_000L, 16_000L, 30_000L, 30_000L, 30_000L).withIndex()) {
      rig.send(Input.ConnectFailed(rig.attempt!!, ConnectFailure.OTHER, "refused"))
      assertEquals(expected, waitingMs(rig), "failure ${index + 1}")
      val line = rig.records("rejoin-retry").last()
      assertEquals(expected, line.field("retryMs"))
      assertEquals(index + 1, line.field("failures"))
      rig.at(rig.mono + expected)
      rig.send(Input.Tick)
      assertNotNull(rig.attempt, "a new connect is requested after ${expected} ms")
    }
  }

  @Test
  fun `sixty seconds of failed connects keep it rejoining - a retry never ends the broadcast`() {
    val rig = MachineRig(descriptor = sevenSecondHolds)
    lapsed(rig)
    rejoined(rig)
    val until = rig.mono + 60_000
    while (rig.mono < until) {
      rig.attempt?.let { rig.send(Input.ConnectFailed(it, ConnectFailure.TIMEOUT, null)) }
      rig.advance(500)
    }
    assertIs<Phase.Connecting>(rig.phase)
    assertIs<SnapshotState.Reconnecting>(rig.state)
    assertTrue(rig.records("broadcast-ended").size == 1, "only the hold's own end, before the rejoin")
  }

  @Test
  fun `a drop before the rejoin's first frame backs off too`() {
    val rig = MachineRig(descriptor = sevenSecondHolds)
    lapsed(rig)
    rejoined(rig)
    rig.send(Input.Connected(rig.attempt!!))
    rig.send(Input.Dropped(rig.attempt!!, DropReason.ENDPOINT_CLOSED, null))
    assertEquals(2_000L, waitingMs(rig))
    assertEquals(1, rig.records("rejoin-retry").single().field("failures"))
  }

  @Test
  fun `the first frame ends the rejoin - live again on the first live time, and a later drop holds as usual`() {
    val rig = MachineRig(descriptor = sevenSecondHolds)
    val since = lapsed(rig)
    rejoined(rig)
    rig.send(Input.Connected(rig.attempt!!))
    rig.advance(1_000)
    assertEquals(since, assertIs<SnapshotState.Publishing>(rig.state).sinceEpochMs)
    assertNull(rig.session.rejoin)
    assertNull(rig.session.pairing.lapsed)
    rig.send(Input.Dropped(rig.attempt!!, DropReason.ENDPOINT_CLOSED, null))
    assertEquals(ReconnectCause.UPLINK_LOST, assertIs<SnapshotState.Reconnecting>(rig.state).cause)
    assertEquals(SessionMachine.RETRY_MS, waitingMs(rig))
  }

  @Test
  fun `the server's waiting ends the rejoin - Paired, nothing lapsed`() {
    val rig = MachineRig(descriptor = sevenSecondHolds)
    lapsed(rig)
    rejoined(rig)
    rig.hear("waiting")
    val paired = assertIs<Phase.Paired>(rig.phase)
    assertNull(paired.pairing.lapsed)
  }

  @Test
  fun `a live beat for another sid rejoins nothing - a plain Connecting, retried every 2 s`() {
    val rig = MachineRig(descriptor = sevenSecondHolds)
    lapsed(rig)
    rejoined(rig, sid = "sess_99")
    assertNull(rig.session.rejoin)
    assertNull(rig.session.pairing.lapsed, "the arm for another sid forgets the lapse")
    assertIs<SnapshotState.Connecting>(rig.state)
    rig.send(Input.ConnectFailed(rig.attempt!!, ConnectFailure.OTHER, "refused"))
    assertEquals(SessionMachine.RETRY_MS, waitingMs(rig))
    assertTrue(rig.records("rejoin-retry").isEmpty())
  }

  @Test
  fun `a go-live beat for the lapsed sid is a start, not a rejoin - only a live beat rejoins (R10)`() {
    val rig = MachineRig(descriptor = sevenSecondHolds)
    lapsed(rig)
    rig.codes = { if (rig.phase is Phase.Arming) Configs.open(sid = "sess_42", descriptor = sevenSecondHolds) else null }
    rig.hear("go-live", sid = "sess_42", startedBy = "organiser")
    rig.ready()
    assertEquals(Cause.ORGANISER, rig.session.cause)
    assertNull(rig.session.rejoin)
    assertIs<SnapshotState.Connecting>(rig.state)
  }

  @Test
  fun `a rejoin with no lapse behind it is unchanged - a fresh pairing hearing live connects plainly`() {
    val rig = MachineRig(descriptor = sevenSecondHolds).paired()
    rejoined(rig)
    assertEquals(Cause.REJOIN, rig.session.cause)
    assertNull(rig.session.rejoin)
    assertIs<SnapshotState.Connecting>(rig.state)
  }

  @Test
  fun `Stop while rejoining ends the pairing, as Stop from live does (A3)`() {
    val rig = MachineRig(descriptor = sevenSecondHolds)
    lapsed(rig)
    rejoined(rig)
    rig.send(Input.Stop)
    assertEquals(EndReason.OPERATOR_STOPPED, rig.state.endReason)
  }

  @Test
  fun `Stop while rejoining sends A8's one final beat for the lapsed sid and holds the service for it, as Stop from live does`() {
    val rig = MachineRig(descriptor = sevenSecondHolds)
    lapsed(rig)
    rejoined(rig)
    val commands = rig.send(Input.Stop).filter { it !is Command.Record }
    assertIs<Command.WriteStopped>(commands[0])
    assertEquals(Command.End(EndReason.OPERATOR_STOPPED), commands[1])
    val last = Configs.body(assertIs<Command.PostHeartbeat>(commands[2]))
    assertEquals("ended", last.getString("state"))
    assertEquals("operator-stopped", last.getString("endReason"))
    assertEquals("sess_42", last.getString("sid"))
    assertTrue(Command.Release !in commands)
    assertNotNull(assertIs<Phase.Ended>(rig.phase).finalBeatId)
  }

  @Test
  fun `Stop while rejoining ends with the broadcast's time on air from its first live time, never as never-live`() {
    val rig = MachineRig(descriptor = sevenSecondHolds)
    val since = lapsed(rig)
    rejoined(rig)
    rig.send(Input.Stop)
    val ended = assertIs<SnapshotState.Ended>(rig.state)
    assertEquals(rig.wall - since, ended.durationMs)
    assertEquals(true, rig.records("ended").single().field("wasLive"))
  }

  @Test
  fun `a fatal error while Paired after the lapse holds no broadcast - it ends never-live, the lapse no time on air`() {
    val rig = MachineRig(descriptor = sevenSecondHolds)
    lapsed(rig)
    rig.send(Input.PlatformFailed(rig.phase.attemptInHand, "codec"))
    assertNull(assertIs<SnapshotState.Ended>(rig.state).durationMs)
    assertEquals(false, rig.records("ended").single().field("wasLive"))
  }

  @Test
  fun `a second live beat while rejoining changes nothing (a second call)`() {
    val rig = MachineRig(descriptor = sevenSecondHolds)
    val since = lapsed(rig)
    rejoined(rig)
    val before = rig.phase
    rig.hear("live", sid = "sess_42")
    assertEquals(Rejoin(since), rig.session.rejoin)
    assertEquals(before::class, rig.phase::class)
  }
}
