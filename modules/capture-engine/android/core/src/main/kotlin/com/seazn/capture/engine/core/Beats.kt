package com.seazn.capture.engine.core

/** What one beat reports (amendment, _Contract shapes_). Built from the phase; carries no secret. */
data class BeatFacts(
  val code: String,
  val slot: Int,
  val phoneId: String,
  val claim: Claim?,
  /** `Build.MODEL`, sent with a claim only (2026-10-01). */
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
  val audioOk: Boolean,
  val batteryPercent: Int?,
  val charging: Boolean?,
  val drainPctPerHour: Double?,
  val thermalStatus: Int?,
  val dataUsedBytes: Long,
  val appVersion: String,
  /** A8: only on the final beat, with [state] `ended`. */
  val endReason: EndReason? = null,
)

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
    if (facts.claim != null && facts.deviceModel != null) fields += "device" to JsonObject(listOf("model" to facts.deviceModel))
    fields +=
      listOf(
        "sid" to facts.sid,
        "at" to IsoTime.utc(facts.atEpochMs),
        "state" to facts.state,
        "cause" to facts.cause,
        "notReady" to facts.notReady,
        "startFailed" to facts.startFailed,
        "stopped" to (if (facts.sid == null) facts.stopped else null),
        "mode" to (if (facts.automatic) "automatic" else "operator"),
        "transport" to facts.transport,
        "bitrateKbps" to facts.bitrateKbps,
        "delivery" to facts.delivery,
        "deliveredLagS" to facts.deliveredLagMs?.let { Decimal.tenths(it / 1_000.0) },
        "audioOk" to facts.audioOk,
        "battery" to
          JsonObject(
            listOf(
              "percent" to facts.batteryPercent,
              "charging" to facts.charging,
              "drainPctPerHour" to facts.drainPctPerHour?.let { Decimal.tenths(it) },
            )
          ),
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
