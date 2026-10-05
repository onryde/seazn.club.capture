package com.seazn.capture.engine.adapter

import com.seazn.capture.engine.core.RecordEntry
import com.seazn.capture.engine.core.Shared
import kotlin.test.Test
import kotlin.test.assertEquals

/**
 * The allow-list decides every kind and key the core writes (C1). These are the lines Task 17's units
 * write, read from the units themselves, so renaming one in code without the file fails here.
 */
class RecordLinesTest {
  private val list = Shared.read("scrub/allow-list.json")

  private fun lines(): List<RecordEntry> {
    val late = TickLateness().run {
      observe(0, wakeHeld = true)
      observe(2_000, wakeHeld = true)
    }
    val gap = FrameGaps().run {
      read(1, 0, 0, publishing = true)
      read(1, 0, 1_000, publishing = true) // unmoved: F-S7-3's gap is a read that saw the count where it was
      read(1, 1, 2_000, publishing = true)
    }
    return listOfNotNull(late, gap, PreviousExit.entry(true, 10, 1L), HeldPose.NO_SENSOR)
  }

  @Test
  fun `each line's kind is in the allow-list, and each of its keys is plain or a scalar`() {
    val lines = lines()
    assertEquals(listOf("tick-late", "frames-gap", "previous-session-lost", "no-accelerometer"), lines.map { it.kind })
    val kinds = list.getJSONObject("kinds").keySet()
    val plain = list.getJSONArray("plain").let { a -> (0 until a.length()).map { a.getString(it) }.toSet() }
    val scalars = list.getJSONObject("scalars").keySet()
    val undecided =
      lines.flatMap { line ->
        listOfNotNull(line.kind.takeUnless { it in kinds }?.let { "kind $it" }) +
          line.fields.map { it.first }.filterNot { it in plain || it in scalars }.map { "${line.kind}.$it" }
      }
    assertEquals(emptyList(), undecided)
  }
}
