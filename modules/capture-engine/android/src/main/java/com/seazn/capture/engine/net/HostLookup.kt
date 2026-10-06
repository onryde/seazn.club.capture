package com.seazn.capture.engine.net

import java.net.InetAddress
import java.net.URI
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.async
import kotlinx.coroutines.runInterruptible

/**
 * An ingest host's address, looked up so the start's bound (`CaptureRun.START_BOUND_MS`, C6 I-1) can
 * end the wait: the glue's one DNS call, for both transports. SRT connects to the address it answers
 * (F-P5-1: an unknown host throws [java.net.UnknownHostException], which `SrtOptions.failure` reads as
 * UNRESOLVED). RTMPS looks its host up first so komuxer's own blocking lookup, inside its connect, finds
 * the platform's cache warm (C6 re-review); a host that does not resolve fails here the same way.
 *
 * The lookup runs on IO in a job of its own, never the caller's child, and the caller awaits it
 * cancellably: a bound that ends the start returns at once, and the lookup is interrupted, or, where
 * the platform's resolver ignores an interrupt (Android's getaddrinfo), left to end on its own IO
 * thread. Never on the SRT sink's own two threads, which a lookup left running would hold. Imports
 * nothing Android, so core's tests run it.
 */
class HostLookup(private val lookup: (String) -> InetAddress = InetAddress::getByName) {
  suspend fun resolve(host: String): InetAddress {
    val looking = CoroutineScope(Dispatchers.IO).async { runInterruptible { lookup(host) } }
    try {
      return looking.await()
    } finally {
      looking.cancel() // the bound ended the wait: interrupt the lookup, which ends with it
    }
  }

  /**
   * RTMPS: looks the ingest URL's host up before komuxer's connect, whose own lookup is a blocking call no
   * cancel ends; within the start's bound, that lookup then finds the platform's cache warm. A host that does
   * not resolve throws [java.net.UnknownHostException] here (UNRESOLVED, F-P5-1), before komuxer is called.
   */
  suspend fun warm(url: String) {
    hostOf(url)?.let { host -> resolve(host) }
  }

  companion object {
    /**
     * An RTMPS ingest URL's host, or null when the URL has none to read: then nothing is looked up first,
     * and komuxer's connect fails as it would have. Never throws, so the ingest URL (a cred, T35) never
     * reaches an error message from here.
     */
    fun hostOf(url: String): String? = runCatching { URI(url).host }.getOrNull()?.takeIf { it.isNotBlank() }
  }
}
