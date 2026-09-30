package com.seazn.capture.engine.core

/**
 * One outage's hold (C2): how long the platform keeps the input for a publisher that has gone. The
 * window is per transport, from the descriptor, and the clock starts at the phone's own drop.
 *
 * H-P5-1 measured the platform timing its hold from when it *notices* the publisher is gone, which is
 * at or after the phone's drop (~0.25 s for a clean close, ~30 s for a vanished one). So a count
 * from the drop never overstates the time left.
 */
data class Hold(val transport: Transport, val windowSeconds: Int, val startedAtMs: Long) {
  fun remainingSeconds(nowMs: Long): Int {
    val remainingMs = windowSeconds * 1_000L - (nowMs - startedAtMs)
    return if (remainingMs <= 0) 0 else ((remainingMs + 999) / 1_000).toInt()
  }

  fun expired(nowMs: Long): Boolean = nowMs - startedAtMs >= windowSeconds * 1_000L
}

object HoldClock {
  /** Null when the descriptor gave no window for [transport]; `SessionConfig.problems` refuses that at arm. */
  fun started(windows: Map<Transport, Int>, transport: Transport, nowMs: Long): Hold? =
    windows[transport]?.takeIf { it > 0 }?.let { Hold(transport, it, nowMs) }
}
