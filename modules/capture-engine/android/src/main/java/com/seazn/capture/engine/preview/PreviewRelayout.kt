package com.seazn.capture.engine.preview

import com.seazn.capture.engine.core.RecordEntry

/** One view of the preview's tree, as [PreviewRelayout] reads it: shown or not, its laid-out size, and whether it waits for a layout. */
data class LaidOut(val shown: Boolean, val width: Int, val height: Int, val layoutRequested: Boolean, val children: List<LaidOut> = emptyList())

/** Why the preview's tree is stale: a view waits for a layout that has not come, or a shown view has no size. */
enum class Stale(val wire: String) {
  REQUESTED("requested"),
  EMPTY("empty"),
}

/** What one check asks of the view: lay the preview out again, and write [entry] when [written]. */
data class Relayout(val stale: Stale, val written: Boolean) {
  /** The record's `preview-relaid` line, a warning: the first relayout of an episode, and null for the rest. */
  val entry: RecordEntry? get() = if (written) RecordEntry("preview-relaid", listOf("reason" to stale.wire), "warn") else null
}

/**
 * N42 (R-990P; the repro of 2026-10-26): the viewfinder inside StreamPack's PreviewView swapped its SurfaceView for a new
 * one, and the new one was never laid out. It stayed 0 x 0, so it never got a surface, and the box stayed black while the
 * camera and the broadcast ran on. React Native lays out its native views itself, with no ViewRootImpl pass that would
 * catch a layout asked for during a layout, and ExpoView's own pass re-measures only what still reads as asked. One
 * layout of the preview, forced from outside (`wm size`), brought the picture back at once, with nothing restarted.
 *
 * So the view checks its preview's tree once a second while attached, and this decides. A tree stale at one check may be
 * a layout already on its way, so it is laid out again only when stale at two checks in a row, and again at each check
 * it stays stale. The record gets one line per episode, its first relayout, so a tree that a relayout cannot fix
 * writes one line, not one a second; a healthy check ends the episode. A view that is not shown is skipped with what is
 * under it: a hidden view may have no size.
 */
class PreviewRelayout {
  private var staleBefore = false
  private var episode = false

  fun check(tree: LaidOut): Relayout? {
    val stale = staleOf(tree)
    val before = staleBefore
    staleBefore = stale != null
    if (stale == null) {
      episode = false
      return null
    }
    if (!before) return null
    val first = !episode
    episode = true
    return Relayout(stale, written = first)
  }

  private fun staleOf(tree: LaidOut): Stale? {
    val shown = shown(tree)
    return when {
      shown.any { it.layoutRequested } -> Stale.REQUESTED
      shown.any { it.width <= 0 || it.height <= 0 } -> Stale.EMPTY
      else -> null
    }
  }

  private fun shown(view: LaidOut): List<LaidOut> = if (!view.shown) emptyList() else listOf(view) + view.children.flatMap(::shown)
}
