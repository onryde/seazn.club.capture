package com.seazn.capture.engine.endpoints

import android.os.Looper
import com.seazn.capture.engine.adapter.TlsCloserGuard
import com.seazn.capture.engine.core.RecordEntry

/**
 * F-P5-12: Ktor's TLS closer can throw an IOException on an IO thread after a cut. SCOPED guards our
 * RTMP threads only; GLOBAL wraps the process default, the spike's fallback. Task 40's ten cuts decide.
 */
object TlsGuard {
  enum class Mode { SCOPED, GLOBAL }

  val MODE = Mode.SCOPED

  /** Where a swallowed throw is recorded. EngineHost sets it to `EngineHost::line`. */
  @Volatile var record: (RecordEntry) -> Unit = {}

  private var installed = false

  fun handler(previous: Thread.UncaughtExceptionHandler?) =
    Thread.UncaughtExceptionHandler { thread, failure ->
      if (TlsCloserGuard.swallows(failure, Looper.getMainLooper().isCurrentThread)) {
        record(RecordEntry("tls-closer-swallowed", listOf("error" to failure.javaClass.simpleName)))
      } else {
        (previous ?: Thread.getDefaultUncaughtExceptionHandler())?.uncaughtException(thread, failure)
      }
    }

  @Synchronized
  fun install(mode: Mode) {
    if (mode != Mode.GLOBAL || installed) return
    installed = true
    Thread.setDefaultUncaughtExceptionHandler(handler(Thread.getDefaultUncaughtExceptionHandler()))
  }
}
