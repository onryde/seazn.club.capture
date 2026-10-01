package com.seazn.capture.engine.core

/** The heartbeat's answer, already typed by the platform's HTTP client. */
sealed interface HeartbeatResponse {
  /** [state] and [endReason] are the response body's `{state, endReason?}`; null when absent or unreadable. */
  data class Answered(val status: Int, val state: String?, val endReason: String?) : HeartbeatResponse

  data class Failed(val message: String) : HeartbeatResponse
}

/** What one beat reports (spec, _Ask_ → Heartbeat). Built from the snapshot; carries no secret. */
data class HeartbeatFacts(
  val sid: String,
  val atEpochMs: Long,
  val state: SnapshotState,
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
)

data class HeartbeatState(
  val nextDueAtMs: Long = 0,
  val inFlightId: Int? = null,
  val inFlightSinceMs: Long = 0,
  val nextId: Int = 1,
  val lastSentAtEpochMs: Long? = null,
  val lastResult: HeartbeatResult? = null,
  val consecutiveFailures: Int = 0,
  val failures: Int = 0,
) {
  val status: HeartbeatStatus
    get() = HeartbeatStatus(lastSentAtEpochMs, lastResult, consecutiveFailures, failures)

  internal fun failed(): HeartbeatState =
    copy(inFlightId = null, lastResult = HeartbeatResult.FAILED, consecutiveFailures = consecutiveFailures + 1, failures = failures + 1)
}

/**
 * Ruling 5: a heartbeat to the console every ~10 s while armed or live, sent natively (ruling 6). It
 * never blocks or degrades the stream: a failure is counted and dropped, and a beat that never comes
 * back is given up after [TIMEOUT_MS] so the next one still goes. Its answer is the phone's way to
 * learn of an organiser stop (decision 9).
 */
object Heartbeat {
  const val INTERVAL_MS = 10_000L
  const val TIMEOUT_MS = 10_000L

  /** The id of the beat to send now, or null. */
  fun due(state: HeartbeatState, nowMs: Long, wallMs: Long): Pair<HeartbeatState, Int?> {
    var next = state
    if (next.inFlightId != null && nowMs - next.inFlightSinceMs >= TIMEOUT_MS) next = next.failed()
    if (next.inFlightId != null || nowMs < next.nextDueAtMs) return next to null
    val id = next.nextId
    return next.copy(
      inFlightId = id,
      inFlightSinceMs = nowMs,
      nextId = id + 1,
      nextDueAtMs = nowMs + INTERVAL_MS,
      lastSentAtEpochMs = wallMs,
    ) to id
  }

  /** The answer to beat [id]. The boolean is true when the server says the session is over ([SessionOver]). */
  fun answered(state: HeartbeatState, id: Int, response: HeartbeatResponse): Pair<HeartbeatState, Boolean> {
    if (state.inFlightId != id) return state to false
    val over = response is HeartbeatResponse.Answered && SessionOver.said(response.status, response.state)
    return when {
      over -> state.copy(inFlightId = null, lastResult = HeartbeatResult.SESSION_OVER) to true
      response is HeartbeatResponse.Answered && response.status in 200..299 ->
        state.copy(inFlightId = null, lastResult = HeartbeatResult.OK, consecutiveFailures = 0) to false
      else -> state.failed() to false
    }
  }

  fun payload(facts: HeartbeatFacts): String =
    Json.obj(
      listOf(
        "sid" to facts.sid,
        "at" to IsoTime.utc(facts.atEpochMs),
        "state" to facts.state,
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
    )
}
