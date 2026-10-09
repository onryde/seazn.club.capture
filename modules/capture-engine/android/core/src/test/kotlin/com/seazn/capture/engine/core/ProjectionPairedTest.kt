package com.seazn.capture.engine.core

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlin.test.assertTrue

class ProjectionPairedTest {
  @Test fun `each phase has its snapshot state`() {
    val rig = MachineRig()
    rig.permissions = null
    rig.send(Input.Pair(Configs.pairRequest(), Configs.PHONE, null))
    assertEquals(SnapshotState.Pairing, rig.state)
    rig.send(Input.PermissionsAnswered(true))
    assertEquals(SnapshotState.Paired, rig.state)
    rig.codes = null
    rig.hear("go-live", sid = "sess_42", startedBy = "automatic")
    assertEquals(SnapshotState.Arming(Cause.AUTOMATIC, retrying = false), rig.state)
  }

  @Test fun `Armed says its cause and the first check that fails`() {
    val rig = MachineRig().armed(validated = false)
    assertEquals(SnapshotState.Armed(Cause.ORGANISER, NotReady.CAMERA), rig.state)
    rig.ready()
    assertEquals(SnapshotState.Armed(Cause.ORGANISER, NotReady.NETWORK), rig.state)
  }

  @Test fun `the pairing, the waiting fields and the setting are in the snapshot, never the token`() {
    val rig = MachineRig().paired()
    rig.hear("waiting")
    val pairing = rig.snapshot.pairing!!
    assertEquals(Configs.pairRequest().name, pairing.name)
    assertEquals(Configs.waiting(), pairing.waiting)
    assertEquals(true, pairing.automatic)
    assertEquals(false, Configs.TOKEN in rig.snapshot.toString())
  }

  @Test fun `the broadcast's non-secret fields, and A18's srtOffered`() {
    val rig = MachineRig(descriptor = Configs.descriptor(primary = Configs.rtmps, fallback = null)).armed()
    val broadcast = rig.snapshot.broadcast!!
    assertEquals("sess_42", broadcast.sid)
    assertEquals(false, broadcast.srtOffered)
    assertEquals(false, Configs.STREAM_KEY in rig.snapshot.toString())
  }

  @Test fun `ready is four booleans, false when unknown`() {
    val rig = MachineRig().paired()
    assertEquals(ReadyView(camera = false, sound = false, network = true, held = false), rig.snapshot.ready)
    rig.ready()
    assertEquals(ReadyView(camera = true, sound = true, network = true, held = true), rig.snapshot.ready)
  }

  @Test fun `refusal and lastEnd show until the next start, unpaired until the next pair`() {
    val rig = MachineRig().live()
    rig.hear("over", sid = "sess_42", endReason = "stopped")
    assertEquals(LastEnd.STOPPED_BY_ORGANISER, rig.snapshot.lastEnd)
    rig.codes = null
    rig.hear("go-live", sid = "sess_43")
    assertNull(rig.snapshot.lastEnd)
    rig.hear("replaced")
    assertEquals(UnpairReason.REPLACED, rig.snapshot.unpaired?.reason)
    rig.send(Input.Pair(Configs.pairRequest(), Configs.PHONE, null))
    assertNull(rig.snapshot.unpaired)
  }

  @Test fun `unpaired stays through ticks and facts, until the next pair`() {
    val rig = MachineRig().live()
    rig.hear("replaced")
    rig.send(Input.Network(true))
    rig.advance(5_000)
    assertEquals(UnpairReason.REPLACED, rig.snapshot.unpaired?.reason)
  }

  @Test fun `a refusal shows until the next start`() {
    val rig = MachineRig().paired()
    rig.hear("waiting")
    rig.ready()
    rig.starts = { StartAnswer.Refused(Refusal.NO_CREDIT) }
    rig.send(Input.Start)
    assertEquals(Refusal.NO_CREDIT, rig.snapshot.refusal)
    rig.codes = null
    rig.hear("go-live", sid = "sess_43")
    assertNull(rig.snapshot.refusal)
  }

  @Test fun `I3 ready's camera is false while the camera is not ours, though frames were seen`() {
    val rig = MachineRig().paired()
    rig.ready()
    rig.send(Input.CameraContended)
    assertEquals(ReadyView(camera = false, sound = true, network = true, held = true), rig.snapshot.ready)
  }

  @Test fun `with no pairing ready is all false, the network fact included`() {
    val rig = MachineRig()
    rig.send(Input.Network(true))
    assertEquals(ReadyView(camera = false, sound = false, network = false, held = false), rig.snapshot.ready)
  }

  @Test fun `a 401 heard while a broadcast is held shows as codeEndedPending`() {
    val rig = MachineRig().live()
    assertEquals(false, rig.snapshot.codeEndedPending)
    rig.hear(null, status = 401)
    assertTrue(rig.snapshot.codeEndedPending)
  }

  @Test fun `Arming says retrying while the code is unreachable, and holds no broadcast yet`() {
    val rig = MachineRig().paired()
    rig.codes = { CodeAnswer.Unreachable("dns") }
    rig.hear("go-live", sid = "sess_42", startedBy = "automatic")
    assertEquals(SnapshotState.Arming(Cause.AUTOMATIC, retrying = true), rig.state)
    assertNull(rig.snapshot.broadcast)
  }

  @Test fun `the broadcast view is the descriptor's non-secret fields and the start's cause`() {
    val rig = MachineRig().paired()
    rig.hear("go-live", sid = "sess_42", startedBy = "automatic")
    assertEquals(
      BroadcastView(
        sid = "sess_42",
        cause = Cause.AUTOMATIC,
        playbackUrl = Configs.PLAYBACK_URL,
        overlayUrl = "https://stg.seazn.club/overlay/fixtures/fx-42",
        label = "Example Town v Sample CC",
        holdWindowSeconds = mapOf(Transport.SRT to 183, Transport.RTMPS to 180),
        maxDurationMinutes = 300,
        scoreUpdates = "realtime",
        srtOffered = true,
      ),
      rig.snapshot.broadcast,
    )
  }

  @Test fun `Ended keeps the pairing's name, so JS can forget the code it names`() {
    val rig = MachineRig().live()
    rig.send(Input.Stop)
    assertEquals(Configs.pairRequest().name, rig.snapshot.pairing!!.name)
  }

  @Test fun `the language the notification uses is the pairing's`() {
    val rig = MachineRig().paired()
    rig.send(Input.SetLanguage("nl"))
    assertEquals("nl", rig.snapshot.language)
  }

  @Test fun `hours of waiting cost a few lines - a paired beat line only when the answer changes`() {
    val rig = MachineRig().paired()
    repeat(30) { rig.hear("waiting") }
    assertEquals(2, rig.records("heartbeat").size)
    rig.hear(null, status = 503)
    assertEquals(3, rig.records("heartbeat").size)
  }

  @Test fun `held beats are written only when the answer changes, as paired ones are (N25)`() {
    val rig = MachineRig().live()
    rig.hear("live", sid = "sess_42")
    val before = rig.records("heartbeat").size
    repeat(3) { rig.hear("live", sid = "sess_42") }
    assertEquals(before, rig.records("heartbeat").size, "the same answer three times: counted, not listed")
    rig.hear(null, status = 503)
    assertEquals(before + 1, rig.records("heartbeat").size, "a change of answer still gets its line")
  }
}
