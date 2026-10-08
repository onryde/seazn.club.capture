package com.seazn.capture.engine.preview

import com.seazn.capture.engine.core.Encode

/** Where the preview's view sits in its box: its [scale] about its top-left corner, then moved [left] and [top]. */
data class PreviewPlacement(val scale: Float, val left: Float, val top: Float)

/**
 * The 16:9 camera box shows exactly what viewers get (AGENTS §6, design follow-up §1). StreamPack [STREAMPACK]'s
 * PreviewView does not size its preview stream from the encode's config but from its own view's AREA: it keeps the
 * camera output size whose width x height is nearest the view's, of any shape (javap: `CameraSizes.getPreviewOutputSize`,
 * a minimum of |w x h - view w x h|; the maintainer says the same in StreamPack#288). So a view laid out at the box takes
 * whatever size is nearest in area, in any shape. What is MEASURED: the owner's 2412 x 1080 phone showed content of
 * about 2.24:1 in the 16:9 box. What is INFERRED, until `dumpsys media.camera` and the `preview-size` record line
 * ([PreviewSizes]) confirm it: that the camera size picked was a 20:9 one, and that the camera crops each stream to its
 * own shape from the same sensor (Camera2's documented crop), which is why only a stream of the encode's shape has the
 * encode's framing.
 *
 * So CapturePreviewView lays the PreviewView out at the encode's own size, [Encode]: an area that a camera size of
 * exactly that size matches to the pixel, and the encode needs that size from the camera anyway. This scales that view
 * to fit the box: uniformly, so the picture is never stretched, and centred, so a box that is not quite 16:9 leaves
 * bars rather than crops.
 */
object PreviewFit {
  /**
   * The StreamPack whose PreviewView sizing this was read from. A bump re-reads `CameraSizes.getPreviewOutputSize` and
   * moves this; GlueRulesTest holds it to build.gradle's strict pin (as VendorLines.STREAMPACK does for its regexes).
   */
  const val STREAMPACK = "3.2.1"

  fun place(boxWidth: Int, boxHeight: Int): PreviewPlacement {
    val width = boxWidth.coerceAtLeast(0)
    val height = boxHeight.coerceAtLeast(0)
    val scale = minOf(width.toFloat() / Encode.WIDTH, height.toFloat() / Encode.HEIGHT)
    return PreviewPlacement(scale, (width - Encode.WIDTH * scale) / 2f, (height - Encode.HEIGHT * scale) / 2f)
  }
}
