package com.seazn.capture.engine.core

/**
 * How often the pairing beats (amendment, _Contract shapes_ and _Beats while locked_). The server
 * drives `pollSeconds` (60 s until about 30 min before the start, 10 s after), clamped here.
 */
object BeatCadence {
  const val MIN_POLL_S = 5
  const val MAX_POLL_S = 300

  /** Ruling 5's console health: while a broadcast is held, never longer than this between beats. */
  const val HELD_MAX_MS = 10_000L

  /** Before the server's first 2xx says otherwise (CD38): a claim that failed is retried soon. */
  const val DEFAULT_POLL_S = 10

  /**
   * After a passing failure (no answer, a beat given up, a 408 or a 5xx), the next beat goes this long after it, so a
   * beat lost at the server's 60 s never leaves the phone deaf to a Go live for a minute (court stream Task 13, NE2211).
   * The poll floor, so a retry never beats faster than the server may ask.
   */
  const val RETRY_MS = MIN_POLL_S * 1_000L

  /**
   * The controller's ruling (Task 13 fix round 1): the retry backs off over failures in a row, 5 s, 10 s, then 20 s, so
   * a server in trouble is not met with a beat every 5 s from every phone; from the fourth the cadence decides. The
   * caller keeps the cadence as a ceiling: a retry only ever brings a beat forward.
   */
  private val RETRY_STEPS_MS = listOf(RETRY_MS, 2 * RETRY_MS, 4 * RETRY_MS)

  /** How long after the [consecutiveFailures]th passing failure in a row the next beat goes; null: at the cadence. */
  fun retryMs(consecutiveFailures: Int): Long? = RETRY_STEPS_MS.getOrNull(consecutiveFailures - 1)

  fun clamp(pollSeconds: Int?): Int = (pollSeconds ?: DEFAULT_POLL_S).coerceIn(MIN_POLL_S, MAX_POLL_S)

  fun intervalMs(pollSeconds: Int, held: Boolean): Long {
    val pollMs = clamp(pollSeconds) * 1_000L
    return if (held) minOf(pollMs, HELD_MAX_MS) else pollMs
  }

  fun retryAfterMs(retryAfterS: Int): Long = clamp(retryAfterS) * 1_000L
}
