package com.seazn.capture.engine.core

/** A clock that moves only when a test moves it. Wall time starts on a fixed, readable instant. */
class FakeClock(var mono: Long = 0, var wall: Long = 1_790_000_000_000) : Clock {
  override fun monotonicMs(): Long = mono

  override fun wallMs(): Long = wall

  fun advance(ms: Long) {
    mono += ms
    wall += ms
  }
}

/** Runs scheduled work when the test advances time, each task at its own due time, in due order. */
class FakeScheduler(private val clock: FakeClock) : Scheduler {
  private class Job(val dueAt: Long, val order: Long, val task: () -> Unit) {
    var cancelled = false
  }

  private val jobs = mutableListOf<Job>()
  private var order = 0L

  val pending: Int
    get() = jobs.count { !it.cancelled }

  override fun schedule(delayMs: Long, task: () -> Unit): Cancellable {
    val job = Job(clock.mono + delayMs.coerceAtLeast(0), order++, task)
    jobs += job
    return Cancellable { job.cancelled = true }
  }

  fun advanceBy(ms: Long) {
    val end = clock.mono + ms
    while (true) {
      val next =
        jobs
          .filter { !it.cancelled && it.dueAt <= end }
          .minWithOrNull(compareBy<Job>({ it.dueAt }, { it.order })) ?: break
      jobs.remove(next)
      clock.advance(next.dueAt - clock.mono)
      next.task()
    }
    clock.advance(end - clock.mono)
    jobs.removeAll { it.cancelled }
  }
}
