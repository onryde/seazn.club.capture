package com.seazn.capture.engine.srt.connect

import com.seazn.capture.engine.adapter.AttemptSignals
import com.seazn.capture.engine.core.Input
import java.net.InetAddress
import java.net.InetSocketAddress
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.async
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.runInterruptible

/**
 * Our SRT sink's lookup, connect and end (Task 35, C6 I-1 and I-2), apart from StreamPack and srtdroid so
 * core's tests run them: the host's address, whether the endpoint is open, how the socket held ended, and
 * the one drop an attempt reports from the socket's end (R3). Imports nothing Android.
 */
class SrtConnection(
  private val signals: AttemptSignals,
  private val report: (Input) -> Unit,
  private val lookup: (String) -> InetAddress = InetAddress::getByName,
) {
  private val open = MutableStateFlow(false)

  /** The sink's `isOpenFlow`. */
  val isOpen: StateFlow<Boolean> = open.asStateFlow()

  /** How the socket held ended, once it has: a write after it fails with it. Null while it lives, and after an end with no cause. */
  @Volatile
  var ended: Throwable? = null
    private set

  /**
   * F-P5-1: the host's address, looked up on IO; an unknown host throws [java.net.UnknownHostException],
   * which `SrtOptions.failure` reads as UNRESOLVED. C6 I-1: the lookup is inside the start's bound
   * (`CaptureRun.START_BOUND_MS`), so the connect waits for it cancellably. It runs in a job of its own,
   * never the caller's child, so a bound that ends the connect returns at once: the lookup is interrupted,
   * or, where the platform's resolver ignores an interrupt (Android's getaddrinfo), left to end on its own
   * IO thread. Never on the sink's own two threads, which a lookup left running would hold.
   */
  suspend fun resolve(host: String): InetAddress {
    val looking = CoroutineScope(Dispatchers.IO).async { runInterruptible { lookup(host) } }
    try {
      return looking.await()
    } finally {
      looking.cancel() // the bound ended the wait: interrupt the lookup, which ends with it
    }
  }

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
