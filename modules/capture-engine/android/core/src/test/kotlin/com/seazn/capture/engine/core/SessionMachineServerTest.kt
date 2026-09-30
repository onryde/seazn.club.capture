package com.seazn.capture.engine.core

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertIs
import kotlin.test.assertTrue

class SessionMachineServerTest {
  private val masterText = "#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=3128000\nstream_720/video.m3u8\n"

  private fun media(head: Long) =
    "#EXTM3U\n#EXT-X-TARGETDURATION:2\n#EXT-X-MEDIA-SEQUENCE:${head - 2}\n" +
      (head - 2..head).joinToString("") { "#EXTINF:2.000,\ns$it.ts\n" }

  @Test
  fun `F-P5-13 not-delivered forces a new session and shows until the playlist moves again`() {
    var head = 100L
    var moving = false
    val rig = MachineRig()
    rig.playlists = { url -> FetchResult.Body(if (url == Configs.PLAYBACK_URL + "?clientBandwidthHint=0.1") masterText else media(if (moving) ++head else head)) }
    rig.live()
    // Live at 1 s; the first poll at 1 s is the baseline; 20 s of publishing with no movement.
    rig.advance(19_500)
    assertTrue(rig.sent<Command.StartNewSession>().isEmpty())
    rig.advance(500)
    val restart = rig.sent<Command.StartNewSession>().single()
    assertEquals(1, restart.previousAttemptId)
    assertEquals(ReconnectCause.NOT_DELIVERED, assertIs<SnapshotState.Reconnecting>(rig.state).cause)
    rig.send(Input.Connected(restart.next.attemptId))
    rig.advance(1_000)
    assertEquals(listOf(DegradeReason.NOT_DELIVERED), assertIs<SnapshotState.Degraded>(rig.state).reasons)
    moving = true
    rig.advance(6_000)
    assertIs<SnapshotState.Publishing>(rig.state)
    assertEquals(1, rig.records("delivered").size)
  }

  @Test
  fun `the playlist is polled only while LIVE`() {
    val rig = MachineRig().armed()
    rig.send(Input.Start)
    rig.send(Input.Connected(1))
    rig.advance(4_000, feeding = false)
    assertTrue(rig.sent<Command.FetchPlaylist>().isEmpty())
  }

  @Test
  fun `ruling 5 heartbeats go every 10 s while armed, carrying the token only as the Bearer`() {
    val rig = MachineRig()
    rig.beats = { HeartbeatResponse.Answered(200, "warming", null) }
    rig.armed()
    rig.advance(30_000)
    val beats = rig.sent<Command.PostHeartbeat>()
    assertEquals(3, beats.size)
    for (beat in beats) {
      assertEquals(Configs.TOKEN, beat.bearer)
      assertEquals(Configs.valid().heartbeatUrl, beat.url)
      assertFalse(Configs.TOKEN in beat.body)
      assertFalse(Configs.TOKEN in beat.toString())
      assertTrue(""""state":"armed"""" in beat.body)
    }
  }

  @Test
  fun `ruling 5 an organiser stop in the heartbeat's answer ends stopped-by-organiser`() {
    val rig = MachineRig().live()
    rig.beats = { HeartbeatResponse.Answered(200, "ending", "stopped") }
    rig.advance(10_000)
    assertEquals(SnapshotState.Ended(EndReason.STOPPED_BY_ORGANISER), rig.state)
  }

  @Test
  fun `ruling 5 a heartbeat that fails forever never touches the stream`() {
    val rig = MachineRig()
    rig.beats = { HeartbeatResponse.Failed("timeout") }
    rig.live()
    val states = mutableListOf<SnapshotState>()
    rig.advance(600_000) { states += rig.state }
    assertTrue(states.all { it is SnapshotState.Publishing }, "the stream never noticed")
    assertTrue(rig.sent<Command.Rebuild>().isEmpty() && rig.sent<Command.End>().isEmpty())
    assertEquals(61, rig.snapshot.heartbeat.failures)
  }

  @Test
  fun `a heartbeat never answered is failed at 10 s, recorded, and the next goes`() {
    val rig = MachineRig().live()
    rig.advance(20_000)
    assertEquals(3, rig.sent<Command.PostHeartbeat>().size)
    assertEquals(2, rig.snapshot.heartbeat.failures)
    assertEquals(2, rig.records("heartbeat").size)
  }

  @Test
  fun `no heartbeat after the session ends`() {
    val rig = MachineRig().live()
    rig.send(Input.Stop)
    val before = rig.sent<Command.PostHeartbeat>().size
    rig.advance(30_000)
    assertEquals(before, rig.sent<Command.PostHeartbeat>().size)
  }

  @Test
  fun `the snapshot carries spec 2's telemetry`() {
    val rig = MachineRig()
    var bytes = 0L
    rig.link = { t ->
      bytes += 500_000
      LinkCounters(bytes, t, 7, 2, 0, 31, 40, null)
    }
    rig.live()
    rig.advance(4_000)
    val snapshot = rig.snapshot
    assertEquals(SrtTelemetry(sent = 5_000, retransmitted = 7, dropped = 2, rttMs = 31), snapshot.srt)
    assertEquals(4_000, snapshot.bitrateKbps)
    // Carry 13: the meter starts at the connect's zero counters, so the first reading (at 1 s) shows
    // the link's 2 sender drops as drops since the connect, and F-P5-5 cuts on drops by half:
    // 1500k / 2 = 750k. (The plan's unseeded meter read that first reading as no drops: 1500.)
    assertEquals(750, snapshot.targetBitrateKbps)
    // Carry 13: five readings of 500 000 bytes (1 s to 5 s), the first counted from the connect:
    // 5 × 500 000 = 2 500 000. (The plan's unseeded meter dropped the first: 2 000 000.)
    assertEquals(2_500_000, snapshot.dataUsedBytes)
    assertEquals(30.0, snapshot.encodedVideoFps)
    assertEquals(46.0, snapshot.audioPacketsPerSecond)
  }

  @Test
  fun `the heartbeat says audio ok only on a rate measured at the floor`() {
    // Carry 8: no measurement is not health. Armed, nothing is encoded yet.
    val armed = MachineRig().armed()
    armed.advance(500)
    assertTrue(""""audioOk":false""" in armed.sent<Command.PostHeartbeat>().single().body)

    val rig = MachineRig()
    rig.beats = { HeartbeatResponse.Answered(200, "live", null) }
    rig.live()
    rig.advance(10_000)
    // 10.5 s: 46 audio frames a second, over the 20 floor.
    assertTrue(""""audioOk":true""" in rig.sent<Command.PostHeartbeat>()[1].body)
    rig.send(Input.CameraContended)
    rig.advance(10_000, videoPerStep = 0)
    // 20.5 s: the slate is up with its silent audio, and the held watchdog has cleared the rates.
    assertTrue(""""audioOk":false""" in rig.sent<Command.PostHeartbeat>()[2].body)
  }

  @Test
  fun `a playlist answer that lands off air neither clears not-delivered nor sets delivery`() {
    // Carry 11: the watch drops a late answer once it has gone off air; so does the machine.
    var head = 100L
    var moving = false
    var answerMedia = true
    val rig = MachineRig()
    rig.playlists = { url ->
      when {
        url == Configs.PLAYBACK_URL + "?clientBandwidthHint=0.1" -> FetchResult.Body(masterText)
        answerMedia -> FetchResult.Body(media(if (moving) ++head else head))
        else -> null
      }
    }
    rig.live()
    rig.advance(20_000)
    val restart = rig.sent<Command.StartNewSession>().single()
    rig.send(Input.Connected(restart.next.attemptId))
    rig.advance(1_000)
    moving = true
    rig.advance(1_000) // 23 s: the new session's baseline
    answerMedia = false
    rig.advance(2_000) // 25 s: the master answered, the variant fetch in flight
    val inFlight = rig.sent<Command.FetchPlaylist>().last()
    assertTrue("stream_720" in inFlight.url)
    rig.send(Input.Dropped(restart.next.attemptId, DropReason.ENDPOINT_CLOSED, null))
    rig.send(Input.PlaylistFetched(inFlight.requestId, FetchResult.Body(media(++head))))
    assertTrue(rig.records("delivered").isEmpty())
    val session = assertIs<Phase.Connecting>(rig.phase).session
    assertTrue(session.notDelivered, "still not delivered: the answer proves nothing off air")
    assertEquals(Delivery.UNKNOWN, session.delivery.delivery)
  }

  @Test
  fun `a heartbeat answer that comes twice is recorded once`() {
    val rig = MachineRig().live()
    val beat = rig.sent<Command.PostHeartbeat>().single()
    rig.send(Input.HeartbeatAnswered(beat.beatId, HeartbeatResponse.Answered(200, "live", null)))
    rig.send(Input.HeartbeatAnswered(beat.beatId, HeartbeatResponse.Answered(200, "live", null)))
    assertEquals(1, rig.records("heartbeat").size)
    assertEquals(HeartbeatResult.OK, rig.snapshot.heartbeat.lastResult)
  }
}
