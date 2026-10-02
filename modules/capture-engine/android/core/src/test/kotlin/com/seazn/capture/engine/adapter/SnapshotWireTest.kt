package com.seazn.capture.engine.adapter

import com.seazn.capture.engine.core.*
import java.io.File
import java.lang.reflect.Modifier
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertIs
import kotlin.test.assertNotEquals
import kotlin.test.assertTrue
import org.json.JSONArray
import org.json.JSONObject

class SnapshotWireTest {
  private val file = Shared.read("wire/snapshot-vectors.json")
  private val noBeat = HeartbeatStatus(null, null, 0, 0)
  private val clean = RecordCounters(0, 0)

  // Made up, within capture-beat.v1: the code is 12 characters of the code alphabet, the tag is
  // Configs.TOKEN's (token-tag-vectors.json). The overlay sits on the staging Seazn host.
  private val code = "fx42hmnp7k2q"
  private val overlay = "https://stg.seazn.club/overlay/fixtures/$code"
  private val name = PairingName(code, 1, "c980ff38")

  private fun waiting(pollSeconds: Int = 10, destinationName: String? = "YouTube · Example Town CC") =
    Configs.waiting(pollSeconds = pollSeconds, destinationName = destinationName).copy(overlayUrl = overlay)

  private val pairing = PairingView(name, automatic = true, waiting = waiting())
  private val broadcast =
    BroadcastView(
      sid = "sess_42",
      cause = Cause.ORGANISER,
      playbackUrl = Configs.PLAYBACK_URL,
      overlayUrl = overlay,
      label = "Example Town v Sample CC",
      holdWindowSeconds = mapOf(Transport.SRT to 183, Transport.RTMPS to 180),
      maxDurationMinutes = 300,
      scoreUpdates = "realtime",
      srtOffered = true,
    )
  private val allReady = ReadyView(camera = true, sound = true, network = true, held = true)

  private fun bare(state: SnapshotState, at: Long) =
    Snapshot(state, at, Delivery.UNKNOWN, null, null, null, null, null, null, 0, null, noBeat, null, null, null)

  private val live =
    Snapshot(
      state = SnapshotState.Publishing(Transport.SRT, 1_790_000_001_000),
      reportedAtMs = 1_790_000_061_000,
      delivery = Delivery.OK,
      deliveredLagMs = 9_000,
      encodedVideoFps = 29.5,
      audioPacketsPerSecond = 46.0,
      srt = SrtTelemetry(1_200, 4, 0, 38),
      bitrateKbps = 2_950,
      targetBitrateKbps = 3_000,
      dataUsedBytes = 22_000_000,
      charging = true,
      heartbeat = HeartbeatStatus(1_790_000_060_000, HeartbeatResult.OK, 0, 1),
      shed = ShedStep.OVERLAY_PREVIEW,
      device = DeviceSample(2, 0.6, 81, true, 7.5, ShedStep.OVERLAY_PREVIEW),
      camera = CameraState.OWN,
      pairing = pairing,
      broadcast = broadcast,
      ready = allReady,
    )
  private val liveFacts =
    PlatformFacts(audioLevel = 0.5, deliveryCheckedAtMs = 1_790_000_060_000, captureTimestampMs = 1_790_000_060_900, survivesBackground = true)

  /** Each case's native side, written out by hand from its JSON case. None is read back from SnapshotWire. */
  private val builders: Map<String, () -> Map<String, Any?>> =
    mapOf(
      "idle" to { SnapshotWire.of(bare(SnapshotState.Idle, 1_790_000_000_000), PlatformFacts(), clean) },
      // M2: with no pairing, ready is all false (ReadyView.NONE), whatever the network.
      "idle-unpaired-replaced" to {
        val snapshot = bare(SnapshotState.Idle, 1_790_000_000_500).copy(unpaired = Unpaired(UnpairReason.REPLACED, name))
        SnapshotWire.of(snapshot, PlatformFacts(), clean)
      },
      // A pairing holds the camera as its own (Phase.camera) from Pairing on; only Idle and Ended have none.
      "pairing" to {
        val snapshot =
          bare(SnapshotState.Pairing, 1_790_000_001_000)
            .copy(pairing = PairingView(name, true, WaitingFields.UNKNOWN), ready = ReadyView(false, false, true, false), camera = CameraState.OWN)
        SnapshotWire.of(snapshot, PlatformFacts(), clean)
      },
      // I1: camera and sound apart, so a swap of the two shows.
      "paired-after-organiser-stop" to {
        val snapshot =
          bare(SnapshotState.Paired, 1_790_000_002_000)
            .copy(
              pairing = pairing.copy(waiting = waiting(pollSeconds = 60)),
              ready = ReadyView(camera = true, sound = false, network = true, held = false),
              lastEnd = LastEnd.STOPPED_BY_ORGANISER,
              heartbeat = HeartbeatStatus(1_790_000_001_500, HeartbeatResult.OK, 0, 0),
              camera = CameraState.OWN,
            )
        SnapshotWire.of(snapshot, PlatformFacts(audioLevel = 0.42, survivesBackground = true), clean)
      },
      "paired-refused-no-destination" to {
        val snapshot =
          bare(SnapshotState.Paired, 1_790_000_003_000)
            .copy(
              pairing = PairingView(name, false, waiting(destinationName = null)),
              ready = allReady,
              refusal = Refusal.NO_DESTINATION,
              camera = CameraState.OWN,
            )
        SnapshotWire.of(snapshot, PlatformFacts(audioLevel = 0.42, survivesBackground = true), clean)
      },
      "arming-retrying" to {
        val snapshot =
          bare(SnapshotState.Arming(Cause.AUTOMATIC, retrying = true), 1_790_000_004_000)
            .copy(pairing = pairing, ready = allReady, camera = CameraState.OWN)
        SnapshotWire.of(snapshot, PlatformFacts(survivesBackground = true), clean)
      },
      "armed-not-held-rtmps-only" to {
        val rtmpsOnly = broadcast.copy(cause = Cause.REJOIN, holdWindowSeconds = mapOf(Transport.RTMPS to 180), srtOffered = false)
        val snapshot =
          bare(SnapshotState.Armed(Cause.REJOIN, NotReady.HELD), 1_790_000_005_000)
            .copy(pairing = pairing, broadcast = rtmpsOnly, ready = ReadyView(true, true, true, false), camera = CameraState.OWN)
        SnapshotWire.of(snapshot, PlatformFacts(audioLevel = 0.3, survivesBackground = true), clean)
      },
      // I1: the gate about to open (notReady null), and no overlay entitlement, so both overlay URLs are null.
      "armed-gate-open-no-overlay" to {
        val noOverlay = PairingView(name, true, waiting().copy(overlayUrl = null))
        val snapshot =
          bare(SnapshotState.Armed(Cause.OPERATOR, notReady = null), 1_790_000_005_500)
            .copy(pairing = noOverlay, broadcast = broadcast.copy(cause = Cause.OPERATOR, overlayUrl = null), ready = allReady, camera = CameraState.OWN)
        SnapshotWire.of(snapshot, PlatformFacts(audioLevel = 0.3, survivesBackground = true), clean)
      },
      // I2: a word outside the closed set crosses as null, for that field alone.
      "connecting-unknown-score-updates" to {
        val snapshot =
          bare(SnapshotState.Connecting(Transport.SRT), 1_790_000_006_000)
            .copy(pairing = pairing, broadcast = broadcast.copy(scoreUpdates = "hourly"), ready = allReady, camera = CameraState.OWN)
        SnapshotWire.of(snapshot, PlatformFacts(audioLevel = 0.3, survivesBackground = true), clean)
      },
      // I1: SRT's counters before its first round-trip reading.
      "degraded-two-reasons" to {
        val state = SnapshotState.Degraded(Transport.SRT, listOf(DegradeReason.NOT_DELIVERED, DegradeReason.MIC_SILENCED), 1_790_000_001_000)
        val snapshot =
          bare(state, 1_790_000_060_000)
            .copy(srt = SrtTelemetry(600, 0, 0, rttMs = null), pairing = pairing, broadcast = broadcast, ready = allReady, camera = CameraState.OWN)
        SnapshotWire.of(snapshot, PlatformFacts(survivesBackground = true), clean)
      },
      "reconnecting-code-ended-pending" to {
        val state = SnapshotState.Reconnecting(ReconnectCause.UPLINK_LOST, 38, 183, 1_790_000_001_000)
        val snapshot =
          bare(state, 1_790_000_146_000)
            .copy(pairing = pairing, broadcast = broadcast, ready = ReadyView(true, true, false, true), codeEndedPending = true, camera = CameraState.OWN)
        SnapshotWire.of(snapshot, PlatformFacts(survivesBackground = true), clean)
      },
      // Ended holds no camera, so the camera check reads false (Projection's I3).
      "ended-operator-stopped" to {
        val snapshot =
          bare(SnapshotState.Ended(EndReason.OPERATOR_STOPPED, 2_700_000), 1_790_002_700_000)
            .copy(pairing = pairing, ready = ReadyView(camera = false, sound = true, network = true, held = true))
        SnapshotWire.of(snapshot, PlatformFacts(), clean)
      },
      // I1: a pair refused from Idle ends at once: never live, so no duration, and no pairing.
      "ended-pair-refused-never-live" to {
        SnapshotWire.of(bare(SnapshotState.Ended(EndReason.FATAL_ERROR, durationMs = null), 1_790_000_000_200), PlatformFacts(), clean)
      },
      "live-telemetry" to { SnapshotWire.of(live, liveFacts, RecordCounters(2, 1)) },
    )

  /** `{ ...base, ...overrides }` when the case's value is an object; `null` stays `null`. */
  private fun merged(wire: JSONObject, key: String, base: String) {
    if (wire.isNull(key)) return
    val out = JSONObject(file.getJSONObject(base).toString())
    val overrides = wire.getJSONObject(key)
    for (field in overrides.keySet()) out.put(field, overrides.get(field))
    wire.put(key, out)
  }

  /** Walks objects key by key, both key sets whole; numbers compare as Double, exactly, with no tolerance. */
  private fun assertJsonEquals(expected: Any?, actual: Any?, path: String) {
    when (expected) {
      is JSONObject -> {
        val obj = assertIs<JSONObject>(actual, "$path: an object")
        assertEquals(expected.keySet(), obj.keySet(), "$path: the keys")
        for (key in expected.keySet()) assertJsonEquals(expected.get(key), obj.get(key), "$path.$key")
      }
      is JSONArray -> {
        val array = assertIs<JSONArray>(actual, "$path: an array")
        assertEquals(expected.length(), array.length(), "$path: the length")
        for (i in 0 until expected.length()) assertJsonEquals(expected.get(i), array.get(i), "$path[$i]")
      }
      is Number -> assertEquals(expected.toDouble(), assertIs<Number>(actual, "$path: a number").toDouble(), path)
      else -> assertEquals(expected, actual, path)
    }
  }

  private fun vocabulary(key: String): List<String> =
    file.getJSONObject("vocabulary").getJSONArray(key).let { a -> (0 until a.length()).map { a.getString(it) } }

  /** One of each kind, in the vocabulary's order. */
  private val states: List<SnapshotState> =
    listOf(
      SnapshotState.Idle,
      SnapshotState.Pairing,
      SnapshotState.Paired,
      SnapshotState.Arming(Cause.AUTOMATIC, retrying = true),
      SnapshotState.Armed(Cause.REJOIN, NotReady.HELD),
      SnapshotState.Connecting(Transport.SRT),
      SnapshotState.Publishing(Transport.SRT, 1_790_000_001_000),
      SnapshotState.Degraded(Transport.SRT, listOf(DegradeReason.NOT_DELIVERED, DegradeReason.MIC_SILENCED), 1_790_000_001_000),
      SnapshotState.Reconnecting(ReconnectCause.UPLINK_LOST, 38, 183, 1_790_000_001_000),
      SnapshotState.Ended(EndReason.OPERATOR_STOPPED, 2_700_000),
    )

  /** Each case's name and its whole wire, the bases merged in. */
  private fun cases(): List<Pair<String, JSONObject>> {
    val cases = file.getJSONArray("cases")
    return (0 until cases.length()).map { i ->
      val case = cases.getJSONObject(i)
      val wire = case.getJSONObject("wire")
      merged(wire, "telemetry", "telemetryBase")
      merged(wire, "pairing", "pairingBase")
      merged(wire, "broadcast", "broadcastBase")
      case.getString("name") to wire
    }
  }

  @Test
  fun `carries 3, 5, 6 each native snapshot becomes the shared wire`() {
    val cases = cases()
    assertEquals(14, cases.size, "the vector file's fourteen cases")
    assertEquals(cases.map { it.first }.toSet(), builders.keys, "one builder per case")
    for ((name, expected) in cases) assertJsonEquals(expected, JSONObject(WireJson.encode(builders.getValue(name)())), name)
  }

  /**
   * M2: JS reads each case as what native sends, so each must be one the projection can produce. The
   * rules are the Snapshot fields' own (Snapshot.kt) and A11's order, not read back from the code.
   */
  @Test
  fun `M2 every vector is a snapshot native can send`() {
    val holding = setOf("armed", "connecting", "publishing", "degraded", "reconnecting")
    for ((name, wire) in cases()) {
      val kind = wire.getJSONObject("state").getString("kind")
      val ready = wire.getJSONObject("ready").let { r -> listOf("camera", "sound", "network", "held").map { r.getBoolean(it) } }
      val noPairing = wire.isNull("pairing")
      // `camera`: null with no pairing, and in Ended. `ready`: false with no pairing.
      assertEquals(noPairing || kind == "ended", wire.isNull("camera"), "$name: camera")
      if (noPairing) assertEquals(listOf(false, false, false, false), ready, "$name: ready with no pairing")
      // The camera check is "ours and showing frames".
      if (ready[0]) assertEquals("own", wire.optString("camera"), "$name: ready.camera without our camera")
      // `broadcast` while one is held; `unpaired` in Idle; `lastEnd` in Paired.
      assertEquals(kind in holding, !wire.isNull("broadcast"), "$name: broadcast")
      if (!wire.isNull("unpaired")) assertEquals("idle", kind, "$name: unpaired")
      if (!wire.isNull("lastEnd")) assertEquals("paired", kind, "$name: lastEnd")
      if (kind == "idle") assertTrue(noPairing, "$name: Idle has no pairing")
      if (kind == "armed") {
        // A11: the first check that fails, in the status line's order; null when the gate is about to open.
        val first = ready.indexOf(false).let { if (it < 0) null else vocabulary("notReady")[it] }
        assertEquals(first, wire.getJSONObject("state").opt("notReady").takeUnless { it == JSONObject.NULL }, "$name: notReady")
      }
    }
  }

  @Test
  fun `M4 the telemetry keys JS hands through are the wire's own`() {
    val keys = file.getJSONObject("telemetryKeys")
    fun list(key: String) = keys.getJSONArray(key).let { a -> (0 until a.length()).map { a.getString(it) } }
    val telemetry = wireOf(full)["telemetry"] as Map<*, *>
    assertEquals(list("telemetry"), telemetry.keys.toList())
    assertEquals(list("srt"), (telemetry["srt"] as Map<*, *>).keys.toList())
    assertEquals(list("heartbeat"), (telemetry["heartbeat"] as Map<*, *>).keys.toList())
    // The base every case merges over has the same keys, so no case can drop one.
    val base = file.getJSONObject("telemetryBase")
    assertEquals(list("telemetry").toSet(), base.keySet())
    assertEquals(list("heartbeat").toSet(), base.getJSONObject("heartbeat").keySet())
  }

  @Test
  fun `carry 6 every wire string is the shared vocabulary's`() {
    assertEquals(vocabulary("state"), states.map { it.wire })
    assertEquals(vocabulary("reconnectCause"), ReconnectCause.entries.map { it.wire })
    assertEquals(vocabulary("degradeReason"), DegradeReason.entries.map { it.wire })
    assertEquals(vocabulary("endReason"), EndReason.entries.map { it.wire })
    assertEquals(vocabulary("cause"), Cause.entries.map { it.wire })
    assertEquals(vocabulary("notReady"), NotReady.entries.map { it.wire })
    assertEquals(vocabulary("refusal"), Refusal.entries.map { it.wire })
    assertEquals(vocabulary("lastEnd"), LastEnd.entries.map { it.wire })
    assertEquals(vocabulary("unpairReason"), UnpairReason.entries.map { it.wire })
    assertEquals(vocabulary("delivery"), Delivery.entries.map { it.wire })
    assertEquals(vocabulary("shed"), ShedStep.entries.map { it.wire })
    assertEquals(vocabulary("heartbeatResult"), HeartbeatResult.entries.map { it.wire })
    assertEquals(vocabulary("connectFailure"), ConnectFailure.entries.map { it.wire })
    assertEquals(vocabulary("camera"), CameraState.entries.map { it.wire })
    assertEquals(vocabulary("transport"), Transport.entries.map { it.wire })
    assertEquals(vocabulary("thermal"), SnapshotWire.THERMAL)
    // I2: the web descriptor schema's closed set (09e87aabd).
    assertEquals(vocabulary("scoreUpdates"), ScoreUpdates.entries.map { it.wire })
  }

  private fun telemetry(device: DeviceSample?): Map<*, *> =
    SnapshotWire.of(bare(SnapshotState.Paired, 0).copy(device = device), PlatformFacts(), clean)["telemetry"] as Map<*, *>

  @Test
  fun `a thermal status outside the platform's range is no reading`() {
    for (status in listOf(-1, 7, 9)) {
      val telemetry = telemetry(DeviceSample(status, null, null, null, null, null))
      assertTrue("thermalStatus" in telemetry.keys, "the key stays")
      assertEquals(null, telemetry["thermalStatus"], "status $status")
    }
    // The range's two ends, named as the vocabulary names them.
    assertEquals(vocabulary("thermal").first(), telemetry(DeviceSample(0, null, null, null, null, null))["thermalStatus"])
    assertEquals(vocabulary("thermal").last(), telemetry(DeviceSample(6, null, null, null, null, null))["thermalStatus"])
  }

  @Test
  fun `D2 D14 a fact with no reading crosses as null, never false or 0`() {
    val telemetry = telemetry(DeviceSample(null, null, null, null, null, null))
    val absent =
      listOf(
        "bitrateKbps",
        "targetBitrateKbps",
        "encodedVideoFps",
        "audioPacketsPerSecond",
        "srt",
        "deliveredLagMs",
        "deliveryCheckedAtMs",
        "charging",
        "batteryPercent",
        "drainPctPerHour",
        "thermalStatus",
        "thermalHeadroom",
        "captureTimestampMs",
        "shed",
      )
    for (key in absent) {
      assertTrue(key in telemetry.keys, "$key stays on the wire")
      assertEquals(null, telemetry[key], key)
    }
  }

  @Test
  fun `M1 a reading that is not a finite number crosses as no reading, so JS never sees NaN`() {
    for (bad in listOf(Double.NaN, Double.POSITIVE_INFINITY, Double.NEGATIVE_INFINITY)) {
      val snapshot =
        bare(SnapshotState.Paired, 0).copy(encodedVideoFps = bad, audioPacketsPerSecond = bad, device = DeviceSample(2, bad, 81, true, bad, null))
      // Read on the map Expo is handed, never through WireJson, which would write null either way.
      val telemetry = SnapshotWire.of(snapshot, PlatformFacts(audioLevel = bad), clean)["telemetry"] as Map<*, *>
      for (key in listOf("encodedVideoFps", "audioPacketsPerSecond", "thermalHeadroom", "drainPctPerHour")) {
        assertTrue(key in telemetry.keys, "$key stays on the wire")
        assertEquals(null, telemetry[key], "$key for $bad")
      }
      // Plan A types the level `number`, 0 with no reading (CaptureEnginePort.ts, CD28).
      assertEquals(0.0, telemetry["audioLevel"], "audioLevel for $bad")
    }
  }

  // ---- I3: no credential crosses, through the real projection. ----

  /** Configs' made-up credentials, each distinctive: the token, the publish secrets, and the ingest URLs. */
  private val credentials =
    listOf(
      Configs.TOKEN,
      Configs.PASSPHRASE,
      Configs.STREAM_KEY,
      Configs.srt.url,
      Configs.rtmps.url,
      Configs.rtmps.url + Configs.STREAM_KEY,
      // The ingest host itself: no wire field names it.
      "live.stg.seazn.club",
    )

  private fun assertNoCredential(text: String, where: String) {
    for (secret in credentials) assertFalse(secret in text, "$where carries a credential: $secret")
    // The stream id is a path segment of the public playback URL (SessionRecord's notInUrls), and nowhere else.
    assertFalse(Configs.STREAM_ID in text.replace(Configs.PLAYBACK_URL, ""), "$where carries the stream id outside the playback URL")
  }

  /** Every string the wire holds, keys included. */
  private fun strings(value: Any?): List<String> =
    when (value) {
      is String -> listOf(value)
      is Map<*, *> -> value.entries.flatMap { (key, item) -> strings(key) + strings(item) }
      is List<*> -> value.flatMap(::strings)
      else -> emptyList()
    }

  /** Configs' session, every credential in it, through [Projection]: from Paired, on air over SRT, to Ended. */
  private fun projected(): List<Snapshot> {
    val rig = MachineRig()
    rig.link = { ms -> LinkCounters(ms * 375, ms / 10, 0, 0, 0, 20, 50, null) }
    val seen = mutableListOf<Snapshot>()
    rig.paired()
    seen += rig.snapshot
    rig.hear("go-live", sid = "sess_42", startedBy = "organiser")
    seen += rig.snapshot
    rig.ready()
    seen += rig.snapshot
    rig.send(Input.Connected(rig.attempt!!))
    rig.advance(3_000) { seen += rig.snapshot }
    rig.send(Input.Dropped(rig.attempt!!, DropReason.ENDPOINT_CLOSED, null))
    rig.advance(1_000) { seen += rig.snapshot }
    rig.send(Input.Stop)
    seen += rig.snapshot
    return seen
  }

  @Test
  fun `I3 no credential reaches the wire, its JSON or the vectors`() {
    val snapshots = projected()
    // Not vacuous: every phase that holds the broadcast, and SRT's own counters on air.
    val kinds = snapshots.map { it.state.wire }.toSet()
    for (kind in listOf("paired", "armed", "connecting", "publishing", "reconnecting", "ended")) assertTrue(kind in kinds, "the walk reaches $kind: $kinds")
    assertTrue(snapshots.any { it.broadcast != null && it.srt != null }, "a held broadcast with SRT's counters")
    for (snapshot in snapshots) {
      val wire = SnapshotWire.of(snapshot, PlatformFacts(), clean)
      assertNoCredential(strings(wire).joinToString("\n"), "the wire in ${snapshot.state.wire}")
      assertNoCredential(WireJson.encode(wire), "the JSON in ${snapshot.state.wire}")
    }
    val vectors = File(System.getProperty("capture.shared"), "wire/snapshot-vectors.json").readText(Charsets.UTF_8)
    assertNoCredential(vectors, "snapshot-vectors.json")
  }

  // ---- C0b's carry: every field of the snapshot and of what it holds is mapped, or named here. ----

  private data class Sources(val snapshot: Snapshot, val facts: PlatformFacts, val record: RecordCounters)

  private fun wireOf(sources: Sources) = SnapshotWire.of(sources.snapshot, sources.facts, sources.record)

  /** Every field set and distinct, so a change to any one of them can show. */
  private val full =
    Sources(
      live.copy(
        refusal = Refusal.NO_CREDIT,
        lastEnd = LastEnd.NO_SIGNAL,
        unpaired = Unpaired(UnpairReason.TAKEN, name),
        codeEndedPending = true,
        language = "fr",
      ),
      liveFacts,
      RecordCounters(2, 1),
    )

  /**
   * The JVM field paths under [type]: a field holding one of the core's own value classes is walked
   * into, any other is one leaf. `state` is a leaf here; its kinds have their own test below.
   */
  private fun leaves(type: Class<*>, prefix: String = ""): List<String> =
    type.declaredFields
      .filterNot { Modifier.isStatic(it.modifiers) }
      .flatMap { field ->
        val ours = field.type.name.startsWith("com.seazn.capture.engine.") && !field.type.isEnum && !field.type.isInterface
        if (ours) leaves(field.type, "$prefix${field.name}.") else listOf("$prefix${field.name}")
      }

  private fun Sources.snap(change: Snapshot.() -> Snapshot) = copy(snapshot = snapshot.change())

  private fun Sources.srt(change: SrtTelemetry.() -> SrtTelemetry) = snap { copy(srt = srt!!.change()) }

  private fun Sources.beat(change: HeartbeatStatus.() -> HeartbeatStatus) = snap { copy(heartbeat = heartbeat.change()) }

  private fun Sources.device(change: DeviceSample.() -> DeviceSample) = snap { copy(device = device!!.change()) }

  private fun Sources.pairing(change: PairingView.() -> PairingView) = snap { copy(pairing = pairing!!.change()) }

  private fun Sources.pairingName(change: PairingName.() -> PairingName) = pairing { copy(name = name.change()) }

  private fun Sources.waiting(change: WaitingFields.() -> WaitingFields) = pairing { copy(waiting = waiting.change()) }

  private fun Sources.broadcast(change: BroadcastView.() -> BroadcastView) = snap { copy(broadcast = broadcast!!.change()) }

  private fun Sources.ready(change: ReadyView.() -> ReadyView) = snap { copy(ready = ready.change()) }

  private fun Sources.unpaired(change: Unpaired.() -> Unpaired) = snap { copy(unpaired = unpaired!!.change()) }

  /** A change to each field that crosses the bridge. A state table, long by nature. */
  private val crosses: Map<String, (Sources) -> Sources> =
    mapOf(
      "state" to { s -> s.snap { copy(state = SnapshotState.Paired) } },
      "reportedAtMs" to { s -> s.snap { copy(reportedAtMs = reportedAtMs + 1) } },
      "delivery" to { s -> s.snap { copy(delivery = Delivery.STALLED) } },
      "deliveredLagMs" to { s -> s.snap { copy(deliveredLagMs = 9_001) } },
      "encodedVideoFps" to { s -> s.snap { copy(encodedVideoFps = 30.0) } },
      "audioPacketsPerSecond" to { s -> s.snap { copy(audioPacketsPerSecond = 47.0) } },
      "srt.sent" to { s -> s.srt { copy(sent = sent + 1) } },
      "srt.retransmitted" to { s -> s.srt { copy(retransmitted = retransmitted + 1) } },
      "srt.dropped" to { s -> s.srt { copy(dropped = dropped + 1) } },
      "srt.rttMs" to { s -> s.srt { copy(rttMs = null) } },
      "bitrateKbps" to { s -> s.snap { copy(bitrateKbps = 2_951) } },
      "targetBitrateKbps" to { s -> s.snap { copy(targetBitrateKbps = 2_500) } },
      "dataUsedBytes" to { s -> s.snap { copy(dataUsedBytes = dataUsedBytes + 1) } },
      "charging" to { s -> s.snap { copy(charging = false) } },
      "heartbeat.lastSentAtEpochMs" to { s -> s.beat { copy(lastSentAtEpochMs = null) } },
      "heartbeat.lastResult" to { s -> s.beat { copy(lastResult = HeartbeatResult.FAILED) } },
      "heartbeat.consecutiveFailures" to { s -> s.beat { copy(consecutiveFailures = 1) } },
      "heartbeat.failures" to { s -> s.beat { copy(failures = 2) } },
      "shed" to { s -> s.snap { copy(shed = ShedStep.ENCODE) } },
      "device.thermalStatus" to { s -> s.device { copy(thermalStatus = 3) } },
      "device.thermalHeadroom" to { s -> s.device { copy(thermalHeadroom = 0.7) } },
      "device.batteryPercent" to { s -> s.device { copy(batteryPercent = 80) } },
      "device.drainPctPerHour" to { s -> s.device { copy(drainPctPerHour = 8.0) } },
      "camera" to { s -> s.snap { copy(camera = CameraState.TAKEN) } },
      "pairing.name.code" to { s -> s.pairingName { copy(code = "fx42hmnp7k2r") } },
      "pairing.name.slot" to { s -> s.pairingName { copy(slot = 2) } },
      "pairing.name.tokenTag" to { s -> s.pairingName { copy(tokenTag = "95e90931") } },
      "pairing.automatic" to { s -> s.pairing { copy(automatic = false) } },
      "pairing.waiting.label" to { s -> s.waiting { copy(label = "Sample CC v Example Town") } },
      "pairing.waiting.venueTimezone" to { s -> s.waiting { copy(venueTimezone = "Europe/Amsterdam") } },
      "pairing.waiting.scheduledStartEpochS" to { s -> s.waiting { copy(scheduledStartEpochS = 1_790_003_660) } },
      "pairing.waiting.autoAllowed" to { s -> s.waiting { copy(autoAllowed = false) } },
      "pairing.waiting.destinationName" to { s -> s.waiting { copy(destinationName = null) } },
      "pairing.waiting.overlayUrl" to { s -> s.waiting { copy(overlayUrl = null) } },
      "pairing.waiting.pollSeconds" to { s -> s.waiting { copy(pollSeconds = 60) } },
      "broadcast.sid" to { s -> s.broadcast { copy(sid = "sess_43") } },
      "broadcast.cause" to { s -> s.broadcast { copy(cause = Cause.OPERATOR) } },
      "broadcast.playbackUrl" to { s -> s.broadcast { copy(playbackUrl = "$playbackUrl?x") } },
      "broadcast.overlayUrl" to { s -> s.broadcast { copy(overlayUrl = null) } },
      "broadcast.label" to { s -> s.broadcast { copy(label = "Sample CC v Example Town") } },
      "broadcast.holdWindowSeconds" to { s -> s.broadcast { copy(holdWindowSeconds = mapOf(Transport.RTMPS to 180)) } },
      "broadcast.maxDurationMinutes" to { s -> s.broadcast { copy(maxDurationMinutes = 240) } },
      "broadcast.scoreUpdates" to { s -> s.broadcast { copy(scoreUpdates = "polled") } },
      "broadcast.srtOffered" to { s -> s.broadcast { copy(srtOffered = false) } },
      "ready.camera" to { s -> s.ready { copy(camera = false) } },
      "ready.sound" to { s -> s.ready { copy(sound = false) } },
      "ready.network" to { s -> s.ready { copy(network = false) } },
      "ready.held" to { s -> s.ready { copy(held = false) } },
      "refusal" to { s -> s.snap { copy(refusal = Refusal.NO_DESTINATION) } },
      "lastEnd" to { s -> s.snap { copy(lastEnd = LastEnd.STOPPED) } },
      "unpaired.reason" to { s -> s.unpaired { copy(reason = UnpairReason.REPLACED) } },
      "unpaired.name.code" to { s -> s.unpaired { copy(name = name.copy(code = "fx42hmnp7k2r")) } },
      "unpaired.name.slot" to { s -> s.unpaired { copy(name = name.copy(slot = 2)) } },
      "unpaired.name.tokenTag" to { s -> s.unpaired { copy(name = name.copy(tokenTag = "95e90931")) } },
      "codeEndedPending" to { s -> s.snap { copy(codeEndedPending = false) } },
      "facts.audioLevel" to { s -> s.copy(facts = s.facts.copy(audioLevel = 0.25)) },
      "facts.deliveryCheckedAtMs" to { s -> s.copy(facts = s.facts.copy(deliveryCheckedAtMs = null)) },
      "facts.captureTimestampMs" to { s -> s.copy(facts = s.facts.copy(captureTimestampMs = null)) },
      "facts.survivesBackground" to { s -> s.copy(facts = s.facts.copy(survivesBackground = false)) },
      "record.sinkFailures" to { s -> s.copy(record = s.record.copy(sinkFailures = 3)) },
      "record.reentrantDropped" to { s -> s.copy(record = s.record.copy(reentrantDropped = 2)) },
    )

  /** The fields that stay native, each with why, and a change that must leave the wire as it was. */
  private val staysNative: Map<String, Pair<String, (Sources) -> Sources>> =
    mapOf(
      "language" to ("the notification's: JS already holds it" to { s -> s.snap { copy(language = "nl") } }),
      "device.charging" to ("a copy: the projection sets the snapshot's charging from it, and that crosses" to { s -> s.device { copy(charging = false) } }),
      "device.shed" to ("a copy: the projection sets the snapshot's shed from it, and that crosses" to { s -> s.device { copy(shed = ShedStep.ENCODE) } }),
    )

  @Test
  fun `C0b carry every snapshot field crosses the bridge, or is named as staying native`() {
    val fields = leaves(Snapshot::class.java) + leaves(PlatformFacts::class.java, "facts.") + leaves(RecordCounters::class.java, "record.")
    assertEquals(fields.sorted(), (crosses.keys.toList() + staysNative.keys.toList()).sorted(), "map a new field, then name it here")
    val before = wireOf(full)
    for ((path, change) in crosses) assertNotEquals(before, wireOf(change(full)), "$path does not cross")
    for ((path, named) in staysNative) {
      val (why, change) = named
      assertNotEquals(full, change(full), "$path: the change changes nothing")
      assertEquals(before, wireOf(change(full)), "$path crosses, but is named as staying native: $why")
    }
  }

  /** A change to each field of each kind. A state table, long by nature. */
  private val stateChanges: Map<String, (SnapshotState) -> SnapshotState> =
    mapOf(
      "Arming.cause" to { s -> (s as SnapshotState.Arming).copy(cause = Cause.OPERATOR) },
      "Arming.retrying" to { s -> (s as SnapshotState.Arming).copy(retrying = false) },
      "Armed.cause" to { s -> (s as SnapshotState.Armed).copy(cause = Cause.ORGANISER) },
      "Armed.notReady" to { s -> (s as SnapshotState.Armed).copy(notReady = null) },
      "Connecting.transport" to { s -> (s as SnapshotState.Connecting).copy(transport = Transport.RTMPS) },
      "Publishing.transport" to { s -> (s as SnapshotState.Publishing).copy(transport = Transport.RTMPS) },
      "Publishing.sinceEpochMs" to { s -> (s as SnapshotState.Publishing).copy(sinceEpochMs = 1_790_000_002_000) },
      "Degraded.transport" to { s -> (s as SnapshotState.Degraded).copy(transport = Transport.RTMPS) },
      // Only the first reason crosses (the record keeps the list), so the change is to the first.
      "Degraded.reasons" to { s -> (s as SnapshotState.Degraded).copy(reasons = listOf(DegradeReason.CAMERA_TAKEN, DegradeReason.MIC_SILENCED)) },
      "Degraded.sinceEpochMs" to { s -> (s as SnapshotState.Degraded).copy(sinceEpochMs = 1_790_000_002_000) },
      "Reconnecting.cause" to { s -> (s as SnapshotState.Reconnecting).copy(cause = ReconnectCause.VIDEO_STALLED) },
      "Reconnecting.holdRemainingSeconds" to { s -> (s as SnapshotState.Reconnecting).copy(holdRemainingSeconds = 37) },
      "Reconnecting.holdWindowSeconds" to { s -> (s as SnapshotState.Reconnecting).copy(holdWindowSeconds = 180) },
      "Reconnecting.sinceEpochMs" to { s -> (s as SnapshotState.Reconnecting).copy(sinceEpochMs = 1_790_000_002_000) },
      "Ended.reason" to { s -> (s as SnapshotState.Ended).copy(reason = EndReason.FATAL_ERROR) },
      "Ended.durationMs" to { s -> (s as SnapshotState.Ended).copy(durationMs = null) },
    )

  private fun stateWire(state: SnapshotState) = SnapshotWire.of(bare(state, 0), PlatformFacts(), clean)["state"]

  @Test
  fun `C0b carry every snapshot state kind crosses, and each of its fields`() {
    val kinds = SnapshotState::class.java.permittedSubclasses!!.toList()
    assertEquals(kinds.map { it.simpleName }.sorted(), states.map { it.javaClass.simpleName }.sorted(), "one of each kind")
    for (state in states) assertEquals(state.wire, (stateWire(state) as Map<*, *>)["kind"])
    // `wire` is the kind itself, pinned against the vocabulary above.
    val fields = kinds.flatMap { kind -> kind.declaredFields.filterNot { Modifier.isStatic(it.modifiers) || it.name == "wire" }.map { "${kind.simpleName}.${it.name}" } }
    assertEquals(fields.sorted(), stateChanges.keys.sorted(), "map a new field, then name it here")
    for ((path, change) in stateChanges) {
      val state = states.single { it.javaClass.simpleName == path.substringBefore('.') }
      assertNotEquals(stateWire(state), stateWire(change(state)), "$path does not cross")
    }
  }
}
