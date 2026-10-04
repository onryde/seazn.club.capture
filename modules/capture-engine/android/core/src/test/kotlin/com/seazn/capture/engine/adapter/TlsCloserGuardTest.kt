package com.seazn.capture.engine.adapter

import java.io.IOException
import kotlin.test.Test
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class TlsCloserGuardTest {
  private fun frame(className: String) = StackTraceElement(className, "run", "Fake.kt", 1)

  private fun ktorIo(): IOException =
    IOException("Broken pipe").apply { stackTrace = arrayOf(frame("io.ktor.network.tls.TLSClientSessionJvmKt")) }

  /** Stands in for Ktor 3.3.3's `ClosedWriteChannelException`, which extends `IOException` (javap). */
  private class ClosedWrite(cause: Throwable) : IOException(cause.message, cause)

  @Test
  fun `F-P5-12 the TLS closer's IOException off the main thread is swallowed, and nothing else is`() {
    assertTrue(TlsCloserGuard.swallows(ktorIo(), onMainThread = false))
    assertFalse(TlsCloserGuard.swallows(ktorIo(), onMainThread = true), "never on main")
    assertFalse(TlsCloserGuard.swallows(IOException("other"), false), "not Ktor's")
    val error = OutOfMemoryError().apply { stackTrace = ktorIo().stackTrace }
    assertFalse(TlsCloserGuard.swallows(error, false), "never an Error")
    val errorOverKtor = Error("closer", ktorIo()).apply { stackTrace = ktorIo().stackTrace }
    assertFalse(TlsCloserGuard.swallows(errorOverKtor, false), "never an Error, even over Ktor's IOException")
    assertTrue(TlsCloserGuard.swallows(RuntimeException(ktorIo()), false), "found in the cause chain")
  }

  @Test
  fun `the crash P5 recorded is swallowed - Ktor's frame on the wrapper, the abort beneath`() {
    // F-P5-12's logcat: ClosedWriteChannelException at io.ktor.network.tls.RenderKt.writeRecord, caused by
    // java.io.IOException "Software caused connection abort", thrown on DefaultDispatcher-worker-3.
    val abort = IOException("Software caused connection abort").apply { stackTrace = arrayOf(frame("sun.nio.ch.SocketDispatcher")) }
    val crash = ClosedWrite(abort).apply { stackTrace = arrayOf(frame("io.ktor.network.tls.RenderKt")) }
    assertTrue(TlsCloserGuard.swallows(crash, onMainThread = false))
    assertFalse(TlsCloserGuard.swallows(crash, onMainThread = true), "never on main")
  }

  @Test
  fun `an Error anywhere in the chain, a Ktor frame with no IOException, or another Ktor package is never swallowed`() {
    val oom = IOException("closer", OutOfMemoryError()).apply { stackTrace = ktorIo().stackTrace }
    assertFalse(TlsCloserGuard.swallows(oom, false), "an Error beneath Ktor's IOException")
    val state = IllegalStateException("not IO").apply { stackTrace = ktorIo().stackTrace }
    assertFalse(TlsCloserGuard.swallows(state, false), "Ktor's frame, but no IOException")
    val client = IOException("Broken pipe").apply { stackTrace = arrayOf(frame("io.ktor.client.engine.cio.Endpoint")) }
    assertFalse(TlsCloserGuard.swallows(client, false), "only io.ktor.network's closer")
    val empty = IOException("Broken pipe").apply { stackTrace = emptyArray() }
    assertFalse(TlsCloserGuard.swallows(empty, false), "no frames at all")
  }
}
