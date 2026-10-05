package com.seazn.capture.engine.srt.connect

import java.net.InetSocketAddress

/**
 * The two calls on srtdroid's socket whose order decides what an attempt's end reports (C6 I-2), behind
 * an interface so core's tests run the sink's own sequence ([SrtConnection]) on the JVM. The sink adapts
 * srtdroid 1.10.1's `CoroutineSrtSocket` to it. Its sends are no part of the port: [SrtConnection.send]
 * takes the sink's `trySend` call.
 */
interface SrtSocketPort {
  /**
   * srtdroid 1.10.1's `suspend connect(InetSocketAddress)`, as 1.10.0's (javap). One that fails closes the socket and completes
   * its `socketContext` with the failure before it rethrows it (javap: `connect`'s handler calls
   * `SrtSocket.close`, then `complete(Throwable)`, which is `completeExceptionally`, then `athrow`).
   */
  suspend fun connect(address: InetSocketAddress)

  /** srtdroid's `socketContext.invokeOnCompletion`: [handler] runs once the socket ends, at once if it already has. */
  fun onEnd(handler: (Throwable?) -> Unit)

  /** srtdroid 1.10.1's `close()`, which completes the socket's context. */
  fun close()
}
