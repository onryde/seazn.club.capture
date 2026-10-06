package com.seazn.capture.engine.adapter

import com.seazn.capture.engine.core.Cancellable
import com.seazn.capture.engine.core.Scheduler
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

class GuardedSchedulerTest {
  /** Runs each task when told, as a Handler would, and lets a thrown Throwable escape as a Looper would. */
  private class Direct : Scheduler {
    val tasks = ArrayDeque<() -> Unit>()

    override fun schedule(delayMs: Long, task: () -> Unit): Cancellable {
      tasks.addLast(task)
      return Cancellable { tasks.remove(task) }
    }

    /** Bounded, so work posted again for ever fails the test instead of hanging the suite. */
    fun runAll() {
      var ran = 0
      while (tasks.isNotEmpty()) {
        check(++ran <= MAX_TASKS) { "tasks were posted for ever" }
        tasks.removeFirst()()
      }
    }
  }

  /** An `Error` JUnit lets fail one test. An `OutOfMemoryError` would abort the whole test executor. */
  private class ReporterCrash : Error("reporter")

  @Test
  fun `carry 15 an Error at the task boundary is reported and the thread lives on`() {
    val inner = Direct()
    val seen = mutableListOf<Throwable>()
    val guarded = GuardedScheduler(inner) { seen += it }
    var later = false
    guarded.schedule(0) { throw StackOverflowError("deep") }
    guarded.schedule(0) { later = true }
    inner.runAll()
    assertTrue(later, "the next task still ran")
    assertEquals(listOf("deep"), seen.map { it.message })
    assertEquals(1, guarded.caught)
  }

  @Test
  fun `a reporter that throws is swallowed too`() {
    val inner = Direct()
    val guarded = GuardedScheduler(inner) { throw IllegalStateException("reporter") }
    guarded.schedule(0) { throw RuntimeException("task") }
    inner.runAll()
    assertEquals(1, guarded.caught)
  }

  @Test
  fun `review 13 I2 an onFailure that throws an Error is counted, never handed back or posted again, and later tasks run`() {
    val inner = Direct()
    var reports = 0
    val guarded =
      GuardedScheduler(inner) {
        reports += 1
        throw ReporterCrash()
      }
    var later = 0
    guarded.schedule(0) { throw IllegalStateException("task") }
    guarded.schedule(0) { later += 1 }
    guarded.schedule(0) { later += 1 }
    inner.runAll()
    assertEquals(2, later, "the tasks after it still ran")
    assertEquals(1, reports, "the reporter's own throw never came back to it")
    assertTrue(inner.tasks.isEmpty(), "nothing was posted again")
    assertEquals(1, guarded.caught)
    assertEquals(1, guarded.reporterFailures)
  }

  @Test
  fun `review 13 I3 caught counts every task that threw, Error or Exception, and no task that ran clean`() {
    val inner = Direct()
    val guarded = GuardedScheduler(inner) {}
    var clean = false
    guarded.schedule(0) { throw IllegalStateException("one") }
    guarded.schedule(0) { clean = true }
    guarded.schedule(0) { throw StackOverflowError("two") }
    guarded.schedule(0) { throw PermanentPlatformFailure("three") }
    inner.runAll()
    assertTrue(clean)
    assertEquals(3, guarded.caught)
    assertEquals(0, guarded.reporterFailures, "a reporter that returns is no reporter failure")
  }

  private companion object {
    const val MAX_TASKS = 1_000
  }
}
