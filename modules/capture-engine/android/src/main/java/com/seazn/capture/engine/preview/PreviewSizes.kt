package com.seazn.capture.engine.preview

import com.seazn.capture.engine.core.Encode
import com.seazn.capture.engine.core.RecordEntry
import kotlin.math.abs

/**
 * What the camera lists for the preview and the size the preview gets from it. [pickWidth] and [pickHeight] are 0 when
 * nothing is listed (StreamPack's own `closestTo` throws on an empty list).
 */
data class PreviewSizeReport(
  val listed: Int,
  val encodeListed: Boolean,
  val sameArea: Int,
  /** The size the preview gets: ours when the rule is wired and a 16:9 size is listed, else StreamPack's. */
  val pickWidth: Int,
  val pickHeight: Int,
  /** N30: whether that size has the encode's aspect, 16:9. False when nothing is listed. */
  val pickAspect16x9: Boolean,
  /** `ours` (the 16:9 rule) or `vendor` (StreamPack's area rule: unwired, or no 16:9 size listed). */
  val pickSource: String,
)

/**
 * The phone's own word on the preview (preview-fill review I-1), and its size (N30, D3 findings design §4). StreamPack's
 * logger is replaced (nothing below WARN reaches the record), so the size its PreviewView takes is never seen; the one
 * `preview-size` line says it, from the sizes the camera lists for a SurfaceHolder.
 *
 * StreamPack 3.2.1's rule, [vendorPick], read by javap from [PreviewFit.STREAMPACK] (`CameraSizes.getPreviewOutputSize`,
 * then `SizeExtensionsKt.closestTo`): the listed sizes sorted by height x width ascending (a stable sort), reversed, and
 * the FIRST of that order whose |w x h - the view's w x h| is least (a later size replaces it only when strictly nearer).
 * The view's size is the encode's, [Encode], which is what CapturePreviewView lays the PreviewView out at. Int
 * arithmetic, as StreamPack's. Area alone, so a 960 x 960 square ties 1280 x 720 and can win (N30).
 *
 * Ours, [pick16x9]: the encode's aspect first. Among the listed 16:9 sizes, the one whose area is nearest 1280 x 720's,
 * the first listed on a tie. With none listed, StreamPack's pick stands.
 */
object PreviewSizes {
  private val TARGET = Encode.WIDTH * Encode.HEIGHT

  fun vendorPick(sizes: List<Pair<Int, Int>>): Pair<Int, Int>? {
    var pick: Pair<Int, Int>? = null
    var least = 0
    for (size in sizes.sortedBy { it.first * it.second }.reversed()) {
      val apart = abs(size.first * size.second - TARGET)
      if (pick == null || least > apart) {
        pick = size
        least = apart
      }
    }
    return pick
  }

  fun pick16x9(sizes: List<Pair<Int, Int>>): Pair<Int, Int>? =
    sizes.filter { it.first * 9 == it.second * 16 }.minByOrNull { abs(it.first * it.second - TARGET) }

  /**
   * The line for [sizes]. [wired] says whether the preview is shown the camera through the 16:9 rule (preflight M2):
   * until it is, the preview gets StreamPack's pick, and the line says so.
   */
  fun report(sizes: List<Pair<Int, Int>>, wired: Boolean): PreviewSizeReport {
    val ours = if (wired) pick16x9(sizes) else null
    val pick = ours ?: vendorPick(sizes)
    val encode = Encode.WIDTH to Encode.HEIGHT
    return PreviewSizeReport(
      listed = sizes.size,
      encodeListed = encode in sizes,
      sameArea = sizes.count { it != encode && it.first * it.second == TARGET },
      pickWidth = pick?.first ?: 0,
      pickHeight = pick?.second ?: 0,
      pickAspect16x9 = pick != null && pick.first * 9 == pick.second * 16,
      pickSource = if (ours != null) "ours" else "vendor",
    )
  }

  /** The record line: numbers, two booleans and one plain word, all on the allow-list. */
  fun entry(report: PreviewSizeReport): RecordEntry =
    RecordEntry(
      "preview-size",
      listOf(
        "listed" to report.listed,
        "encodeListed" to report.encodeListed,
        "sameArea" to report.sameArea,
        "pickWidth" to report.pickWidth,
        "pickHeight" to report.pickHeight,
        "pickAspect16x9" to report.pickAspect16x9,
        "pickSource" to report.pickSource,
      ),
    )
}
