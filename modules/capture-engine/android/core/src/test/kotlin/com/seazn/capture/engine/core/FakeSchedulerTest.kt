package com.seazn.capture.engine.core

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith

class FakeSchedulerTest {
  private val clock = FakeClock()
  private val scheduler = FakeScheduler(clock)

  @Test
  fun `tasks run at their own due time, in due order`() {
    val seen = mutableListOf<Pair<String, Long>>()
    scheduler.schedule(300) { seen += "b" to clock.mono }
    scheduler.schedule(100) { seen += "a" to clock.mono }
    // Due with "a", scheduled after it: a tie runs first-scheduled first, as Engine.send's schedule(0) inputs need.
    scheduler.schedule(100) { seen += "a2" to clock.mono }
    scheduler.advanceBy(1_000)
    assertEquals(listOf("a" to 100L, "a2" to 100L, "b" to 300L), seen)
    assertEquals(1_000L, clock.mono)
  }

  @Test
  fun `a cancelled task never runs`() {
    var ran = false
    scheduler.schedule(10) { ran = true }.cancel()
    scheduler.advanceBy(100)
    assertEquals(false, ran)
    assertEquals(0, scheduler.pending)
  }

  @Test
  fun `a task scheduled by a task runs within the same advance when it falls due`() {
    val seen = mutableListOf<Long>()
    scheduler.schedule(100) { scheduler.schedule(100) { seen += clock.mono } }
    scheduler.advanceBy(250)
    assertEquals(listOf(200L), seen)
  }

  @Test
  fun `a task due after the advance waits for the advance that reaches it`() {
    val seen = mutableListOf<Long>()
    scheduler.schedule(1_000) { seen += clock.mono }
    scheduler.advanceBy(999)
    assertEquals(emptyList<Long>(), seen)
    assertEquals(1, scheduler.pending)
    scheduler.advanceBy(1)
    assertEquals(listOf(1_000L), seen)
  }

  @Test
  fun `wall time moves with monotonic time`() {
    val wallBefore = clock.wallMs()
    scheduler.advanceBy(1_500)
    assertEquals(wallBefore + 1_500, clock.wallMs())
    assertEquals(Now(1_500, wallBefore + 1_500), clock.now())
  }

  @Test
  fun `the clock refuses to run backwards`() {
    val error = assertFailsWith<IllegalArgumentException> { clock.advance(-1) }
    assertEquals("advance(-1): time never runs backwards", error.message)
    assertEquals(0L, clock.mono)
  }

  // The message names the guard: without its own, advanceBy would still throw, from the clock's.
  @Test
  fun `the scheduler refuses to run time backwards`() {
    val error = assertFailsWith<IllegalArgumentException> { scheduler.advanceBy(-1) }
    assertEquals("advanceBy(-1): time never runs backwards", error.message)
    assertEquals(0L, clock.mono)
  }

  // The guard's boundary: zero is legal, and runs what is already due, as Engine.send's schedule(0) inputs need.
  @Test
  fun `advancing by zero runs work already due and leaves the clock where it was`() {
    var ran = false
    scheduler.schedule(0) { ran = true }
    scheduler.advanceBy(0)
    assertEquals(true, ran)
    assertEquals(0L, clock.mono)
  }
}
