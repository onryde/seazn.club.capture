package com.seazn.capture.engine.preview

import com.seazn.capture.engine.core.Encode
import kotlin.math.abs
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/**
 * The 16:9 camera box shows exactly what viewers get (AGENTS §6, design follow-up §1). StreamPack 3.2.1's PreviewView
 * takes its preview stream's size from its own view's AREA (javap: `CameraSizes.getPreviewOutputSize` keeps the camera
 * output size whose width x height is nearest the view's, whatever its shape), so the view is laid out at the
 * encode's own size and [PreviewFit] scales it into the box. These tests hold the placement; GlueRulesTest holds
 * that the view is laid out at the encode's size and applies this placement.
 */
class PreviewFitTest {
  /** CD27: "The encode is 720p30". ffprobe on the stream reads width 1280 and height 720 (plan C, P4). */
  @Test
  fun `the encode is 1280 x 720, and that is 16 x 9`() {
    assertEquals(1280, Encode.WIDTH)
    assertEquals(720, Encode.HEIGHT)
    assertEquals(16 * Encode.HEIGHT, 9 * Encode.WIDTH, "spec §1: the box is 16:9, and so is what viewers get")
  }

  /** Written out by hand from the rule (scale to fit, centred), never computed by [PreviewFit]. */
  private class Row(val boxWidth: Int, val boxHeight: Int, val scale: Float, val left: Float, val top: Float)

  private val rows =
    listOf(
      Row(1280, 720, 1f, 0f, 0f), // the encode's own size: the view is not scaled
      Row(640, 360, 0.5f, 0f, 0f),
      Row(2560, 1440, 2f, 0f, 0f),
      Row(16, 9, 0.0125f, 0f, 0f),
      Row(1500, 844, 1.171875f, 0f, 0.125f), // 1500 / 1280; 844 - 720 x 1.171875 = 0.125 over two
      Row(2000, 720, 1f, 360f, 0f), // wider than 16:9: fits the height, centred across
      Row(600, 720, 0.46875f, 0f, 191.25f), // taller than 16:9: fits the width, centred down
    )

  @Test
  fun `the preview is placed to fit its box, centred, whatever the box`() {
    assertTrue(rows.size >= 7, "the table is not empty")
    for (row in rows) {
      val placed = PreviewFit.place(row.boxWidth, row.boxHeight)
      val name = "${row.boxWidth} x ${row.boxHeight}"
      assertEquals(row.scale, placed.scale, 1e-6f, "$name scale")
      assertEquals(row.left, placed.left, 1e-4f, "$name left")
      assertEquals(row.top, placed.top, 1e-4f, "$name top")
    }
  }

  /**
   * The rule, swept over boxes of every shape: nothing is cropped (the placed picture is inside the box), nothing is
   * left over on both axes (it touches the box on at least one), the picture keeps its 16:9, and it is centred. The
   * expected values come from 16 and 9, never from the placement under test.
   */
  @Test
  fun `a placed preview is inside its box, as large as fits, 16 x 9 and centred, for boxes of every shape`() {
    var checked = 0
    for (boxWidth in 1..3000 step 37) {
      for (boxHeight in 1..2000 step 41) {
        val placed = PreviewFit.place(boxWidth, boxHeight)
        val width = Encode.WIDTH * placed.scale.toDouble()
        val height = Encode.HEIGHT * placed.scale.toDouble()
        val name = "$boxWidth x $boxHeight"
        val ok =
          width <= boxWidth + 1e-3 &&
            height <= boxHeight + 1e-3 &&
            (abs(width - boxWidth) < 1e-3 || abs(height - boxHeight) < 1e-3) &&
            abs(width * 9 - height * 16) < 1e-3 &&
            abs(placed.left - (boxWidth - width) / 2) < 1e-2 &&
            abs(placed.top - (boxHeight - height) / 2) < 1e-2
        assertTrue(ok, "$name: scale ${placed.scale} left ${placed.left} top ${placed.top} for a ${width} x ${height} picture")
        checked++
      }
    }
    assertEquals(82 * 49, checked, "every box of the grid was checked (a sweep that checks nothing proves nothing)")
  }

  /**
   * A box with no room (Yoga's first pass) shows nothing: a finite zero scale, never NaN or infinity. A negative size
   * cannot come from a view, and is refused the same way rather than mirroring the picture.
   */
  @Test
  fun `a box with no room places a zero scale, finite`() {
    val boxes = listOf(0 to 0, 0 to 720, 1280 to 0, -1 to 720, 1280 to -1)
    for ((boxWidth, boxHeight) in boxes) {
      val placed = PreviewFit.place(boxWidth, boxHeight)
      assertEquals(0f, placed.scale, "$boxWidth x $boxHeight")
      assertTrue(placed.left.isFinite() && placed.top.isFinite(), "$boxWidth x $boxHeight: ${placed.left}, ${placed.top}")
    }
    assertEquals(5, boxes.size)
  }

  /** The box changes under a held preview (a rotation, a re-flow): each placement stands on its own box alone. */
  @Test
  fun `a placement depends on its box only, not on the boxes before it`() {
    val first = rows.map { PreviewFit.place(it.boxWidth, it.boxHeight) }
    val reversed = rows.reversed().map { PreviewFit.place(it.boxWidth, it.boxHeight) }.reversed()
    assertEquals(first, reversed)
    assertEquals(first, rows.map { PreviewFit.place(it.boxWidth, it.boxHeight) }, "and again")
  }
}
