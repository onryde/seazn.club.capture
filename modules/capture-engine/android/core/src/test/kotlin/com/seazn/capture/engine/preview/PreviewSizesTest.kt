package com.seazn.capture.engine.preview

import com.seazn.capture.engine.core.RecordEntry
import com.seazn.capture.engine.core.SessionRecord
import com.seazn.capture.engine.core.Shared
import org.json.JSONObject
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/**
 * The phone's own word on the preview (preview-fill review I-1), and the size it gets (N30, D3 findings design §4).
 * StreamPack 3.2.1's rule ([PreviewSizes.vendorPick]) is read from javap (`CameraSizes.getPreviewOutputSize`): the list
 * sorted by height x width ascending (stable), reversed, then `closestTo`: the FIRST of that order with the least
 * |w x h - target w x h|, the target being the view's, the encode's 1280 x 720. Ours ([PreviewSizes.pick16x9]) is the
 * spec's: among the listed 16:9 sizes, the one whose area is nearest 1280 x 720's (921 600). The line says the size the
 * preview gets: ours when the rule is wired and a 16:9 size is listed, else StreamPack's. Every expected value below is
 * worked by hand from those two rules, never from the code under test.
 */
class PreviewSizesTest {
  private fun report(vararg sizes: Pair<Int, Int>) = PreviewSizes.report(sizes.toList(), wired = true)

  /** The phone-like list: 12 Mpx, 1080p, a 20:9 720p, the encode's own size, VGA. */
  private val listed = arrayOf(4000 to 3000, 1920 to 1080, 1600 to 720, 1280 to 720, 640 to 480)

  /** `dumpsys media.camera` on the CPH2569, camera 0, format 34 (SurfaceHolder) outputs, 2026-10-11 (r4-b-media-camera.txt). */
  private val cph2569 =
    listOf(4096 to 3072, 4096 to 2304, 4096 to 1832, 3840 to 2160, 3840 to 1644, 3456 to 2592, 3280 to 2464, 3264 to 2448, 3264 to 1836, 3264 to 1456,
      3200 to 2400, 3168 to 1440, 3072 to 3072, 2752 to 1548, 2592 to 1944, 2592 to 1168, 2560 to 1440, 2448 to 2448, 2412 to 1080, 2400 to 1080,
      2400 to 1028, 2376 to 1080, 2328 to 1746, 2304 to 1728, 2304 to 1296, 2304 to 1046, 2304 to 1032, 2160 to 1080, 1944 to 1944, 1920 to 1440,
      1920 to 1080, 1920 to 864, 1600 to 1200, 1600 to 800, 1600 to 720, 1600 to 716, 1584 to 720, 1440 to 1080, 1280 to 960, 1280 to 768,
      1280 to 720, 1200 to 1200, 1200 to 540, 1188 to 540, 1080 to 1080, 1024 to 768, 960 to 960, 960 to 720, 960 to 540, 800 to 400,
      792 to 360, 720 to 540, 720 to 480, 640 to 640, 640 to 480, 352 to 288, 320 to 240, 176 to 144)

  /** The NE2211's (OnePlus), camera 0, format 34, 2026-10-11 (b8-media-camera.txt). */
  private val ne2211 =
    listOf(4000 to 3008, 4000 to 2252, 3840 to 2160, 3280 to 2464, 3264 to 2448, 4000 to 1792, 3840 to 1644, 2592 to 1944, 3216 to 1440, 2560 to 1440,
      1920 to 1440, 2520 to 1080, 2412 to 1080, 2160 to 1080, 1920 to 1080, 1440 to 1080, 1200 to 1200, 1600 to 800, 1280 to 960, 1080 to 1080,
      1608 to 720, 1280 to 720, 1024 to 768, 1206 to 540, 864 to 480, 720 to 540, 720 to 480, 800 to 400, 640 to 480, 804 to 360,
      640 to 360, 352 to 288, 320 to 240, 176 to 144)

  /** A camera that lists no 16:9 size at all, with a square tie for the encode's area. */
  private val noWide = listOf(1440 to 1080, 1280 to 960, 960 to 960, 640 to 480)

  @Test
  fun `the encode's own size listed is the pick, and nothing else shares its area`() {
    val r = report(*listed)
    assertEquals(
      PreviewSizeReport(listed = 5, encodeListed = true, sameArea = 0, pickWidth = 1280, pickHeight = 720, pickAspect16x9 = true, pickSource = "ours"),
      r,
    )
  }

  /**
   * 921 600 against 12 000 000, 2 073 600, 1 152 000 and 307 200: StreamPack's area rule takes 1600 x 720 (230 400 apart),
   * a 20:9 size. The only 16:9 size listed is 1920 x 1080, so ours takes it, whatever its distance.
   */
  @Test
  fun `without the encode's size StreamPack takes the nearest area whatever its shape, and ours the 16 by 9 one`() {
    val sizes = listOf(4000 to 3000, 1920 to 1080, 1600 to 720, 640 to 480)
    assertEquals(1600 to 720, PreviewSizes.vendorPick(sizes))
    assertEquals(
      PreviewSizeReport(listed = 4, encodeListed = false, sameArea = 0, pickWidth = 1920, pickHeight = 1080, pickAspect16x9 = true, pickSource = "ours"),
      PreviewSizes.report(sizes, wired = true),
    )
  }

  /**
   * 1152 x 800 is 921 600 too. Sorted ascending (stable) the two stay in the list's order, reversed they swap, and the first
   * least wins: so StreamPack takes the LATER of two equal areas in the camera's own list, here the 1152 x 800, not the
   * encode's. Ours takes 1280 x 720 in either order: it is the only 16:9 size. The line still counts the tie.
   */
  @Test
  fun `of two sizes with the encode's area, StreamPack takes the later in the camera's list, and ours the 16 by 9 one`() {
    assertEquals(1152 to 800, PreviewSizes.vendorPick(listOf(1280 to 720, 1152 to 800, 640 to 480)))
    assertEquals(1280 to 720, PreviewSizes.vendorPick(listOf(1152 to 800, 1280 to 720, 640 to 480)))
    val expected = PreviewSizeReport(listed = 3, encodeListed = true, sameArea = 1, pickWidth = 1280, pickHeight = 720, pickAspect16x9 = true, pickSource = "ours")
    assertEquals(expected, report(1280 to 720, 1152 to 800, 640 to 480))
    assertEquals(expected, report(1152 to 800, 1280 to 720, 640 to 480))
  }

  /** Both 1 away from 921 600 (921 599 and 921 601): the larger area is first once reversed, so it wins, in either list order. */
  @Test
  fun `two areas equally near are won by the larger in StreamPack's rule, and the line says vendor`() {
    val both = arrayOf(921_599 to 1, 921_601 to 1)
    for (sizes in listOf(both.toList(), both.reversed())) {
      assertEquals(921_601 to 1, PreviewSizes.vendorPick(sizes), "$sizes")
      val r = PreviewSizes.report(sizes, wired = true)
      assertEquals(listOf(921_601, 1, false, "vendor"), listOf(r.pickWidth, r.pickHeight, r.pickAspect16x9, r.pickSource), "$sizes")
      assertEquals(false, r.encodeListed)
      assertEquals(0, r.sameArea)
    }
  }

  /** 720 x 1280 is 9:16, not 16:9 (720 x 9 = 6 480, 1280 x 16 = 20 480): another size sharing the area, and no 16:9 pick. */
  @Test
  fun `a portrait entry with the encode's area is another size sharing it, not the encode's, and not 16 by 9`() {
    assertEquals(
      PreviewSizeReport(listed = 2, encodeListed = false, sameArea = 1, pickWidth = 720, pickHeight = 1280, pickAspect16x9 = false, pickSource = "vendor"),
      report(720 to 1280, 640 to 480),
    )
  }

  /** StreamPack's own `closestTo` throws on an empty list; the line says nothing was listed and names no pick. */
  @Test
  fun `no sizes listed reports nothing listed and no pick`() {
    val nothing = PreviewSizeReport(listed = 0, encodeListed = false, sameArea = 0, pickWidth = 0, pickHeight = 0, pickAspect16x9 = false, pickSource = "vendor")
    assertEquals(nothing, report())
    assertEquals(nothing, PreviewSizes.report(emptyList(), wired = false))
  }

  @Test
  fun `the CPH2569's list - StreamPack picks the square, ours picks 1280 x 720`() {
    assertEquals(960 to 960, PreviewSizes.vendorPick(cph2569))
    assertEquals(1280 to 720, PreviewSizes.pick16x9(cph2569))
    val report = PreviewSizes.report(cph2569, wired = true)
    assertEquals(listOf(1280, 720, true, "ours"), listOf(report.pickWidth, report.pickHeight, report.pickAspect16x9, report.pickSource))
    assertEquals(1, report.sameArea)
  }

  /** Preflight M2: until the decorator is bound, the preview gets StreamPack's pick, and the line must say so. */
  @Test
  fun `the CPH2569's list unwired - the line says StreamPack's square, vendor, not 16 by 9`() {
    val report = PreviewSizes.report(cph2569, wired = false)
    assertEquals(listOf(960, 960, false, "vendor"), listOf(report.pickWidth, report.pickHeight, report.pickAspect16x9, report.pickSource))
    assertEquals(1, report.sameArea)
  }

  @Test
  fun `the NE2211's list - both pick 1280 x 720, and ours says so`() {
    assertEquals(1280 to 720, PreviewSizes.vendorPick(ne2211))
    assertEquals(1280 to 720, PreviewSizes.pick16x9(ne2211))
    assertEquals("ours", PreviewSizes.report(ne2211, wired = true).pickSource)
  }

  /** Unwired, the NE2211's StreamPack pick is 16:9 anyway: the aspect is read from the size, the source from the rule. */
  @Test
  fun `the NE2211's list unwired - 1280 x 720, 16 by 9, from StreamPack's rule`() {
    val report = PreviewSizes.report(ne2211, wired = false)
    assertEquals(listOf(1280, 720, true, "vendor"), listOf(report.pickWidth, report.pickHeight, report.pickAspect16x9, report.pickSource))
  }

  @Test
  fun `no 16 by 9 size listed - keep StreamPack's pick, and the record says vendor`() {
    assertEquals(null, PreviewSizes.pick16x9(noWide))
    val report = PreviewSizes.report(noWide, wired = true)
    assertEquals(listOf(960, 960, false, "vendor"), listOf(report.pickWidth, report.pickHeight, report.pickAspect16x9, report.pickSource))
  }

  @Test
  fun `an empty list - nothing to pick, 0 by 0, vendor (an empty input)`() {
    assertEquals(null, PreviewSizes.pick16x9(emptyList()))
    val report = PreviewSizes.report(emptyList(), wired = true)
    assertEquals(listOf(0, 0, false, "vendor"), listOf(report.pickWidth, report.pickHeight, report.pickAspect16x9, report.pickSource))
  }

  /**
   * By hand, apart from 921 600: 3840 x 2160 is 7 372 800, 1920 x 1080 is 1 152 000, 1600 x 900 is 518 400, 640 x 360 is
   * 691 200. So the nearest can be the smaller size or the larger: area, not size, decides.
   */
  @Test
  fun `among 16 by 9 sizes the nearest in area wins, smaller or larger`() {
    assertEquals(640 to 360, PreviewSizes.pick16x9(listOf(3840 to 2160, 1920 to 1080, 640 to 360)))
    assertEquals(1600 to 900, PreviewSizes.pick16x9(listOf(3840 to 2160, 1600 to 900, 640 to 360)))
    assertEquals(1280 to 720, PreviewSizes.pick16x9(listOf(960 to 540, 1600 to 900, 1280 to 720)))
  }

  /**
   * A real tie, built by hand: a 16:9 size is 16k x 9k, and two are equally far from 921 600 when k1² + k2² = 12 800.
   * k = 112 and k = 16 do it: 1792 x 1008 is 1 806 336 and 256 x 144 is 36 864, both 884 736 apart. The first listed wins.
   */
  @Test
  fun `an exact tie in area distance keeps the first listed`() {
    assertEquals(1792 to 1008, PreviewSizes.pick16x9(listOf(1792 to 1008, 256 to 144)))
    assertEquals(256 to 144, PreviewSizes.pick16x9(listOf(256 to 144, 1792 to 1008)))
  }

  @Test
  fun `the line carries the two new fields, a boolean and a plain word`() {
    val entry = PreviewSizes.entry(PreviewSizes.report(cph2569, wired = true))
    assertEquals(true, entry.fields.single { it.first == "pickAspect16x9" }.second)
    assertEquals("ours", entry.fields.single { it.first == "pickSource" }.second)
  }

  /** The fields, in the order the allow-list names them, and the kind the record writes. */
  @Test
  fun `the line is a preview-size kind with six scalar fields and one plain word`() {
    val entry = PreviewSizes.entry(report(*listed))
    assertEquals("preview-size", entry.kind)
    assertEquals(
      listOf(
        "listed" to 5,
        "encodeListed" to true,
        "sameArea" to 0,
        "pickWidth" to 1280,
        "pickHeight" to 720,
        "pickAspect16x9" to true,
        "pickSource" to "ours",
      ),
      entry.fields,
    )
    assertEquals("info", entry.level)
  }

  /**
   * The kind and each key are the allow-list's (so the JS scrub keeps them): six scalars, and `pickSource` a plain word,
   * never a scalar (a string under a scalar key is masked). The record keeps every value, masking none.
   */
  @Test
  fun `the allow-list names the kind and every key, and the record keeps their values`() {
    val list = Shared.read("scrub/allow-list.json")
    val entry = PreviewSizes.entry(report(*listed))
    assertTrue(list.getJSONObject("kinds").has(entry.kind), "the kind: ${entry.kind}")
    val scalars = list.getJSONObject("scalars")
    val plain = list.getJSONArray("plain").let { array -> (0 until array.length()).map { array.getString(it) } }
    assertEquals(7, entry.fields.size)
    for ((key, _) in entry.fields.filter { it.first != "pickSource" }) assertTrue(scalars.has(key), "scalar key $key")
    assertTrue("pickSource" in plain, "pickSource is a plain word")
    assertTrue(!scalars.has("pickSource"), "and not a scalar")
    assertTrue("pickSource" in SessionRecord.PLAIN_KEYS, "the record's own list agrees")
    val lines = mutableListOf<String>()
    SessionRecord { lines += it }.append(0, entry)
    val line = JSONObject(lines.single())
    assertEquals("preview-size", line.getString("kind"))
    assertEquals(5, line.getInt("listed"))
    assertEquals(true, line.getBoolean("encodeListed"))
    assertEquals(0, line.getInt("sameArea"))
    assertEquals(1280, line.getInt("pickWidth"))
    assertEquals(720, line.getInt("pickHeight"))
    assertEquals(true, line.getBoolean("pickAspect16x9"))
    assertEquals("ours", line.getString("pickSource"))
  }

  @Test
  fun `a report is made from the list alone, not from the reports before it`() {
    val first = report(*listed)
    report(4000 to 3000, 640 to 480)
    PreviewSizes.report(cph2569, wired = false)
    assertEquals(first, report(*listed))
    assertEquals(RecordEntry("preview-size", first.let { PreviewSizes.entry(it).fields }), PreviewSizes.entry(first))
  }
}
