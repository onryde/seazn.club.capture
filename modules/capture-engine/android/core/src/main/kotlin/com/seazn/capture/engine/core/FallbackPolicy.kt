package com.seazn.capture.engine.core

/** What one failure did to the policy: whether it counted, and whether it moved the session over. */
data class FallbackDecision(val policy: FallbackPolicy, val counted: Boolean, val fellBack: Boolean)

/**
 * C1: primary → fallback (SRT → RTMPS when SRT is preferred). Connect failures **and** repeated
 * mid-session drops count (F-P5-2); a network that is not validated counts nothing, and neither does
 * a host that did not resolve (F-P5-1). The fallback is final for the session.
 */
data class FallbackPolicy(
  val primary: Transport,
  val fallback: Transport?,
  val current: Transport = primary,
  val count: Int = 0,
) {
  val fellBack: Boolean
    get() = current != primary

  fun connectFailed(failure: ConnectFailure, networkValidated: Boolean): FallbackDecision =
    counted(countable && networkValidated && failure != ConnectFailure.UNRESOLVED)

  /**
   * A drop counts when the far end closed an attempt that published for less than
   * [SHORT_ATTEMPT_MS]. A longer attempt proves the path worked: it clears the count and does not
   * count, even on a network that is not validated now, and whatever the reason.
   */
  fun dropped(reason: DropReason, networkValidated: Boolean, publishedMs: Long): FallbackDecision {
    if (publishedMs >= SHORT_ATTEMPT_MS) return FallbackDecision(copy(count = 0), counted = false, fellBack = false)
    return counted(countable && networkValidated && reason == DropReason.ENDPOINT_CLOSED)
  }

  private val countable: Boolean
    get() = fallback != null && current == primary

  private fun counted(counts: Boolean): FallbackDecision {
    if (!counts) return FallbackDecision(this, counted = false, fellBack = false)
    val next = count + 1
    if (next < FAILURES_TO_FALL_BACK || fallback == null) {
      return FallbackDecision(copy(count = next), counted = true, fellBack = false)
    }
    return FallbackDecision(copy(current = fallback, count = 0), counted = true, fellBack = true)
  }

  companion object {
    /** C1's three failures. */
    const val FAILURES_TO_FALL_BACK = 3

    /**
     * F-P5-2's collapses came every 6–22 s. F-P5-13's far-end closes come 31–33 s after a reconnect
     * on a healthy link and must not push a good link off SRT. 25 s sits between the two.
     */
    const val SHORT_ATTEMPT_MS = 25_000L
  }
}
