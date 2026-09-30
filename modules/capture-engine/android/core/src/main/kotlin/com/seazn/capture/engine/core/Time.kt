package com.seazn.capture.engine.core

/** Time, injected (spec §3). Nothing in the core reads a system clock, so every rule runs on a fake. */
interface Clock {
  /** Milliseconds that only ever go forward. Every interval the core measures uses this. */
  fun monotonicMs(): Long

  /** Epoch milliseconds, only for what a person or the server reads: record lines and the heartbeat's `at`. */
  fun wallMs(): Long
}

/** The two readings of one instant, taken once per input so a step never sees time move under it. */
data class Now(val monoMs: Long, val wallMs: Long)

fun Clock.now(): Now = Now(monotonicMs(), wallMs())

fun interface Cancellable {
  fun cancel()
}

/** Deferred work, injected. Plan C backs it with one serial thread, which is what serialises the engine. */
interface Scheduler {
  fun schedule(delayMs: Long, task: () -> Unit): Cancellable
}
