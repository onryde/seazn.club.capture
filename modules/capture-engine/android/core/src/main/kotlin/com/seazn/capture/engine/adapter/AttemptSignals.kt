package com.seazn.capture.engine.adapter

import com.seazn.capture.engine.core.DropReason
import com.seazn.capture.engine.core.Input

/**
 * R3: one report per attempt, whatever the platform repeats. StreamPack's `IEndpoint.isOpenFlow` (3.2.0 and 3.2.1, javap)
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
 * - Review C7 M-3: a drop of the attempt whose start is in flight ([starting]) is held until the start
 *   ends ([startEnded]). A start that found the camera busy makes it no drop: the start's failure ends the
 *   attempt, UNHELD and never counted. Device session 4 (F-S4-1): a start that failed makes a drop with no
 *   cause no drop either. StreamPack 3.2.1's `startStream(descriptor)` closes the endpoint it opened when it
 *   fails (`EncodingPipelineOutput.startStream`'s catch runs `closeUnsafe`, the 3.2.1 sources), so that close
 *   is the failed start's own, and passing it hid the failure: the phone read `other`, `requested`, never
 *   counted, with no message, every 2.5 s for two minutes. The far end's drop (a cause) still passes. Any
 *   other end passes the drop held, as it always passed.
 *
 * It holds the newest attempt, whether that one ended, and the ids that opened: one Int an attempt that
 * opened, a few hundred in a long day. Called from the endpoint's coroutines, so every method is
 * synchronized.
 */
class AttemptSignals {
  private var newest: Int? = null
  private var ended = false
  private val opened = mutableSetOf<Int>()

  /** M-3: the attempt whose start is in flight, and a drop of it held until that start ends. */
  private var inFlight: Int? = null
  private var held: Input.Dropped? = null

  /** M-3: attempt [id]'s start begins. */
  @Synchronized
  fun starting(id: Int) {
    inFlight = id
    held = null
  }

  /**
   * M-3: attempt [id]'s start ended, as [end] says. A drop held that was the start's own ([own]) is no drop and the
   * attempt is not ended, so the start's failure ends it; any other passes now. Null for an attempt not starting.
   */
  @Synchronized
  fun startEnded(id: Int, end: StartEnd): Input.Dropped? {
    if (inFlight != id) return null
    inFlight = null
    val drop = held ?: return null
    held = null
    if (!own(drop, end)) return drop
    if (newest == id) ended = false
    return null
  }

  /** The camera's failure owns any drop of its start; a failed start owns the close it made, the drop with no cause (F-S4-1). */
  private fun own(drop: Input.Dropped, end: StartEnd): Boolean =
    end == StartEnd.CAMERA || (end == StartEnd.FAILED && drop.reason == DropReason.REQUESTED)

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
    val drop = if (cause == null) Input.Dropped(id, DropReason.REQUESTED, null) else Input.Dropped(id, DropReason.ENDPOINT_CLOSED, Failures.describe(cause))
    if (id != inFlight) return drop
    held = drop
    return null
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

/** How a start in flight ended ([AttemptSignals.startEnded]). */
enum class StartEnd {
  /** It returned, or was cancelled. */
  RETURNED,

  /** It threw, or ran out its bound; its failure is reported next, and the close it made is no drop (F-S4-1). */
  FAILED,

  /** The camera failed it (C7 carry: another app holds it); its failure is reported next, and no drop held is one. */
  CAMERA,
}
