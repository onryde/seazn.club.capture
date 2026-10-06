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

  fun clamp(pollSeconds: Int?): Int = (pollSeconds ?: DEFAULT_POLL_S).coerceIn(MIN_POLL_S, MAX_POLL_S)

  fun intervalMs(pollSeconds: Int, held: Boolean): Long {
    val pollMs = clamp(pollSeconds) * 1_000L
    return if (held) minOf(pollMs, HELD_MAX_MS) else pollMs
  }

  fun retryAfterMs(retryAfterS: Int): Long = clamp(retryAfterS) * 1_000L
}
