package com.seazn.capture.engine.srt.connect

import com.seazn.capture.engine.adapter.AttemptSignals
import com.seazn.capture.engine.core.Input
import com.seazn.capture.engine.core.RecordEntry
import java.net.InetSocketAddress
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

/**
 * Our SRT sink's connect, send and end (Task 35, C6 I-2, C7u), apart from StreamPack and srtdroid so
 * core's tests run them: whether the endpoint is open, how the socket held ended, the one drop an attempt
 * reports from the socket's end (R3), and the packets a full send buffer drops (StreamPack#302). The
 * host's lookup is `HostLookup`'s. Imports nothing Android. [line] takes the record's lines, and [nowMs]
 * is a monotonic clock in ms.
 */
class SrtConnection(
  private val signals: AttemptSignals,
  private val report: (Input) -> Unit,
  private val line: (RecordEntry) -> Unit,
  private val nowMs: () -> Long,
) {
  private val open = MutableStateFlow(false)

  /** The sink's `isOpenFlow`. */
  val isOpen: StateFlow<Boolean> = open.asStateFlow()

  /**
   * How the socket held ended, once it has: a write after it fails with it. Null while it lives, and after
   * an end with no cause. The first end's cause stays: a send's failure and the socket's own end both end it.
   */
  @Volatile
  var ended: Throwable? = null
    private set

  /** The attempt whose socket connected, while it is held: a send names it. */
  @Volatile private var attempt: Int? = null

  /** The sink is closing the socket it held: a send failing from here on is that close's, never a cut. */
  @Volatile private var closing = false

  /** This attempt's sends that would have blocked: each packet was dropped (StreamPack#302). */
  @Volatile
  var sendDropped = 0L
    private set

  /** Drops not yet in a line, and when the last line was written; both guarded by `this`. */
  private var unwritten = 0
  private var lastLineMs: Long? = null

  /**
   * Connects [socket] for [attemptId], and only then listens for its end (C6 I-2). srtdroid's failed
   * connect ends the socket before it rethrows ([SrtSocketPort.connect]): a listener already there would
   * report that failure as the attempt's drop, the signals would then refuse the connect failure that
   * names it, and a refused ingest, which asks for the code again (ruling 15), would read as a cut.
   *
   * [held] runs once it has connected (MAXBW, and the sink holding it). One that throws fails the connect,
   * with no listener yet, and closes the socket it connected (C6 re-review): nothing else holds it, so it
   * would stay open at the ingest. The endpoint shows open before the listening: a socket that ended in
   * between still reports its drop, since an ended socket runs a new listener at once, and shows closed.
   */
  suspend fun connect(socket: SrtSocketPort, attemptId: Int, address: InetSocketAddress, held: () -> Unit) {
    ended = null
    attempt = null
    closing = false
    restartDrops()
    socket.connect(address)
    try {
      held()
    } catch (failure: Throwable) {
      try {
        socket.close()
      } catch (closing: Exception) {
        failure.addSuppressed(closing)
      }
      throw failure
    }
    attempt = attemptId
    open.value = true
    socket.onEnd { cause -> end(attemptId, cause) }
  }

  /**
   * One packet through srtdroid 1.10.1's non-blocking `trySend`, as StreamPack 3.2.1's SrtSink sends
   * (StreamPack#302): [trySend] makes the call, and never waits on the uplink. Its answers (javap,
   * `handleTrySendResult`):
   * - Bytes sent: passed on.
   * - [WOULD_BLOCK], libsrt's send buffer is full (EASYNCSND): the packet is dropped. The attempt lives:
   *   no drop, no failure. The drop is counted in [sendDropped], which the link's sender drops carry to
   *   Diagnostics and the regulator, and recorded as `srt-send-dropped`, at most once in
   *   [DROP_LINE_EVERY_MS], with the count held back since the last line.
   * - A throw, the socket is over: a SocketException with libsrt's text, or a SocketTimeoutException
   *   `ESCLOSED` for a 0. That attempt's one drop names it, unless the socket's end already reported, or
   *   the sink is closing it, whose end is the requested drop. Rethrown, so the sink throws ClosedException.
   *   Any other number is no answer srtdroid gives, and is refused as one.
   */
  fun send(trySend: () -> Int): Int {
    val id = attempt ?: throw IllegalStateException("an SRT send with no attempt connected")
    val sent =
      try {
        trySend().also { check(it > 0 || it == WOULD_BLOCK) { "srtdroid's trySend answered $it" } }
      } catch (failure: Exception) {
        if (!closing) end(id, failure)
        throw failure
      }
    if (sent == WOULD_BLOCK) dropped(id)
    return sent
  }

  /** The sink closes the socket it held, with [close]: a send that fails on it meanwhile is no cut. */
  fun closed(close: () -> Unit) {
    closing = true
    try {
      close()
    } finally {
      open.value = false
      writeHeldDrops()
    }
  }

  private fun end(attemptId: Int, cause: Throwable?) {
    if (ended == null) ended = cause
    open.value = false
    writeHeldDrops()
    signals.dropped(attemptId, cause)?.let(report)
  }

  @Synchronized
  private fun restartDrops() {
    sendDropped = 0
    unwritten = 0
    lastLineMs = null
  }

  @Synchronized
  private fun dropped(id: Int) {
    sendDropped += 1
    unwritten += 1
    val now = nowMs()
    if (lastLineMs?.let { now - it < DROP_LINE_EVERY_MS } == true) return
    lastLineMs = now
    writeDrops(id)
  }

  /** An attempt's end writes the drops it held back, so the lines add up to the counter. */
  @Synchronized
  private fun writeHeldDrops() {
    val id = attempt ?: return
    if (unwritten > 0) writeDrops(id)
  }

  private fun writeDrops(id: Int) {
    line(RecordEntry("srt-send-dropped", listOf("attempt" to id, "count" to unwritten)))
    unwritten = 0
  }

  companion object {
    /** srtdroid 1.10.1's `trySend` answer when libsrt's send buffer is full (EASYNCSND). */
    const val WOULD_BLOCK = -1

    /**
     * At most one `srt-send-dropped` line in this long, per attempt: a congested uplink drops packets for
     * seconds on end, and the record shows when; the counter counts every one.
     */
    const val DROP_LINE_EVERY_MS = 10_000L
  }
}
