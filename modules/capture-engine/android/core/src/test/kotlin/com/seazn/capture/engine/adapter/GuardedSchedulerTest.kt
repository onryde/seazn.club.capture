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

    fun runAll() {
      while (tasks.isNotEmpty()) tasks.removeFirst()()
    }
  }

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
}
