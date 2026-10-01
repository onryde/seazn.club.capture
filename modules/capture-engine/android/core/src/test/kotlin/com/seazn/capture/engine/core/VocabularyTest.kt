package com.seazn.capture.engine.core

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

/** Expected spellings are copied from spec §2 and the existing TypeScript `SessionState.ts`. */
class VocabularyTest {
  @Test
  fun `degrade reasons are the spec's, and none is thermal`() {
    assertEquals(
      listOf("not-delivered", "camera-taken", "mic-silenced", "poor-uplink", "fell-back-to-rtmps"),
      DegradeReason.entries.map { it.wire },
    )
    assertFalse(DegradeReason.entries.any { "thermal" in it.wire })
  }

  @Test
  fun `end reasons include stopped-by-organiser`() {
    assertEquals(
      setOf("operator-stopped", "stopped-by-organiser", "hold-window-expired", "fatal-error"),
      EndReason.entries.map { it.wire }.toSet(),
    )
  }

  @Test
  fun `delivery, transports, drops and the shed ladder spell as the spec does`() {
    assertEquals(listOf("ok", "stalled", "unknown"), Delivery.entries.map { it.wire })
    assertEquals(listOf("srt", "rtmps"), Transport.entries.map { it.wire })
    assertEquals(listOf("endpoint-closed", "inputs-stopped", "requested"), DropReason.entries.map { it.wire })
    assertEquals(listOf("overlay-preview", "preview-framerate", "encode"), ShedStep.entries.map { it.wire })
    assertEquals(listOf("uplink-lost", "video-stalled", "not-delivered"), ReconnectCause.entries.map { it.wire })
  }

  @Test
  fun `B6 fix 2 camera states spell in the house wire style`() {
    assertEquals(listOf("own", "taken", "reopening", "resuming", "switching"), CameraState.entries.map { it.wire })
  }

  @Test
  fun `snapshot states are the TypeScript SessionState kinds`() {
    val kinds =
      listOf(
        SnapshotState.Idle,
        SnapshotState.Armed,
        SnapshotState.Connecting(Transport.SRT),
        SnapshotState.Publishing(Transport.SRT, 0),
        SnapshotState.Degraded(Transport.SRT, listOf(DegradeReason.MIC_SILENCED), 0),
        SnapshotState.Reconnecting(ReconnectCause.UPLINK_LOST, 38, 183, 0),
        SnapshotState.Ended(EndReason.OPERATOR_STOPPED, durationMs = null),
      )
    assertEquals(
      listOf("idle", "armed", "connecting", "publishing", "degraded", "reconnecting", "ended"),
      kinds.map { it.wire },
    )
  }

  @Test
  fun `thermal travels as shed on the snapshot, outside the state`() {
    val names = Snapshot::class.java.declaredFields.map { it.name }.toSet()
    assertTrue("shed" in names)
    assertTrue("delivery" in names && "deliveredLagMs" in names && "dataUsedBytes" in names)
  }
}
