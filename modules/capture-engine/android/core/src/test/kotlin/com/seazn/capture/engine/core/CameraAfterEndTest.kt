package com.seazn.capture.engine.core

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertIs
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * N39's camera carry-over (Batch 19; the brief records the owner's "fix it now", 2026-10-13). When a broadcast ends and
 * the phone stays Paired ([Verdicts.over]), the pairing keeps the session's camera state only while it still describes
 * the camera: TAKEN (another app holds it until its release) and REOPENING (the reopen's answer is still to come, and
 * lands on the pairing). SWITCHING and RESUMING wait for the session's next frame, which no Paired phase hears, so
 * carried over they held the camera check false for good: the operator's hold was ignored and a console Go live sat in
 * Armed with no connect, until a rescan.
 */
class CameraAfterEndTest {
  private val sevenSecondHolds = Configs.descriptor(holdWindowSeconds = mapOf(Transport.SRT to 7, Transport.RTMPS to 7))

  /** Ticks, frames flowing, until a beat is in flight, so the next [MachineRig.hear] moves no time. */
  private fun MachineRig.beatInFlight(): MachineRig {
    val until = mono + 30_000
    while (phase.beating?.heartbeat?.inFlightId == null) {
      check(mono < until) { "no beat in flight in ${phase.name}" }
      advance(500)
    }
    return this
  }

  /** The operator's switch on air: the new camera has not delivered a frame. */
  private fun MachineRig.switching(): MachineRig {
    send(Input.SwitchCamera)
    assertEquals(CameraState.SWITCHING, session.camera, "the switch waits for its first frame")
    return this
  }

  /** Taken by another app, released and reopened on air: the reopened camera has not delivered a frame. */
  private fun MachineRig.resuming(): MachineRig {
    send(Input.CameraContended)
    send(Input.CameraReleased)
    send(Input.CameraReopened(ok = true))
    assertEquals(CameraState.RESUMING, session.camera, "the reopen waits for its first frame")
    return this
  }

  /**
   * The network goes and the link drops at once, the camera state carried into the reconnect; the 7 s hold runs out
   * with nothing answered (N37: Paired, the sid refused). Then the network is back, and beats go unanswered.
   */
  private fun MachineRig.holdRunsOut(): MachineRig {
    val camera = session.camera
    beats = { HeartbeatResponse.Failed("no network") }
    send(Input.Network(false))
    send(Input.Dropped(attempt!!, DropReason.ENDPOINT_CLOSED, null))
    advance(6_500, feeding = false)
    assertIs<SnapshotState.Reconnecting>(state, "still holding")
    assertEquals(camera, session.camera, "the reconnect carries the camera state to the expiry")
    advance(500, feeding = false)
    assertEquals(LastEnd.HOLD_WINDOW_EXPIRED, assertIs<Phase.Paired>(phase).pairing.lastEnd)
    beats = null
    send(Input.Network(true))
    return this
  }

  /** The organiser's end, on the answer to the beat in flight. */
  private fun MachineRig.organiserOver(): MachineRig {
    hear("over", sid = "sess_42", endReason = "stopped")
    assertIs<Phase.Paired>(phase)
    return this
  }

  /** The reconnect's code fetch, answered over for the held sid: the organiser's end heard on the code. */
  private fun MachineRig.codeOverOnReconnect(): MachineRig {
    codes = { CodeAnswer.Over("sess_42", "stopped") }
    send(Input.Dropped(attempt!!, DropReason.ENDPOINT_CLOSED, null))
    assertIs<Phase.Paired>(phase)
    return this
  }

  /** On air but never live (no frame yet), the camera taken and reopened, then the operator's Stop (owner decision 1). */
  private fun stoppedNeverLiveResuming(): MachineRig {
    val rig = MachineRig().armed()
    rig.ready()
    rig.send(Input.Connected(rig.attempt!!))
    rig.resuming()
    assertNull(rig.session.liveSinceEpochMs, "never live")
    rig.send(Input.Stop)
    assertIs<Phase.Paired>(rig.phase)
    return rig
  }

  /** Every way back to Paired while our own switch or reopen waits for a frame. */
  private val ends: List<Pair<String, () -> MachineRig>> =
    listOf(
      "hold expiry, switching" to { MachineRig(descriptor = sevenSecondHolds).live().switching().holdRunsOut() },
      "hold expiry, resuming" to { MachineRig(descriptor = sevenSecondHolds).live().resuming().holdRunsOut() },
      "organiser's over, switching" to { MachineRig().live().beatInFlight().switching().organiserOver() },
      "organiser's over, resuming" to { MachineRig().live().beatInFlight().resuming().organiserOver() },
      "the code's over on a reconnect, switching" to { MachineRig().live().switching().codeOverOnReconnect() },
      "a Stop never live, resuming" to { stoppedNeverLiveResuming() },
    )

  private fun MachineRig.opensSess43() {
    codes = { if (phase is Phase.Arming) Configs.open(sid = "sess_43", descriptor = descriptor) else null }
  }

  /** The pairing's camera is ours: the snapshot says so, and every readiness check passes. */
  private fun assertOurs(rig: MachineRig, name: String) {
    assertEquals(CameraState.OWN, assertIs<Phase.Paired>(rig.phase, name).pairing.camera, name)
    assertEquals(CameraState.OWN, rig.snapshot.camera, name)
    assertEquals(ReadyView(camera = true, sound = true, network = true, held = true), rig.snapshot.ready, name)
  }

  /** `sess_43` is armed with our camera, connects at once (A11's gate), and goes live on its frames. */
  private fun assertConnects(rig: MachineRig, cause: Cause, name: String) {
    assertEquals("sess_43", rig.phase.heldSid, name)
    assertEquals(cause, rig.session.cause, name)
    assertEquals(CameraState.OWN, rig.session.camera, name)
    assertEquals(SnapshotState.Connecting(Transport.SRT), rig.state, "$name: connecting, never parked in Armed")
    assertEquals(rig.connects().last().attemptId, rig.attempt, name)
    rig.send(Input.Connected(rig.attempt!!))
    rig.advance(1_000)
    assertIs<SnapshotState.Publishing>(rig.state, name)
  }

  @Test
  fun `N39 every end while our switch or reopen waits for a frame leaves the pairing's camera ours, one row each`() {
    val cameras = ends.map { (name, end) -> name to end().phase.pairing?.camera }
    assertEquals(ends.map { (name, _) -> name to CameraState.OWN }, cameras)
  }

  @Test
  fun `N39 every end while our switch or reopen waits for a frame hands the pairing our camera, and the operator's hold arms and connects`() {
    var checked = 0
    for ((name, end) in ends) {
      val rig = end()
      assertOurs(rig, name)
      rig.starts = { StartAnswer.Started("sess_43") }
      rig.opensSess43()
      rig.send(Input.Start)
      assertEquals(1, rig.sent<Command.PostStart>().size, "$name: the hold is posted")
      assertTrue(rig.records("intent-ignored").none { it.field("intent") == "start" }, "$name: never intent-ignored")
      assertConnects(rig, Cause.OPERATOR, name)
      checked++
    }
    assertEquals(6, checked)
  }

  @Test
  fun `N39 every end while our switch or reopen waits for a frame hands the pairing our camera, and the console's Go live arms and connects`() {
    var checked = 0
    for ((name, end) in ends) {
      val rig = end()
      assertOurs(rig, name)
      rig.opensSess43()
      rig.hear("go-live", sid = "sess_43", startedBy = "organiser")
      assertConnects(rig, Cause.ORGANISER, name)
      checked++
    }
    assertEquals(6, checked)
  }

  @Test
  fun `N39 the console's Go live for a new sid while our switch or reopen waits ends the old broadcast and connects the new one`() {
    var checked = 0
    val waits = listOf<Pair<String, (MachineRig) -> MachineRig>>("switching" to { it.switching() }, "resuming" to { it.resuming() })
    for ((name, wait) in waits) {
      val rig = MachineRig().live().beatInFlight()
      wait(rig)
      rig.opensSess43()
      rig.hear("go-live", sid = "sess_43", startedBy = "organiser")
      assertEquals(listOf("sess_42"), rig.records("broadcast-ended").map { it.field("sid") }, name)
      assertTrue(rig.sent<Command.StopBroadcast>().isNotEmpty(), name)
      assertConnects(rig, Cause.ORGANISER, name)
      checked++
    }
    assertEquals(2, checked)
  }

  @Test
  fun `N39 a camera another app holds when the hold runs out stays taken - not ready, the hold ignored, a Go live waits in Armed - until its release`() {
    val rig = MachineRig(descriptor = sevenSecondHolds).live()
    rig.send(Input.CameraContended)
    rig.holdRunsOut()
    assertEquals(CameraState.TAKEN, assertIs<Phase.Paired>(rig.phase).pairing.camera)
    assertEquals(CameraState.TAKEN, rig.snapshot.camera)
    assertEquals(false, rig.snapshot.ready.camera)
    rig.send(Input.Start)
    assertTrue(rig.sent<Command.PostStart>().isEmpty(), "the hold waits for the camera")
    assertEquals("start", rig.records("intent-ignored").last().field("intent"))
    rig.opensSess43()
    rig.hear("go-live", sid = "sess_43", startedBy = "organiser")
    assertEquals(CameraState.TAKEN, assertIs<Phase.Armed>(rig.phase).session.camera)
    assertEquals(NotReady.CAMERA, assertIs<SnapshotState.Armed>(rig.state).notReady)
    val connects = rig.connects().size
    rig.advance(30_000)
    assertIs<Phase.Armed>(rig.phase, "A11's gate waits for the camera")
    assertEquals(connects, rig.connects().size)
    rig.send(Input.CameraReleased)
    rig.send(Input.CameraReopened(ok = true))
    assertConnects(rig, Cause.ORGANISER, "released and reopened")
  }

  @Test
  fun `N39 a reopen asked before the hold runs out carries over, not ready, until its answer lands on the pairing`() {
    val rig = MachineRig(descriptor = sevenSecondHolds).live()
    rig.send(Input.CameraContended)
    rig.send(Input.CameraReleased)
    assertEquals(CameraState.REOPENING, rig.session.camera)
    rig.holdRunsOut()
    assertEquals(CameraState.REOPENING, assertIs<Phase.Paired>(rig.phase).pairing.camera)
    assertEquals(false, rig.snapshot.ready.camera)
    rig.send(Input.Start)
    assertTrue(rig.sent<Command.PostStart>().isEmpty(), "the hold waits for the reopen")
    assertEquals(1, rig.sent<Command.ReopenCamera>().size, "the end asks for no second reopen")
    rig.send(Input.CameraReopened(ok = true))
    assertOurs(rig, "reopened")
    rig.starts = { StartAnswer.Started("sess_43") }
    rig.opensSess43()
    rig.send(Input.Start)
    assertConnects(rig, Cause.OPERATOR, "reopened")
  }

  @Test
  fun `N39 a second call - a repeated Go live is one connect, and a second end with a switch waiting hands the camera back again`() {
    val rig = MachineRig(descriptor = sevenSecondHolds).live().switching().holdRunsOut()
    rig.opensSess43()
    rig.hear("go-live", sid = "sess_43", startedBy = "organiser")
    assertConnects(rig, Cause.ORGANISER, "first")
    val connects = rig.connects().size
    rig.hear("go-live", sid = "sess_43", startedBy = "organiser")
    assertEquals(connects, rig.connects().size, "the same Go live again connects nothing")
    rig.switching().holdRunsOut()
    assertOurs(rig, "second end")
    assertEquals(setOf("sess_42", "sess_43"), assertIs<Phase.Paired>(rig.phase).pairing.refused)
    rig.codes = { if (rig.phase is Phase.Arming) Configs.open(sid = "sess_44", descriptor = sevenSecondHolds) else null }
    rig.hear("go-live", sid = "sess_44", startedBy = "organiser")
    assertEquals("sess_44", rig.phase.heldSid)
    assertEquals(SnapshotState.Connecting(Transport.SRT), rig.state)
  }

  @Test
  fun `N39 an empty input - an end at Arming, before any session camera, keeps the pairing's own, ours or taken`() {
    var checked = 0
    for (taken in listOf(false, true)) {
      val rig = MachineRig().paired()
      rig.ready()
      if (taken) rig.send(Input.CameraContended)
      rig.codes = null
      rig.hear("go-live", sid = "sess_42", startedBy = "organiser")
      assertIs<Phase.Arming>(rig.phase, "taken $taken")
      rig.hear("over", sid = "sess_42", endReason = "stopped")
      val camera = assertIs<Phase.Paired>(rig.phase, "taken $taken").pairing.camera
      assertEquals(if (taken) CameraState.TAKEN else CameraState.OWN, camera, "taken $taken")
      assertEquals(!taken, rig.snapshot.ready.camera, "taken $taken")
      checked++
    }
    assertEquals(2, checked)
  }

  @Test
  fun `N39 after an interruption - a process death mid-switch keeps no camera state, so the cold start's pairing is ours and its rejoin connects`() {
    val rig = MachineRig().live().switching()
    // A new engine: the cold start's re-pair. The store keeps the phone id, A17's records and the Forget marker
    // (PairingStore), never a camera state, so the pairing starts from PairingState's default.
    val cold = MachineRig()
    cold.at(rig.mono + 5_000)
    cold.send(Input.Pair(Configs.pairRequest(claim = Claim.RESUME), Configs.PHONE, stopped = null))
    cold.send(Input.Network(true))
    cold.ready()
    assertEquals(CameraState.OWN, assertIs<Phase.Paired>(cold.phase).pairing.camera)
    assertEquals(true, cold.snapshot.ready.camera)
    cold.hear("live", sid = "sess_42")
    assertEquals(Cause.REJOIN, cold.session.cause)
    assertEquals(CameraState.OWN, cold.session.camera)
    assertEquals(SnapshotState.Connecting(Transport.SRT), cold.state)
  }
}
