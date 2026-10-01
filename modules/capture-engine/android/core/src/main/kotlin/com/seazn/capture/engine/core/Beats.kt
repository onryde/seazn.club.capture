package com.seazn.capture.engine.core

/** What one beat reports (amendment, _Contract shapes_). Built from the phase; carries no secret. */
data class BeatFacts(
  val code: String,
  val slot: Int,
  val phoneId: String,
  val claim: Claim?,
  /** `Build.MODEL`, sent as `device:{model}` with a claim only (2026-10-01); `device` is null otherwise (D1). */
  val deviceModel: String?,
  val sid: String?,
  val atEpochMs: Long,
  val state: String,
  val cause: Cause?,
  val notReady: NotReady?,
  val startFailed: StartFailure?,
  /** A17: a stopped sid, only when [sid] is null (RR3). */
  val stopped: String?,
  val automatic: Boolean,
  val transport: Transport?,
  val bitrateKbps: Int?,
  val delivery: Delivery,
  val deliveredLagMs: Long?,
  /** Null when nothing is publishing (D14); on air, true only on audio measured at the floor (carry 8). */
  val audioOk: Boolean?,
  /** Null unless the battery is read whole (D2). */
  val battery: BeatBattery?,
  val thermalStatus: Int?,
  val dataUsedBytes: Long,
  val appVersion: String,
  /** A8: only on the final beat, with [state] `ended`. */
  val endReason: EndReason? = null,
)

/** The beat's `battery` (`capture-beat.v1`, D2): whole, or null. Never an object with an unread half. */
data class BeatBattery(val percent: Int, val charging: Boolean, val drainPctPerHour: Double?) {
  companion object {
    /**
     * Known only with a percent of 0 to 100 and whether it charges; anything less is unknown, null. A
     * drain outside 0 to 1000 per hour is no reading (R1): null, the battery still whole.
     */
    fun of(sample: DeviceSample): BeatBattery? {
      val percent = sample.batteryPercent?.takeIf { it in 0..100 } ?: return null
      val charging = sample.charging ?: return null
      return BeatBattery(percent, charging, sample.drainPctPerHour?.takeIf { it in BeatBounds.DRAIN_PCT_PER_HOUR })
    }
  }
}

/**
 * `capture-beat.v1`'s bounds (web 09e87aabd) on the facts a phone measures. Each is nullable in the
 * schema, so a reading outside one is sent as null: one bad fact never turns a whole beat into a 422.
 * A raw bound on an integer limit also holds after [Decimal.tenths] rounds it.
 */
internal object BeatBounds {
  val DRAIN_PCT_PER_HOUR = 0.0..1_000.0
  val BITRATE_KBPS = 0..100_000
  val DELIVERED_LAG_S = 0.0..99_999.0
  val THERMAL = 0..6
  val DATA_USED_MB = 0.0..1_000_000.0
  const val MODEL_CHARACTERS = 80
}

/** Characters as JSON Schema counts them: code points, not UTF-16 units. */
internal val String.characters: Int
  get() = codePointCount(0, length)

/** The beat's and `POST start`'s bodies. The JSON writer is the core's own (`Json`). */
object Beats {
  fun payload(facts: BeatFacts): String {
    val fields =
      mutableListOf<Pair<String, Any?>>(
        "code" to facts.code,
        "slot" to facts.slot,
        "phone" to facts.phoneId,
        "claim" to facts.claim,
      )
    fields +=
      listOf(
        "sid" to facts.sid,
        "at" to IsoTime.utc(facts.atEpochMs),
        "state" to facts.state,
        "cause" to facts.cause,
        "notReady" to facts.notReady,
        "startFailed" to facts.startFailed,
        "stopped" to (if (facts.sid == null) facts.stopped else null),
        // D1: the key is always there; {model} with a claim, null otherwise (G0-e).
        "device" to model(facts.deviceModel)?.takeIf { facts.claim != null }?.let { JsonObject(listOf("model" to it)) },
        "mode" to (if (facts.automatic) "automatic" else "operator"),
        "transport" to facts.transport,
        "bitrateKbps" to facts.bitrateKbps?.takeIf { it in BeatBounds.BITRATE_KBPS },
        "delivery" to facts.delivery,
        "deliveredLagS" to facts.deliveredLagMs?.let { it / 1_000.0 }?.takeIf { it in BeatBounds.DELIVERED_LAG_S }?.let(Decimal::tenths),
        "audioOk" to facts.audioOk,
        "battery" to
          facts.battery?.let {
            JsonObject(listOf("percent" to it.percent, "charging" to it.charging, "drainPctPerHour" to it.drainPctPerHour?.let(Decimal::tenths)))
          },
        "thermal" to facts.thermalStatus?.takeIf { it in BeatBounds.THERMAL },
        "dataUsedMB" to (facts.dataUsedBytes / 1_000_000.0).takeIf { it in BeatBounds.DATA_USED_MB }?.let(Decimal::tenths),
        "appVersion" to facts.appVersion,
      )
    if (facts.endReason != null) fields += "endReason" to facts.endReason
    return Json.obj(fields)
  }

  /**
   * G0-e: `Build.MODEL`, trimmed and cut to 80 characters as the schema counts them, never through a
   * surrogate pair. A blank model is no model: `device` goes as null.
   */
  fun model(raw: String?): String? {
    val model = raw?.trim()?.takeIf { it.isNotEmpty() } ?: return null
    if (model.characters <= BeatBounds.MODEL_CHARACTERS) return model
    return model.substring(0, model.offsetByCodePoints(0, BeatBounds.MODEL_CHARACTERS))
  }

  /** `POST start {phone}` (web ask 9). */
  fun startBody(phoneId: String): String = Json.obj(listOf("phone" to phoneId))
}
