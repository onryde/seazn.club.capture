package com.seazn.capture.engine.core

/**
 * The server's word that a session is over (spec, _Ask_ → Descriptor and Heartbeat): a 410, or a 2xx
 * whose body's `state` is one of [STATES]. One rule for both answers (final review M-4), so the
 * heartbeat and the descriptor can never disagree about the same session.
 */
object SessionOver {
  /** Descriptor states that mean the session is over. */
  val STATES = setOf("ending", "completed", "failed")

  fun said(status: Int, state: String?): Boolean = status == 410 || (status in 200..299 && state in STATES)
}
