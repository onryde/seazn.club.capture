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
 * Also absent: any level-based reason; a silent room is ready and on air is plain Live (spec §4).
 */
enum class DegradeReason(override val wire: String) : Wire {
  NOT_DELIVERED("not-delivered"),
  CAMERA_TAKEN("camera-taken"),
  MIC_SILENCED("mic-silenced"),
  POOR_UPLINK("poor-uplink"),
  FELL_BACK_TO_RTMPS("fell-back-to-rtmps"),
}

/**
 * Why a pairing ended: the operator's stop, or a failure. A broadcast that ends without the operator
 * (an organiser stop, a server end, a hold that runs out) returns to Paired with its [LastEnd].
 */
enum class EndReason(override val wire: String) : Wire {
  OPERATOR_STOPPED("operator-stopped"),
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

  /**
   * C6 I-3: the capture held no camera to connect (an Orient rebuild that found it busy, a reopen that
   * failed). It says nothing about the path to the ingest or the session: never counted towards the
   * fallback, and never an ask for the code.
   */
  UNHELD("unheld"),

  /**
   * Device session 4, F-S4-1: the camera failed the start (StreamPack lost it, or a throw from its camera source).
   * It says nothing about the path to the ingest either: never counted towards the fallback, which could not help,
   * and never an ask. The capture builds the camera afresh, and its `camera` readiness is false while it is lost.
   */
  CAMERA("camera"),
}

enum class HeartbeatResult(override val wire: String) : Wire {
  OK("ok"),
  FAILED("failed"),
  SESSION_OVER("session-over"),
}

/**
 * How the overlay's score reaches it: the session shape's `scoreUpdates`, a closed set in the web
 * descriptor schema (09e87aabd). The core holds the server's word as read; the snapshot wire crosses
 * only these words, and any other as null, for that field alone (controller ruling, review 12 I2).
 */
enum class ScoreUpdates(override val wire: String) : Wire {
  REALTIME("realtime"),
  POLLED("polled");

  companion object {
    /** The server's word; null for any other, an absent one included. */
    fun of(word: String?): ScoreUpdates? = entries.firstOrNull { it.wire == word }
  }
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
