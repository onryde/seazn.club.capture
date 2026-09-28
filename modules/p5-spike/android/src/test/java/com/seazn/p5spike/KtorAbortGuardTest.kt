package com.seazn.p5spike

import io.ktor.utils.io.ClosedWriteChannelException
import java.io.IOException
import kotlinx.coroutines.CompletionHandlerException
import kotlinx.coroutines.InternalCoroutinesApi
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/** F-P5-12's spike guard: which uncaught throwables it may swallow. The wiring is not tested here. */
class KtorAbortGuardTest {
  private val worker = "DefaultDispatcher-worker-3"

  /**
   * Run B's frames, verbatim from the logcat in F-P5-12 (`.p5/p5-runb-20260928T211315Z.logcat.txt`),
   * abridged: the top seven as logged, then two of the scheduler's. The top frames are ktor-io's, not
   * Ktor's network package.
   */
  private val closerFrames = arrayOf(
    frame("io.ktor.utils.io.ByteChannel\$writeBuffer\$1", "invoke", "ByteChannel.kt", 54),
    frame("io.ktor.utils.io.CloseToken", "wrapCause", "CloseToken.kt", 21),
    frame("io.ktor.utils.io.CloseToken", "throwOrNull", "CloseToken.kt", 26),
    frame("io.ktor.utils.io.ByteChannel", "getWriteBuffer", "ByteChannel.kt", 54),
    frame("io.ktor.utils.io.ByteWriteChannelOperationsKt", "writeByte", "ByteWriteChannelOperations.kt", 19),
    frame("io.ktor.network.tls.RenderKt", "writeRecord", "Render.kt", 18),
    frame("io.ktor.network.tls.TLSClientHandshake\$output\$2\$1\$1", "invokeSuspend", "TLSClientHandshake.kt", 132),
    frame("kotlinx.coroutines.DispatchedTask", "run", "DispatchedTask.kt", 100),
    frame("kotlinx.coroutines.scheduling.CoroutineScheduler", "runSafely", "CoroutineScheduler.kt", 586),
  )
  private val abortFrames = arrayOf(
    frame("sun.nio.ch.FileDispatcherImpl", "write0", null, -2),
    frame("sun.nio.ch.SocketChannelImpl", "write", "SocketChannelImpl.java", 512),
    frame("io.ktor.network.sockets.CIOWriterKt\$attachForWritingDirectImpl\$1", "invokeSuspend", "CIOWriter.kt", 77),
  )

  /**
   * Frames next to Ktor's network package but not in it. None is ours, so a case using them is
   * judged on the network-frame rule, not refused as our own code.
   */
  private val notNetworkFrames = arrayOf(
    frame("io.ktor.utils.io.ByteChannel", "getWriteBuffer", "ByteChannel.kt", 54),
    frame("sun.nio.ch.SocketChannelImpl", "write", "SocketChannelImpl.java", 512),
    frame("kotlinx.coroutines.DispatchedTask", "run", "DispatchedTask.kt", 100),
  )

  /** Our own code raising: what `SpikeSession`'s loop would look like wrapping a Ktor failure. */
  private val ourFrames = arrayOf(
    frame("com.seazn.p5spike.SpikeSession", "publishLoop", "SpikeSession.kt", 292),
    frame("kotlinx.coroutines.DispatchedTask", "run", "DispatchedTask.kt", 100),
  )

  private fun frame(cls: String, method: String, file: String?, line: Int) = StackTraceElement(cls, method, file, line)

  private fun runB(): Throwable {
    val abort = IOException("Software caused connection abort").apply { stackTrace = abortFrames }
    return ClosedWriteChannelException(abort).apply { stackTrace = closerFrames }
  }

  @Test
  fun `Run B's exception on a worker thread is swallowed`() {
    assertTrue(KtorAbortGuard.shouldSwallow(runB(), worker, isMainThread = false))
  }

  @Test
  fun `Run B's exception on the main thread is not swallowed`() {
    assertFalse(KtorAbortGuard.shouldSwallow(runB(), "main", isMainThread = true))
  }

  /** Production reads the main thread from the Looper, not the name: the flag alone must refuse. */
  @Test
  fun `Run B's exception on the main thread under another name is not swallowed`() {
    assertFalse(KtorAbortGuard.shouldSwallow(runB(), "worker-1", isMainThread = true))
  }

  /** e.g. kotlinx's CoroutinesInternalError, which carries the failure it was handling as its cause. */
  @Test
  fun `an Error caused by Run B's exception is not swallowed`() {
    val fatal = Error("Fatal exception in coroutines machinery", runB()).apply {
      stackTrace = arrayOf(frame("kotlinx.coroutines.DispatchedTask", "handleFatalException", "DispatchedTask.kt", 144))
    }

    assertFalse(KtorAbortGuard.shouldSwallow(fatal, worker, isMainThread = false))
  }

  /**
   * The rule reads the whole cause chain, not only the top: kotlinx wraps a failure thrown from an
   * `invokeOnCompletion` handler (`JobSupport.kt:313`) and reports the wrapper, which is neither an
   * Error nor ours.
   */
  @OptIn(InternalCoroutinesApi::class)
  @Test
  fun `kotlinx's wrapper around Run B's exception is swallowed`() {
    val wrapper = CompletionHandlerException("Exception in completion handler", runB()).apply {
      stackTrace = arrayOf(frame("kotlinx.coroutines.JobSupport", "notifyCompletion", "JobSupport.kt", 313))
    }

    assertTrue(KtorAbortGuard.shouldSwallow(wrapper, worker, isMainThread = false))
  }

  @Test
  fun `our own exception caused by Run B's exception is not swallowed`() {
    val ours = IllegalStateException("publish failed", runB()).apply { stackTrace = ourFrames }

    assertFalse(KtorAbortGuard.shouldSwallow(ours, worker, isMainThread = false))
  }

  @Test
  fun `an IOException with no Ktor network frame is not swallowed`() {
    val ours = IOException("Software caused connection abort").apply { stackTrace = notNetworkFrames }

    assertFalse(KtorAbortGuard.shouldSwallow(ours, worker, isMainThread = false))
  }

  @Test
  fun `a bug raised with Ktor frames is not swallowed`() {
    val bug = IllegalStateException("not an I/O failure").apply { stackTrace = closerFrames }

    assertFalse(KtorAbortGuard.shouldSwallow(bug, worker, isMainThread = false))
  }

  /** `a -> b -> a` is legal (only a self-cause is refused), and must not loop. */
  @Test(timeout = 2_000)
  fun `a cause cycle terminates`() {
    val a = IllegalStateException("a").apply { stackTrace = closerFrames }
    val b = IllegalArgumentException("b").apply { stackTrace = notNetworkFrames }
    a.initCause(b)
    b.initCause(a)

    assertFalse(KtorAbortGuard.shouldSwallow(a, worker, isMainThread = false))

    // A Ktor-framed IOException whose cause cycles back to it is still judged, not just abandoned.
    val io = IOException("Software caused connection abort").apply { stackTrace = abortFrames }
    val c = IllegalStateException("c").apply { stackTrace = notNetworkFrames }
    io.initCause(c)
    c.initCause(io)

    assertTrue(KtorAbortGuard.shouldSwallow(io, worker, isMainThread = false))
  }
}
