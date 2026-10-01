package com.seazn.capture.engine.core

/** Why a live session is reconnecting. */
enum class ReconnectCause(override val wire: String) : Wire {
  UPLINK_LOST("uplink-lost"),
  VIDEO_STALLED("video-stalled"),
  NOT_DELIVERED("not-delivered"),
}

enum class Transport(override val wire: String) : Wire {
  SRT("srt"),
  RTMPS("rtmps"),
}

/**
 * Why the broadcast is impaired (spec §2). Declared most important first; the snapshot lists the
 * active ones in this order, so the first is the one the status line names.
 *
 * Deliberately absent: thermal. A hot phone is a device condition and travels as `shed` (AGENTS §8).
 * Also absent: `audio-below-floor`. The level floor stays a TypeScript display selector (spec §2,
 * "`audioFloor` stays"), so native never decides it.
 */
enum class DegradeReason(override val wire: String) : Wire {
  NOT_DELIVERED("not-delivered"),
  CAMERA_TAKEN("camera-taken"),
  MIC_SILENCED("mic-silenced"),
  POOR_UPLINK("poor-uplink"),
  FELL_BACK_TO_RTMPS("fell-back-to-rtmps"),
}

enum class EndReason(override val wire: String) : Wire {
  OPERATOR_STOPPED("operator-stopped"),
  STOPPED_BY_ORGANISER("stopped-by-organiser"),
  HOLD_WINDOW_EXPIRED("hold-window-expired"),
  FATAL_ERROR("fatal-error"),
}

/** What the delivered playlist says (F-P5-13): moving, not moving, or no evidence either way. */
enum class Delivery(override val wire: String) : Wire {
  OK("ok"),
  STALLED("stalled"),
  UNKNOWN("unknown"),
}

/** The degradation ladder (AGENTS §8), in order, never reordered. */
enum class ShedStep(override val wire: String) : Wire {
  OVERLAY_PREVIEW("overlay-preview"),
  PREVIEW_FRAMERATE("preview-framerate"),
  ENCODE("encode"),
}

/** Why an attempt stopped publishing, as the platform tells it apart (P5 rehearsal R3). */
enum class DropReason(override val wire: String) : Wire {
  ENDPOINT_CLOSED("endpoint-closed"),
  INPUTS_STOPPED("inputs-stopped"),
  REQUESTED("requested"),
}

enum class ConnectFailure(override val wire: String) : Wire {
  /** The host did not resolve. The platform resolves first and reports this (F-P5-1). */
  UNRESOLVED("unresolved"),
  /** The ingest refused the publish. Checked against the descriptor before it means anything. */
  REFUSED("refused"),
  TIMEOUT("timeout"),
  OTHER("other"),
}

enum class HeartbeatResult(override val wire: String) : Wire {
  OK("ok"),
  FAILED("failed"),
  SESSION_OVER("session-over"),
}

/** Device conditions the platform reads (thermal, battery). Relayed, never judged (AGENTS §8). */
data class DeviceSample(
  val thermalStatus: Int?,
  /** API 30+; the platform passes null where it reads −1 (P5, Redmi Note 7 Pro). */
  val thermalHeadroom: Double?,
  val batteryPercent: Int?,
  val charging: Boolean?,
  /** From the charge counter, computed by the platform: P5 found the percentage unreliable for drain. */
  val drainPctPerHour: Double?,
  val shed: ShedStep?,
)
