package com.seazn.capture.engine.preview

import com.seazn.capture.engine.core.Encode
import com.seazn.capture.engine.core.RecordEntry
import kotlin.math.abs

/**
 * What the camera lists for the preview and what StreamPack's rule would pick from it, for a view of the encode's size.
 * [pickWidth] and [pickHeight] are 0 when nothing is listed (StreamPack's own `closestTo` throws on an empty list).
 */
data class PreviewSizeReport(
  val listed: Int,
  val encodeListed: Boolean,
  val sameArea: Int,
  val pickWidth: Int,
  val pickHeight: Int,
)

/**
 * The phone's own word on the preview (preview-fill review I-1). StreamPack's logger is replaced (nothing below WARN
 * reaches the record), so the size its PreviewView takes is never seen; this is the one `preview-size` line that says
 * what the rule would pick, from the sizes the camera lists for a SurfaceHolder. Evidence only: nothing acts on it.
 *
 * The rule, read from StreamPack [PreviewFit.STREAMPACK] by javap (`CameraSizes.getPreviewOutputSize`, then
 * `SizeExtensionsKt.closestTo`): the listed sizes sorted by height x width ascending (a stable sort), reversed, and the
 * FIRST of that order whose |w x h - the view's w x h| is least (a later size replaces it only when strictly nearer).
 * The view's size is the encode's, [Encode], which is what CapturePreviewView lays the PreviewView out at. Int arithmetic,
 * as StreamPack's.
 */
object PreviewSizes {
  fun report(sizes: List<Pair<Int, Int>>): PreviewSizeReport {
    val target = Encode.WIDTH * Encode.HEIGHT
    var pick: Pair<Int, Int>? = null
    var least = 0
    for (size in sizes.sortedBy { it.first * it.second }.reversed()) {
      val apart = abs(size.first * size.second - target)
      if (pick == null || least > apart) {
        pick = size
        least = apart
      }
    }
    val encode = Encode.WIDTH to Encode.HEIGHT
    return PreviewSizeReport(
      listed = sizes.size,
      encodeListed = encode in sizes,
      sameArea = sizes.count { it != encode && it.first * it.second == target },
      pickWidth = pick?.first ?: 0,
      pickHeight = pick?.second ?: 0,
    )
  }

  /** The record line: numbers and one boolean only, so the scrub keeps all of it (allow-list `scalars`). */
  fun entry(report: PreviewSizeReport): RecordEntry =
    RecordEntry(
      "preview-size",
      listOf(
        "listed" to report.listed,
        "encodeListed" to report.encodeListed,
        "sameArea" to report.sameArea,
        "pickWidth" to report.pickWidth,
        "pickHeight" to report.pickHeight,
      ),
    )
}
