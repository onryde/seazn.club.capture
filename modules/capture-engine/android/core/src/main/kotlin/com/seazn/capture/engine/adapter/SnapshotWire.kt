package com.seazn.capture.engine.adapter

import com.seazn.capture.engine.core.BroadcastView
import com.seazn.capture.engine.core.PairingView
import com.seazn.capture.engine.core.ScoreUpdates
import com.seazn.capture.engine.core.Snapshot
import com.seazn.capture.engine.core.SnapshotState

/**
 * Native's snapshot → the `onSnapshot` event's body (spec §2's ~1 Hz contract; amendment, _The
 * engine port_). Pure. Every number is a Double, because JS has one number type and Expo's
 * conversion is never asked to carry a Long. An absent fact stays null, never false or 0 (D2, D14),
 * and so does a reading that is not a finite number: JSON and the HUD hold no NaN (review 12 M1).
 * `scheduledStart` crosses in epoch seconds; the other times stay in milliseconds.
 *
 * What stays native: `language`, the notification's, which JS already holds; and the device
 * sample's `charging` and `shed`, which the projection copies to the snapshot's own, which cross.
 * The broadcast crosses as its non-secret fields only: `cred` never reaches JS.
 */
object SnapshotWire {
  /** `PowerManager.THERMAL_STATUS_*`, 0 to 6, by index. */
  val THERMAL = listOf("none", "light", "moderate", "severe", "critical", "emergency", "shutdown")

  fun of(snapshot: Snapshot, facts: PlatformFacts, record: RecordCounters): Map<String, Any?> =
    linkedMapOf(
      "state" to state(snapshot.state),
      "pairing" to snapshot.pairing?.let(::pairing),
      "broadcast" to snapshot.broadcast?.let(::broadcast),
      "ready" to snapshot.ready.let { linkedMapOf("camera" to it.camera, "sound" to it.sound, "network" to it.network, "held" to it.held) },
      "refusal" to snapshot.refusal?.wire,
      "lastEnd" to snapshot.lastEnd?.wire,
      "unpaired" to
        snapshot.unpaired?.let {
          linkedMapOf("reason" to it.reason.wire, "code" to it.name.code, "slot" to num(it.name.slot), "tokenTag" to it.name.tokenTag)
        },
      "codeEndedPending" to snapshot.codeEndedPending,
      "camera" to snapshot.camera?.wire,
      "reportedAtMs" to num(snapshot.reportedAtMs),
      "survivesBackground" to facts.survivesBackground,
      "telemetry" to telemetry(snapshot, facts, record),
    )

  private fun pairing(view: PairingView): Map<String, Any?> {
    val w = view.waiting
    return linkedMapOf(
      "code" to view.name.code,
      "slot" to num(view.name.slot),
      "tokenTag" to view.name.tokenTag,
      "automatic" to view.automatic,
      "label" to w.label,
      "venueTimezone" to w.venueTimezone,
      "scheduledStart" to w.scheduledStartEpochS?.let(::num),
      "autoAllowed" to w.autoAllowed,
      "destinationName" to w.destinationName,
      "overlayUrl" to w.overlayUrl,
      "stageLabel" to w.stageLabel,
      "pollSeconds" to num(w.pollSeconds),
    )
  }

  /** Only the transports the server offered: an RTMPS-only broadcast has no `srt` key (A18). */
  private fun broadcast(view: BroadcastView): Map<String, Any?> =
    linkedMapOf(
      "sid" to view.sid,
      "cause" to view.cause.wire,
      "playbackUrl" to view.playbackUrl,
      "overlayUrl" to view.overlayUrl,
      "label" to view.label,
      "holdWindowSeconds" to view.holdWindowSeconds.entries.associate { (transport, seconds) -> transport.wire to num(seconds) },
      "maxDurationMinutes" to num(view.maxDurationMinutes),
      // A closed set (I2): a word outside it crosses as null, and the rest of the broadcast crosses as ever.
      "scoreUpdates" to ScoreUpdates.of(view.scoreUpdates)?.wire,
      "srtOffered" to view.srtOffered,
    )

  /** Degraded names its first reason, in [com.seazn.capture.engine.core.DegradeReason]'s order; the record keeps them all. */
  private fun state(state: SnapshotState): Map<String, Any?> =
    when (state) {
      SnapshotState.Idle, SnapshotState.Pairing, SnapshotState.Paired -> linkedMapOf("kind" to state.wire)
      is SnapshotState.Arming -> linkedMapOf("kind" to state.wire, "cause" to state.cause.wire, "retrying" to state.retrying)
      is SnapshotState.Armed -> linkedMapOf("kind" to state.wire, "cause" to state.cause.wire, "notReady" to state.notReady?.wire)
      is SnapshotState.Connecting -> linkedMapOf("kind" to state.wire, "transport" to state.transport.wire)
      is SnapshotState.Publishing ->
        linkedMapOf("kind" to state.wire, "transport" to state.transport.wire, "sinceEpochMs" to num(state.sinceEpochMs))
      is SnapshotState.Degraded ->
        linkedMapOf(
          "kind" to state.wire,
          "transport" to state.transport.wire,
          "reason" to state.reasons.first().wire,
          "sinceEpochMs" to num(state.sinceEpochMs),
        )
      is SnapshotState.Reconnecting ->
        linkedMapOf(
          "kind" to state.wire,
          "cause" to state.cause.wire,
          "holdRemainingSeconds" to num(state.holdRemainingSeconds),
          "holdWindowSeconds" to num(state.holdWindowSeconds),
          "sinceEpochMs" to num(state.sinceEpochMs),
        )
      is SnapshotState.Ended -> linkedMapOf("kind" to state.wire, "reason" to state.reason.wire, "durationMs" to state.durationMs?.let(::num))
    }

  /** `shed` is a device condition, so it rides here and never in the state (AGENTS §8, carry 6). */
  private fun telemetry(s: Snapshot, facts: PlatformFacts, record: RecordCounters): Map<String, Any?> =
    linkedMapOf(
      "bitrateKbps" to s.bitrateKbps?.let(::num),
      "targetBitrateKbps" to s.targetBitrateKbps?.let(::num),
      // Plan A types the level `number`: 0, its no-reading value, in place of a non-finite one.
      "audioLevel" to (finite(facts.audioLevel) ?: 0.0),
      "encodedVideoFps" to finite(s.encodedVideoFps),
      "audioPacketsPerSecond" to finite(s.audioPacketsPerSecond),
      "srt" to
        s.srt?.let {
          linkedMapOf("sent" to num(it.sent), "retransmitted" to num(it.retransmitted), "dropped" to num(it.dropped), "rttMs" to it.rttMs?.let(::num))
        },
      "delivery" to s.delivery.wire,
      "deliveredLagMs" to s.deliveredLagMs?.let(::num),
      "deliveryCheckedAtMs" to facts.deliveryCheckedAtMs?.let(::num),
      "dataUsedBytes" to num(s.dataUsedBytes),
      "charging" to s.charging,
      "batteryPercent" to s.device?.batteryPercent?.let(::num),
      "drainPctPerHour" to finite(s.device?.drainPctPerHour),
      // An int outside the platform's 0 to 6 is no reading.
      "thermalStatus" to s.device?.thermalStatus?.let { THERMAL.getOrNull(it) },
      "thermalHeadroom" to finite(s.device?.thermalHeadroom),
      "captureTimestampMs" to facts.captureTimestampMs?.let(::num),
      "shed" to s.shed?.wire,
      "heartbeat" to
        s.heartbeat.let {
          linkedMapOf(
            "lastSentAtEpochMs" to it.lastSentAtEpochMs?.let(::num),
            "lastResult" to it.lastResult?.wire,
            "consecutiveFailures" to num(it.consecutiveFailures),
            "failures" to num(it.failures),
          )
        },
      "recordSinkFailures" to num(record.sinkFailures),
      "recordReentrantDropped" to num(record.reentrantDropped),
      "taskFailures" to num(record.taskFailures),
      "reporterFailures" to num(record.reporterFailures),
      "snapshotFailures" to num(record.snapshotFailures),
      "commandFailures" to num(record.commandFailures),
      "stickyFailure" to record.stickyFailure,
    )

  private fun num(value: Number): Double = value.toDouble()

  /** A reading that is NaN or infinite is no reading. */
  private fun finite(value: Double?): Double? = value?.takeIf { it.isFinite() }
}
