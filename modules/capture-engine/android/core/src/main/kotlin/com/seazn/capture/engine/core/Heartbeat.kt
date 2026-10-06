package com.seazn.capture.engine.core

/** The heartbeat's answer, already typed by the platform's HTTP client. */
sealed interface HeartbeatResponse {
  /** [reply] is the body as read (Task 15), null when absent or unreadable; [retryAfterS] a 429's. */
  data class Answered(val status: Int, val reply: BeatReply? = null, val retryAfterS: Int? = null) : HeartbeatResponse

  data class Failed(val message: String) : HeartbeatResponse
}

data class HeartbeatState(
  /** When the last beat went, on the monotonic clock; null before the first. */
  val lastSentAtMonoMs: Long? = null,
  /** No beat before this, on the monotonic clock: the first beat's time, or a 429's Retry-After. */
  val notBeforeMs: Long = 0,
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

  /** The next beat due at [nowMs], whatever the cadence: the claim at a pairing goes at once (A9). */
  fun soon(nowMs: Long): HeartbeatState = copy(lastSentAtMonoMs = null, notBeforeMs = nowMs)

  internal fun failed(): HeartbeatState =
    copy(inFlightId = null, lastResult = HeartbeatResult.FAILED, consecutiveFailures = consecutiveFailures + 1, failures = failures + 1)
}

/**
 * The pairing's beat (amendment, _Contract shapes_), sent natively (ruling 6) at [BeatCadence]'s
 * interval. It never blocks or degrades the stream: a failure is counted and dropped, and a beat
 * that never comes back is given up after [TIMEOUT_MS] so the next one still goes. Its answer is the
 * phone's way to hear a Go live and an organiser stop ([ServerWord.ofBeat]).
 */
object Heartbeat {
  const val TIMEOUT_MS = 10_000L

  /** The id of the beat to send now, or null. [intervalMs] is the cadence now: it may shorten between beats. */
  fun due(state: HeartbeatState, nowMs: Long, wallMs: Long, intervalMs: Long): Pair<HeartbeatState, Int?> {
    var next = state
    if (next.inFlightId != null && nowMs - next.inFlightSinceMs >= TIMEOUT_MS) next = next.failed()
    val last = next.lastSentAtMonoMs
    val waiting = next.inFlightId != null || nowMs < next.notBeforeMs || (last != null && nowMs < last + intervalMs)
    if (waiting) return next to null
    val id = next.nextId
    return next.copy(inFlightId = id, inFlightSinceMs = nowMs, nextId = id + 1, lastSentAtMonoMs = nowMs, lastSentAtEpochMs = wallMs) to id
  }

  /**
   * The answer to beat [id], or the state unchanged for any other. [HeartbeatResult.SESSION_OVER]
   * when the server's word is [ServerWord.Over] (the answer table decides what that ends). A 429 sets
   * [HeartbeatState.notBeforeMs].
   */
  fun answered(state: HeartbeatState, id: Int, response: HeartbeatResponse, nowMs: Long): HeartbeatState {
    if (state.inFlightId != id) return state
    val over = ServerWord.ofBeat(response, named = null) is ServerWord.Over
    val delayed = (response as? HeartbeatResponse.Answered)?.retryAfterS?.let { nowMs + BeatCadence.retryAfterMs(it) }
    val answered = if (delayed != null) state.copy(notBeforeMs = delayed) else state
    return when {
      over -> answered.copy(inFlightId = null, lastResult = HeartbeatResult.SESSION_OVER)
      response is HeartbeatResponse.Answered && response.status in 200..299 ->
        answered.copy(inFlightId = null, lastResult = HeartbeatResult.OK, consecutiveFailures = 0)
      else -> answered.failed()
    }
  }
}
