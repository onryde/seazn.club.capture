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
  /**
   * When a failed beat brings the next one forward to, on the monotonic clock: its retry ([BeatCadence.retryMs]) or a
   * 429's Retry-After; null for none (a 2xx, any other 4xx, a 429 with no Retry-After, or a beat in flight).
   */
  val retryAtMonoMs: Long? = null,
) {
  val status: HeartbeatStatus
    get() = HeartbeatStatus(lastSentAtEpochMs, lastResult, consecutiveFailures, failures)

  /** The next beat due at [nowMs], whatever the cadence: the claim at a pairing goes at once (A9). */
  fun soon(nowMs: Long): HeartbeatState = copy(lastSentAtMonoMs = null, notBeforeMs = nowMs)

  /**
   * A failure at [nowMs]. A [passing] one (no answer, given up, a 408 or a 5xx) brings the next beat forward by the
   * backoff for this many failures in a row; otherwise [retryAtMs] does, a 429's Retry-After, or nothing does.
   */
  internal fun failed(nowMs: Long, passing: Boolean, retryAtMs: Long? = null): HeartbeatState {
    val inRow = consecutiveFailures + 1
    return copy(
      inFlightId = null,
      retryAtMonoMs = if (passing) BeatCadence.retryMs(inRow)?.let { nowMs + it } else retryAtMs,
      lastResult = HeartbeatResult.FAILED,
      consecutiveFailures = inRow,
      failures = failures + 1,
    )
  }

  /**
   * When the next beat is due at [intervalMs], before a 429's wait: at once with no beat sent (or one cleared to go at
   * once), [intervalMs] after the last, or at a failure's retry when that is sooner: never later than the cadence.
   */
  internal fun dueAtMs(intervalMs: Long): Long {
    val last = lastSentAtMonoMs ?: return Long.MIN_VALUE
    return minOf(last + intervalMs, retryAtMonoMs ?: Long.MAX_VALUE)
  }
}

/**
 * The pairing's beat (amendment, _Contract shapes_), sent natively (ruling 6) at [BeatCadence]'s
 * interval. It never blocks or degrades the stream: a failure is counted and dropped, a beat
 * that never comes back is given up after [TIMEOUT_MS] so the next one still goes, and after a passing failure the next
 * goes sooner than the cadence ([BeatCadence.retryMs]). Its answer is the
 * phone's way to hear a Go live and an organiser stop ([ServerWord.ofBeat]).
 */
object Heartbeat {
  const val TIMEOUT_MS = 10_000L

  /** The id of the beat to send now, or null. [intervalMs] is the cadence now: it may shorten between beats. */
  fun due(state: HeartbeatState, nowMs: Long, wallMs: Long, intervalMs: Long): Pair<HeartbeatState, Int?> {
    var next = state
    if (next.inFlightId != null && nowMs - next.inFlightSinceMs >= TIMEOUT_MS) next = next.failed(nowMs, passing = true)
    val waiting = next.inFlightId != null || nowMs < next.notBeforeMs || nowMs < next.dueAtMs(intervalMs)
    if (waiting) return next to null
    val id = next.nextId
    val sent = next.copy(inFlightId = id, inFlightSinceMs = nowMs, nextId = id + 1, lastSentAtMonoMs = nowMs, lastSentAtEpochMs = wallMs, retryAtMonoMs = null)
    return sent to id
  }

  /**
   * The answer to beat [id], or the state unchanged for any other. [HeartbeatResult.SESSION_OVER]
   * when the server's word is [ServerWord.Over] (the answer table decides what that ends). A 429 sets
   * [HeartbeatState.notBeforeMs], which holds the next beat past the retry a failure brings.
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
      else -> answered.failed(nowMs, passing(response), retryAtMs = delayed)
    }
  }

  /**
   * The controller's ruling (Task 13 fix round 1): the failures worth a beat sooner than the cadence are the passing
   * ones, the network's (no answer) and the server's (408, 5xx). Any other 4xx is an answer a retry would only repeat.
   */
  private fun passing(response: HeartbeatResponse): Boolean =
    response is HeartbeatResponse.Failed || (response is HeartbeatResponse.Answered && (response.status == 408 || response.status in 500..599))
}
