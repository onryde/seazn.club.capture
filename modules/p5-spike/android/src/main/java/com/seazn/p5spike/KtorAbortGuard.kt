package com.seazn.p5spike

import android.os.Looper
import android.util.Log
import java.io.IOException
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicInteger

/**
 * F-P5-12: keeps the process alive when Ktor's TLS client dies on a network cut. **A spike guard,
 * not the product fix.** It exists so the RTMPS rerun can measure what the existing reconnect does
 * once the process survives. The product engine decides the real fix (F-P5-12, "For the product
 * engine": guard this class of exception, move to a Ktor that fixes it, or give RTMPS a TLS
 * transport that raises errors to the caller).
 *
 * Why a default uncaught handler, and why it can work. On Run B's cut Ktor's `cio-tls-closer`
 * coroutine (a root `launch` in the SelectorManager's context, which has no Job and no handler)
 * threw `ClosedWriteChannelException` writing close_notify to a dead socket. kotlinx.coroutines
 * 1.10.2 then *calls* `Thread.currentThread().uncaughtExceptionHandler.uncaughtException(...)`
 * (`propagateExceptionFinalResort`); it does not rethrow. For a DefaultDispatcher worker, which sets
 * no handler of its own, that call reaches `Thread.getDefaultUncaughtExceptionHandler()`, which on
 * Android is `KillApplicationHandler`. A default handler that returns instead leaves the worker
 * thread and the process running. The session had already seen the drop (`endpoint-closed`, 63 ms
 * earlier), so nothing is lost by not dying. The run and its stack trace are F-P5-12 in
 * `docs/specs/2026-09-11-p5-android-results.md`. The two library facts this rests on, read in the
 * resolved jars: kotlinx-coroutines-core 1.10.2 `propagateExceptionFinalResort` calls the handler
 * and returns; kotlinx-coroutines-android 1.10.2 `AndroidExceptionPreHandler` acts only on SDK
 * 26-27, so on the phone's SDK 36 it does nothing and the call above is reached.
 *
 * Narrow on purpose: only an I/O failure raised from Ktor's network package, off the main thread,
 * is swallowed. An `Error`, anything our own code raised (even around a Ktor failure), anything on
 * main and anything outside Ktor's network package go to the handler that was there before,
 * unchanged.
 */
object KtorAbortGuard {
  private const val TAG = "P5KtorGuard"

  /** Frames from here are Ktor's sockets and TLS client, where F-P5-12's exception is raised. */
  private const val KTOR_NETWORK_PREFIX = "io.ktor.network."

  /** Frames from here are ours: a throwable our code raised is our bug, whatever its cause. */
  private const val OUR_PREFIX = "com.seazn."

  /**
   * Defence only, against a future Ktor where this stops extending IOException. Unreachable under
   * Ktor 3.3.3, where it is `ClosedByteChannelException : IOException`, so the type check matches
   * it first and no test can reach this name match.
   */
  private const val CLOSED_WRITE_CHANNEL = "io.ktor.utils.io.ClosedWriteChannelException"

  /** Cause chains are short; this only bounds a pathological one. Cycles are also stopped by identity. */
  private const val MAX_CAUSE_DEPTH = 16

  private val installed = AtomicBoolean(false)
  private val swallowed = AtomicInteger(0)

  /**
   * Whether [throwable], raised uncaught on the thread named [threadName], is F-P5-12's class and
   * may be swallowed. Pure: no Android call, so it is tested on the JVM.
   *
   * All must hold: not the main thread ([isMainThread], or a thread named `main`); the throwable
   * itself is not an [Error] and has no frame in our code (`com.seazn.`), so a wrapper we or the
   * coroutines machinery raised around a Ktor failure is never swallowed; the throwable or a cause is
   * an [IOException] or Ktor's `ClosedWriteChannelException`; and a stack frame of the throwable or a
   * cause is in `io.ktor.network.`.
   */
  fun shouldSwallow(throwable: Throwable, threadName: String, isMainThread: Boolean): Boolean {
    if (isMainThread || threadName == "main") return false
    if (throwable is Error || throwable.stackTrace.any { it.className.startsWith(OUR_PREFIX) }) return false
    val chain = causeChain(throwable)
    return chain.any(::isIoFailure) && ktorNetworkFrame(chain) != null
  }

  /**
   * Wraps the process's default uncaught handler, once: a second call does nothing, so a JS reload
   * that recreates the module installs nothing twice. [onSwallow] receives the thread, the throwable
   * and how many were swallowed in this process; it must not throw, and is guarded in case it does.
   */
  fun install(onSwallow: (thread: Thread, throwable: Throwable, count: Int) -> Unit) {
    if (!installed.compareAndSet(false, true)) return
    val previous = Thread.getDefaultUncaughtExceptionHandler()
    Thread.setDefaultUncaughtExceptionHandler { thread, throwable ->
      if (swallows(thread, throwable)) {
        record(thread, throwable, onSwallow)
      } else {
        delegate(previous, thread, throwable)
      }
    }
  }

  /** A failure deciding is a no: when in doubt, the previous handler decides, as before this guard. */
  private fun swallows(thread: Thread, throwable: Throwable): Boolean = runCatching {
    shouldSwallow(throwable, thread.name, thread === Looper.getMainLooper()?.thread)
  }.getOrDefault(false)

  /** Nothing in an uncaught handler may throw: each step is on its own. */
  private fun record(
    thread: Thread,
    throwable: Throwable,
    onSwallow: (Thread, Throwable, Int) -> Unit,
  ) {
    val count = swallowed.incrementAndGet()
    runCatching {
      val frame = ktorNetworkFrame(causeChain(throwable))
      val cause = throwable.cause?.javaClass?.name ?: "none"
      val line = "F-P5-12 swallowed #$count on ${thread.name}: ${throwable.javaClass.name}: ${throwable.message}" +
        " cause=$cause frame=$frame"
      Log.w(TAG, oneLine(line))
    }
    runCatching { onSwallow(thread, throwable, count) }
  }

  /**
   * Android always installs a default handler (RuntimeInit's `KillApplicationHandler`). If none was
   * there, do what `ThreadGroup.uncaughtException` does with none; calling the thread group instead
   * would come straight back here.
   */
  private fun delegate(previous: Thread.UncaughtExceptionHandler?, thread: Thread, throwable: Throwable) {
    if (previous != null) {
      previous.uncaughtException(thread, throwable)
    } else {
      System.err.print("Exception in thread \"${thread.name}\" ")
      throwable.printStackTrace()
    }
  }

  /** As the CSV row is written ([SpikeLog.row]): no comma and no line break, so the line stays one line. */
  private fun oneLine(text: String): String = text.replace(',', ';').replace('\n', ' ').replace('\r', ' ')

  private fun isIoFailure(t: Throwable): Boolean =
    t is IOException || t.javaClass.name == CLOSED_WRITE_CHANNEL

  private fun ktorNetworkFrame(chain: List<Throwable>): StackTraceElement? =
    chain.firstNotNullOfOrNull { t -> t.stackTrace.firstOrNull { it.className.startsWith(KTOR_NETWORK_PREFIX) } }

  /** The throwable and its causes, bounded, each at most once: `a -> b -> a` ends at `b`. */
  private fun causeChain(throwable: Throwable): List<Throwable> {
    val chain = ArrayList<Throwable>()
    var current: Throwable? = throwable
    while (current != null && chain.size < MAX_CAUSE_DEPTH && chain.none { it === current }) {
      chain += current
      current = current.cause
    }
    return chain
  }
}
