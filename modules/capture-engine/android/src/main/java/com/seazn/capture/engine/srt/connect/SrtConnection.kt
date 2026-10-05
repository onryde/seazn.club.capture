package com.seazn.capture.engine.srt.connect

import com.seazn.capture.engine.adapter.AttemptSignals
import com.seazn.capture.engine.core.Input
import java.net.InetSocketAddress
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

/**
 * Our SRT sink's connect and end (Task 35, C6 I-2), apart from StreamPack and srtdroid so core's tests
 * run them: whether the endpoint is open, how the socket held ended, and the one drop an attempt reports
 * from the socket's end (R3). Imports nothing Android.
 */
class SrtConnection(private val signals: AttemptSignals, private val report: (Input) -> Unit) {
  private val open = MutableStateFlow(false)

  /** The sink's `isOpenFlow`. */
  val isOpen: StateFlow<Boolean> = open.asStateFlow()

  /** How the socket held ended, once it has: a write after it fails with it. Null while it lives, and after an end with no cause. */
  @Volatile
  var ended: Throwable? = null
    private set

  /**
   * Connects [socket] for [attemptId], and only then listens for its end (C6 I-2). srtdroid's failed
   * connect ends the socket before it rethrows ([SrtSocketPort.connect]): a listener already there would
   * report that failure as the attempt's drop, the signals would then refuse the connect failure that
   * names it, and a refused ingest, which asks for the code again (ruling 15), would read as a cut.
   *
   * [held] runs once it has connected (MAXBW, and the sink holding it); one that throws fails the connect,
   * with no listener yet. The endpoint shows open before the listening: a socket that ended in between
   * still reports its drop, since an ended socket runs a new listener at once, and shows closed after it.
   */
  suspend fun connect(socket: SrtSocketPort, attemptId: Int, address: InetSocketAddress, held: () -> Unit) {
    ended = null
    socket.connect(address)
    held()
    open.value = true
    socket.onEnd { cause -> end(attemptId, cause) }
  }

  /** The sink closed the socket it held. */
  fun closed() {
    open.value = false
  }

  private fun end(attemptId: Int, cause: Throwable?) {
    ended = cause
    open.value = false
    signals.dropped(attemptId, cause)?.let(report)
  }
}
