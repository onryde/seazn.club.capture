package com.seazn.capture.engine.core

/**
 * One session's descriptor asks (spec §1: the descriptor is fetched again on a reconnect). Every ask
 * carries an id, and only the answer to the latest ask is acted on (B6 review I2): an answer
 * nobody asked for, one to an earlier ask, or a second answer to the same ask changes nothing.
 *
 * A refused connect asks at most once per [SPACING_MS], and never while an ask is in flight (B6
 * ruling C1), before the first frame as well as within an outage; so does a rebuild or a forced new
 * session, which reconnects the link too (B7). An ask with no answer in [GIVE_UP_MS] no longer blocks
 * the next, so a lost answer never stops the asks for good; its answer still counts until a newer ask
 * supersedes it. A drop always asks, whatever is in flight.
 */
data class DescriptorAsks(val nextId: Int = 1, val inFlightId: Int? = null, val lastAskAtMs: Long? = null) {
  /** Whether a refused connect, a rebuild or a forced new session may ask at [nowMs]. */
  fun mayAsk(nowMs: Long): Boolean {
    val lastMs = lastAskAtMs ?: return true
    val sinceMs = nowMs - lastMs
    return sinceMs >= SPACING_MS && (inFlightId == null || sinceMs >= GIVE_UP_MS)
  }

  /** A new ask at [nowMs], and its id. It supersedes any ask in flight. */
  fun asked(nowMs: Long): Pair<DescriptorAsks, Int> = copy(nextId = nextId + 1, inFlightId = nextId, lastAskAtMs = nowMs) to nextId

  /** The asks once [id] is answered, or null when [id] is not the ask in flight. */
  fun answered(id: Int): DescriptorAsks? = if (id == inFlightId) copy(inFlightId = null) else null

  companion object {
    /** B6 ruling C1: about six asks a minute at most, however fast connects are refused. */
    const val SPACING_MS = 10_000L

    /** Three spacings: an ask still unanswered by then is taken as lost. */
    const val GIVE_UP_MS = 30_000L
  }
}
