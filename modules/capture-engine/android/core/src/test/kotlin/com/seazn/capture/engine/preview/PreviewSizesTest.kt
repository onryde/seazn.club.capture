package com.seazn.capture.engine.preview

import com.seazn.capture.engine.core.RecordEntry
import com.seazn.capture.engine.core.SessionRecord
import com.seazn.capture.engine.core.Shared
import org.json.JSONObject
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/**
 * The phone's own word on the preview (preview-fill review I-1). StreamPack's logger is replaced, so which camera size its
 * PreviewView takes is never seen; this is the one `preview-size` line that says what the rule would pick for a view of
 * the encode's size, from the sizes the camera lists. The rule is read from 3.2.1 (javap `CameraSizes.getPreviewOutputSize`):
 * the list sorted by height x width ascending (stable), reversed, then `closestTo`: the FIRST of that order with the least
 * |w x h - target w x h|, the target being the view's. Every expected value below is worked by hand from that rule.
 */
class PreviewSizesTest {
  private fun report(vararg sizes: Pair<Int, Int>) = PreviewSizes.report(sizes.toList())

  /** The phone-like list: 12 Mpx, 1080p, a 20:9 720p, the encode's own size, VGA. */
  private val listed = arrayOf(4000 to 3000, 1920 to 1080, 1600 to 720, 1280 to 720, 640 to 480)

  @Test
  fun `the encode's own size listed is the pick, and nothing else shares its area`() {
    val r = report(*listed)
    assertEquals(PreviewSizeReport(listed = 5, encodeListed = true, sameArea = 0, pickWidth = 1280, pickHeight = 720), r)
  }

  /** 921 600 against 12 000 000, 2 073 600, 1 152 000 and 307 200: 1600 x 720 is the least apart (230 400), a 20:9 size. */
  @Test
  fun `without the encode's size the nearest area is picked, whatever its shape`() {
    val r = report(4000 to 3000, 1920 to 1080, 1600 to 720, 640 to 480)
    assertEquals(PreviewSizeReport(listed = 4, encodeListed = false, sameArea = 0, pickWidth = 1600, pickHeight = 720), r)
  }

  /**
   * 1152 x 800 is 921 600 too. Sorted ascending (stable) the two stay in the list's order, reversed they swap, and the first
   * least wins: so the LATER of two equal areas in the camera's own list is the pick, here the 1152 x 800, not the encode's.
   * The line says so: the exact size is listed, one other shares its area, and the pick is the other.
   */
  @Test
  fun `of two sizes with the encode's area, the later in the camera's list wins`() {
    val r = report(1280 to 720, 1152 to 800, 640 to 480)
    assertEquals(PreviewSizeReport(listed = 3, encodeListed = true, sameArea = 1, pickWidth = 1152, pickHeight = 800), r)
    val swapped = report(1152 to 800, 1280 to 720, 640 to 480)
    assertEquals(PreviewSizeReport(listed = 3, encodeListed = true, sameArea = 1, pickWidth = 1280, pickHeight = 720), swapped)
  }

  /** Both 1 away from 921 600 (921 599 and 921 601): the larger area is first once reversed, so it wins, in either list order. */
  @Test
  fun `two areas equally near are won by the larger`() {
    val both = arrayOf(921_599 to 1, 921_601 to 1)
    for (sizes in listOf(both.toList(), both.reversed())) {
      val r = PreviewSizes.report(sizes)
      assertEquals(921_601 to 1, r.pickWidth to r.pickHeight, "$sizes")
      assertEquals(false, r.encodeListed)
      assertEquals(0, r.sameArea)
    }
  }

  @Test
  fun `a portrait entry with the encode's area is another size sharing it, not the encode's`() {
    val r = report(720 to 1280, 640 to 480)
    assertEquals(PreviewSizeReport(listed = 2, encodeListed = false, sameArea = 1, pickWidth = 720, pickHeight = 1280), r)
  }

  /** StreamPack's own `closestTo` throws on an empty list; the line says nothing was listed and names no pick. */
  @Test
  fun `no sizes listed reports nothing listed and no pick`() {
    assertEquals(PreviewSizeReport(listed = 0, encodeListed = false, sameArea = 0, pickWidth = 0, pickHeight = 0), report())
  }

  /** The fields, in the order the allow-list names them, and the kind the record writes. */
  @Test
  fun `the line is a preview-size kind with five scalar fields`() {
    val entry = PreviewSizes.entry(PreviewSizes.report(listed.toList()))
    assertEquals("preview-size", entry.kind)
    assertEquals(
      listOf("listed" to 5, "encodeListed" to true, "sameArea" to 0, "pickWidth" to 1280, "pickHeight" to 720),
      entry.fields,
    )
    assertEquals("info", entry.level)
  }

  /** The kind and each key are the allow-list's (so the JS scrub keeps them), and the record keeps the numbers and the boolean, masking none. */
  @Test
  fun `the allow-list names the kind and every key, and the record keeps their values`() {
    val list = Shared.read("scrub/allow-list.json")
    val entry = PreviewSizes.entry(PreviewSizes.report(listed.toList()))
    assertTrue(list.getJSONObject("kinds").has(entry.kind), "the kind: ${entry.kind}")
    val scalars = list.getJSONObject("scalars")
    assertEquals(5, entry.fields.size)
    for ((key, _) in entry.fields) assertTrue(scalars.has(key), "scalar key $key")
    val lines = mutableListOf<String>()
    SessionRecord { lines += it }.append(0, entry)
    val line = JSONObject(lines.single())
    assertEquals("preview-size", line.getString("kind"))
    assertEquals(5, line.getInt("listed"))
    assertEquals(true, line.getBoolean("encodeListed"))
    assertEquals(0, line.getInt("sameArea"))
    assertEquals(1280, line.getInt("pickWidth"))
    assertEquals(720, line.getInt("pickHeight"))
  }

  @Test
  fun `a report is made from the list alone, not from the reports before it`() {
    val first = report(*listed)
    report(4000 to 3000, 640 to 480)
    assertEquals(first, report(*listed))
    assertEquals(RecordEntry("preview-size", first.let { PreviewSizes.entry(it).fields }), PreviewSizes.entry(first))
  }
}
