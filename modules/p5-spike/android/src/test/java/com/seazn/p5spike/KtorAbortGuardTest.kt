package com.seazn.p5spike

import io.ktor.utils.io.ClosedWriteChannelException
import java.io.IOException
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/** F-P5-12's spike guard: which uncaught throwables it may swallow. The wiring is not tested here. */
class KtorAbortGuardTest {
  private val worker = "DefaultDispatcher-worker-3"

  /** Run B's frames, from the logcat in F-P5-12, and the socket write under them. */
  private val tlsFrames = arrayOf(
    StackTraceElement("io.ktor.network.tls.RenderKt", "writeRecord", "Render.kt", 18),
    StackTraceElement("io.ktor.network.tls.TLSClientHandshake\$output\$2\$1\$1", "invokeSuspend", "TLSClientHandshake.kt", 132),
    StackTraceElement("kotlinx.coroutines.DispatchedTask", "run", "DispatchedTask.kt", 100),
  )
  private val ourFrames = arrayOf(
    StackTraceElement("com.seazn.p5spike.SpikeSession", "publishLoop", "SpikeSession.kt", 292),
    StackTraceElement("kotlinx.coroutines.DispatchedTask", "run", "DispatchedTask.kt", 100),
  )

  private fun runB(): Throwable {
    val abort = IOException("Software caused connection abort").apply { stackTrace = ourFrames }
    return ClosedWriteChannelException(abort).apply { stackTrace = tlsFrames }
  }

  @Test
  fun `Run B's exception on a worker thread is swallowed`() {
    assertTrue(KtorAbortGuard.shouldSwallow(runB(), worker, isMainThread = false))
  }

  @Test
  fun `Run B's exception on the main thread is not swallowed`() {
    assertFalse(KtorAbortGuard.shouldSwallow(runB(), "main", isMainThread = true))
  }

  @Test
  fun `an IOException with no Ktor network frame is not swallowed`() {
    val ours = IOException("Software caused connection abort").apply { stackTrace = ourFrames }

    assertFalse(KtorAbortGuard.shouldSwallow(ours, worker, isMainThread = false))
  }

  @Test
  fun `a bug raised with Ktor frames is not swallowed`() {
    val bug = IllegalStateException("not an I/O failure").apply { stackTrace = tlsFrames }

    assertFalse(KtorAbortGuard.shouldSwallow(bug, worker, isMainThread = false))
  }

  /** `a -> b -> a` is legal (only a self-cause is refused), and must not loop. */
  @Test(timeout = 2_000)
  fun `a cause cycle terminates`() {
    val a = IllegalStateException("a").apply { stackTrace = tlsFrames }
    val b = IllegalArgumentException("b").apply { stackTrace = ourFrames }
    a.initCause(b)
    b.initCause(a)

    assertFalse(KtorAbortGuard.shouldSwallow(a, worker, isMainThread = false))

    // The same cycle with Run B's failure inside it is still judged, not just abandoned.
    val io = IOException("Software caused connection abort").apply { stackTrace = tlsFrames }
    val c = IllegalStateException("c").apply { stackTrace = ourFrames }
    c.initCause(io)
    io.initCause(c)

    assertTrue(KtorAbortGuard.shouldSwallow(c, worker, isMainThread = false))
  }
}
