package com.seazn.capture.engine.preview

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

/**
 * N42: the preview's tree as the device showed it. PreviewView and the CameraViewfinder at the encode's 1280 x 720, and
 * the SurfaceView under them either laid out with them or left at 0 x 0 after the viewfinder swapped it (the hierarchy
 * dump of 2026-10-26, 23:25 on the NE2211).
 */
class PreviewRelayoutTest {
  private fun surface(width: Int = 1280, height: Int = 720, requested: Boolean = false, shown: Boolean = true) =
    LaidOut(shown, width, height, requested)

  private fun tree(surface: LaidOut, viewfinderRequested: Boolean = false) =
    LaidOut(true, 1280, 720, false, listOf(LaidOut(true, 1280, 720, viewfinderRequested, listOf(surface))))

  private val healthy = tree(surface())
  private val lost = tree(surface(width = 0, height = 0))

  @Test
  fun `a healthy tree is left alone`() {
    val rule = PreviewRelayout()
    repeat(3) { assertNull(rule.check(healthy)) }
  }

  @Test
  fun `the surface left at 0 x 0 is laid out at the second stale check, and the line is written then`() {
    val rule = PreviewRelayout()
    assertNull(rule.check(lost), "one stale check may be a layout already on its way")
    assertEquals(Relayout(Stale.EMPTY, written = true), rule.check(lost))
  }

  @Test
  fun `a tree that stays stale is laid out at every check, with one line for the episode`() {
    val rule = PreviewRelayout()
    rule.check(lost)
    rule.check(lost)
    assertEquals(Relayout(Stale.EMPTY, written = false), rule.check(lost))
    assertEquals(Relayout(Stale.EMPTY, written = false), rule.check(lost))
  }

  @Test
  fun `a healthy check ends the episode, and the next one waits two checks and writes again`() {
    val rule = PreviewRelayout()
    rule.check(lost)
    rule.check(lost)
    assertNull(rule.check(healthy))
    assertNull(rule.check(lost))
    assertEquals(Relayout(Stale.EMPTY, written = true), rule.check(lost))
  }

  @Test
  fun `stale checks apart are never confirmed`() {
    val rule = PreviewRelayout()
    repeat(3) {
      assertNull(rule.check(lost))
      assertNull(rule.check(healthy))
    }
  }

  @Test
  fun `a layout asked for and never given is stale, at any depth, and named before an empty view`() {
    val rule = PreviewRelayout()
    val waiting = tree(surface(width = 0, height = 0, requested = true))
    rule.check(waiting)
    assertEquals(Relayout(Stale.REQUESTED, written = true), rule.check(waiting))
    val viewfinderWaiting = tree(surface(), viewfinderRequested = true)
    val other = PreviewRelayout()
    other.check(viewfinderWaiting)
    assertEquals(Stale.REQUESTED, other.check(viewfinderWaiting)?.stale)
  }

  @Test
  fun `the preview itself unlaid is stale`() {
    val rule = PreviewRelayout()
    val unlaid = LaidOut(true, 0, 0, false)
    rule.check(unlaid)
    assertEquals(Stale.EMPTY, rule.check(unlaid)?.stale)
  }

  @Test
  fun `a view not shown is skipped with what is under it`() {
    val rule = PreviewRelayout()
    val hidden = tree(surface(width = 0, height = 0, requested = true, shown = false))
    repeat(3) { assertNull(rule.check(hidden)) }
    val hiddenViewfinder = LaidOut(true, 1280, 720, false, listOf(LaidOut(false, 0, 0, true, listOf(surface(0, 0)))))
    repeat(3) { assertNull(rule.check(hiddenViewfinder)) }
  }

  @Test
  fun `an empty height alone is stale, as an empty width is`() {
    val rule = PreviewRelayout()
    val flat = tree(surface(width = 1280, height = 0))
    rule.check(flat)
    assertEquals(Stale.EMPTY, rule.check(flat)?.stale)
    val narrow = tree(surface(width = 0, height = 720))
    val other = PreviewRelayout()
    other.check(narrow)
    assertEquals(Stale.EMPTY, other.check(narrow)?.stale)
  }

  @Test
  fun `the wire words are the record's`() {
    assertEquals(listOf("requested", "empty"), Stale.entries.map { it.wire })
  }
}
