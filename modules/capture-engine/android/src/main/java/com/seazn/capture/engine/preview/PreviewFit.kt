package com.seazn.capture.engine.preview

import com.seazn.capture.engine.core.Encode

/** Where the preview's view sits in its box: its [scale] about its top-left corner, then moved [left] and [top]. */
data class PreviewPlacement(val scale: Float, val left: Float, val top: Float)

/**
 * The 16:9 camera box shows exactly what viewers get (AGENTS §6, design follow-up §1). StreamPack 3.2.1's PreviewView
 * does not size its preview stream from the encode's config but from its own view's AREA: it keeps the camera output
 * size whose width x height is nearest the view's, of any shape (javap: `CameraSizes.getPreviewOutputSize`, a minimum of
 * |w x h - view w x h|), so a view laid out at the box took a 20:9 size on a 2412 x 1080 phone, letterboxed in the box
 * and framed differently from the encode (StreamPack#288). The camera crops each stream to its own shape from the
 * same sensor, so only a stream of the encode's shape has the encode's framing.
 *
 * So CapturePreviewView lays the PreviewView out at the encode's own size, [Encode]: an area that a camera size of
 * exactly that size matches to the pixel, and the encode needs that size from the camera anyway. This scales that view
 * to fit the box: uniformly, so the picture is never stretched, and centred, so a box that is not quite 16:9 leaves
 * bars rather than crops.
 */
object PreviewFit {
  fun place(boxWidth: Int, boxHeight: Int): PreviewPlacement {
    val width = boxWidth.coerceAtLeast(0)
    val height = boxHeight.coerceAtLeast(0)
    val scale = minOf(width.toFloat() / Encode.WIDTH, height.toFloat() / Encode.HEIGHT)
    return PreviewPlacement(scale, (width - Encode.WIDTH * scale) / 2f, (height - Encode.HEIGHT * scale) / 2f)
  }
}
