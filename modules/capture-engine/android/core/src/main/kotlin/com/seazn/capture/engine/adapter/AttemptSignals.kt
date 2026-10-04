package com.seazn.capture.engine.adapter

import com.seazn.capture.engine.core.DropReason
import com.seazn.capture.engine.core.Input

/**
 * R3: one report per attempt, whatever the platform repeats. StreamPack 3.2.0's `IEndpoint.isOpenFlow`
 * is a StateFlow, which replays, and its streamers' `throwableFlow` is constant null (research R3), so
 * that is never the source: an attempt's drop comes from the sink's completion. Used by the RTMPS path,
 * the frame path and our own SRT sink (Task 35).
 *
 * - An open passes once per attempt, whichever attempt it names (review 19, I1). The machine judges
 *   whether it still wants it: one it does not want, an older attempt's or one that already failed or
 *   dropped, it answers with `Disconnect(n)` and a `stale-connected` line, and that is what closes the
 *   stream. Only the pollers ignore an older attempt's open (Task 14). A replayed open is never a
 *   second connect.
 * - A drop or a failed connect passes for the newest attempt heard of, once, and ends it. One for an
 *   older attempt is null: the machine ignores those anyway. Attempt ids only grow.
 * - A connect failure after the attempt opened is null, and does not end it (review 14): the machine
 *   ignores one on air, so the attempt's end is its drop, which still passes.
 * - A drop with no cause is the requested close; any other is the far end's, named for the record,
 *   which masks the secrets in it where they stand (CD6). The text passes whole: a cut one could leave
 *   part of a secret that no mask matches.
 *
 * It holds the newest attempt, whether that one ended, and the ids that opened: one Int an attempt that
 * opened, a few hundred in a long day. Called from the endpoint's coroutines, so every method is
 * synchronized.
 */
class AttemptSignals {
  private var newest: Int? = null
  private var ended = false
  private val opened = mutableSetOf<Int>()

  @Synchronized
  fun connected(id: Int): Input.Connected? {
    if (id in opened) return null
    advance(id)
    opened += id
    return Input.Connected(id)
  }

  @Synchronized
  fun dropped(id: Int, cause: Throwable?): Input.Dropped? {
    if (stale(id)) return null
    advance(id)
    if (ended) return null
    ended = true
    if (cause == null) return Input.Dropped(id, DropReason.REQUESTED, null)
    return Input.Dropped(id, DropReason.ENDPOINT_CLOSED, Failures.describe(cause))
  }

  @Synchronized
  fun connectFailed(id: Int, t: Throwable): Input.ConnectFailed? {
    if (stale(id)) return null
    advance(id)
    if (ended || id in opened) return null
    ended = true
    return Input.ConnectFailed(id, SrtOptions.failure(t), Failures.describe(t))
  }

  /** Older than the newest attempt heard of. */
  private fun stale(id: Int): Boolean = newest?.let { id < it } == true

  /** A newer attempt becomes the newest, not yet ended. An older or the same one changes nothing. */
  private fun advance(id: Int) {
    if (newest?.let { id <= it } == true) return
    newest = id
    ended = false
  }
}
