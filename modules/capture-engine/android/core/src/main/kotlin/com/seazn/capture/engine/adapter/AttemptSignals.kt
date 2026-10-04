package com.seazn.capture.engine.adapter

import com.seazn.capture.engine.core.DropReason
import com.seazn.capture.engine.core.Input

/**
 * R3: one report per attempt, whatever the platform repeats. StreamPack 3.2.0's `IEndpoint.isOpenFlow`
 * is a StateFlow, which replays, and its streamers' `throwableFlow` is constant null (research R3), so
 * that is never the source: an attempt's drop comes from the sink's completion. Used by the RTMPS path, the frame path and our own
 * SRT sink (Task 35).
 *
 * - The first report for an attempt that has not ended passes; any repeat is null.
 * - An attempt ends at its drop or its failed connect, and is never reported again after it.
 * - A connect failure after the attempt connected is null, and does not end it (review 14): the machine
 *   ignores one on air, so the attempt's end is its drop, which still passes.
 * - A signal for an attempt older than the newest heard of is stale, and null, as the pollers read a
 *   late `Connected` (Task 14). Attempt ids only grow, so only the newest attempt is held.
 * - A drop with no cause is the requested close; any other is the far end's, named for the record,
 *   which masks the secrets in it where they stand (CD6). The text passes whole: a cut one could leave
 *   part of a secret that no mask matches.
 *
 * Called from the endpoint's coroutines, so every method is synchronized.
 */
class AttemptSignals {
  private var newest: Int? = null
  private var connected = false
  private var ended = false

  @Synchronized
  fun connected(id: Int): Input.Connected? {
    if (!current(id) || connected || ended) return null
    connected = true
    return Input.Connected(id)
  }

  @Synchronized
  fun dropped(id: Int, cause: Throwable?): Input.Dropped? {
    if (!current(id) || ended) return null
    ended = true
    if (cause == null) return Input.Dropped(id, DropReason.REQUESTED, null)
    return Input.Dropped(id, DropReason.ENDPOINT_CLOSED, Failures.describe(cause))
  }

  @Synchronized
  fun connectFailed(id: Int, t: Throwable): Input.ConnectFailed? {
    if (!current(id) || connected || ended) return null
    ended = true
    return Input.ConnectFailed(id, SrtOptions.failure(t), Failures.describe(t))
  }

  /** Whether [id] is the newest attempt heard of. A newer one starts afresh; an older one is stale. */
  private fun current(id: Int): Boolean {
    val known = newest
    if (known != null && id < known) return false
    if (known == null || id > known) {
      newest = id
      connected = false
      ended = false
    }
    return true
  }
}
