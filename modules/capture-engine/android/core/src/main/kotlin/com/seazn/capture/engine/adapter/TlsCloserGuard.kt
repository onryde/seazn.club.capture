package com.seazn.capture.engine.adapter

import java.io.IOException

/**
 * F-P5-12: Ktor's TLS closer throws an IOException on its own IO thread after a cut, and Android kills
 * the process for an uncaught exception on any thread. P5 recorded it as Ktor 3.3.3's
 * `ClosedWriteChannelException` (an IOException) at `io.ktor.network.tls.RenderKt.writeRecord`, caused by
 * "Software caused connection abort". Swallow exactly that: an IOException, with no Error anywhere in
 * its chain, off the main thread, with a frame in `io.ktor.network.` somewhere in its chain.
 */
object TlsCloserGuard {
  private const val MAX_CAUSES = 8
  private const val KTOR_NETWORK = "io.ktor.network."

  fun swallows(failure: Throwable, onMainThread: Boolean): Boolean {
    if (onMainThread) return false
    val chain = generateSequence(failure) { it.cause }.take(MAX_CAUSES).toList()
    if (chain.any { it is Error }) return false
    return chain.any { it is IOException } && chain.any { link -> link.stackTrace.any { it.className.startsWith(KTOR_NETWORK) } }
  }
}
