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
    /** Known only with a percent of 0 to 100 and whether it charges; anything less is unknown, null. */
    fun of(sample: DeviceSample): BeatBattery? {
      val percent = sample.batteryPercent?.takeIf { it in 0..100 } ?: return null
      val charging = sample.charging ?: return null
      return BeatBattery(percent, charging, sample.drainPctPerHour)
    }
  }
}

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
        "device" to facts.deviceModel?.takeIf { facts.claim != null }?.let { JsonObject(listOf("model" to it)) },
        "mode" to (if (facts.automatic) "automatic" else "operator"),
        "transport" to facts.transport,
        "bitrateKbps" to facts.bitrateKbps,
        "delivery" to facts.delivery,
        "deliveredLagS" to facts.deliveredLagMs?.let { Decimal.tenths(it / 1_000.0) },
        "audioOk" to facts.audioOk,
        "battery" to
          facts.battery?.let {
            JsonObject(listOf("percent" to it.percent, "charging" to it.charging, "drainPctPerHour" to it.drainPctPerHour?.let(Decimal::tenths)))
          },
        "thermal" to facts.thermalStatus,
        "dataUsedMB" to Decimal.tenths(facts.dataUsedBytes / 1_000_000.0),
        "appVersion" to facts.appVersion,
      )
    if (facts.endReason != null) fields += "endReason" to facts.endReason
    return Json.obj(fields)
  }

  /** `POST start {phone}` (web ask 9). */
  fun startBody(phoneId: String): String = Json.obj(listOf("phone" to phoneId))
}
