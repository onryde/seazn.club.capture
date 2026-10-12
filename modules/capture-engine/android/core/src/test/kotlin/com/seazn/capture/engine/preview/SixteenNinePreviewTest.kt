package com.seazn.capture.engine.preview

import kotlin.test.Test
import kotlin.test.assertEquals

/**
 * N30, Task 3.3 (preflight M1): what the decorated camera tells StreamPack's PreviewView when it asks for its preview's
 * size. The decorator itself (`SixteenNineCamera`, glue, Android build only) is one line over this seam:
 * `PreviewSizes.answer(listed) { the real source's answer }`. Its StreamPack and Android types never reach the JVM;
 * the delegation is proved by its bytecode and the preview's size on the device (Batch 9).
 */
class SixteenNinePreviewTest {
  /** The CPH2569's sizes around the encode's area (r4-b-media-camera.txt): StreamPack's rule picks the square. */
  private val cph2569 = listOf(1280 to 960, 1280 to 720, 960 to 960, 960 to 540)

  /** Stands for the real source's `getPreviewSize`, and counts each time it is asked. */
  private class Vendor(private val size: Pair<Int, Int>) {
    var asks = 0
      private set

    fun answer(): Pair<Int, Int> {
      asks++
      return size
    }
  }

  @Test
  fun `the answer is the 16 by 9 pick, and never asks the real source`() {
    val vendor = Vendor(960 to 960)
    assertEquals(1280 to 720, PreviewSizes.answer(cph2569, vendor::answer))
    assertEquals(0, vendor.asks)
  }

  @Test
  fun `no 16 by 9 size listed - the answer is the real source's own, asked once`() {
    val vendor = Vendor(960 to 960)
    assertEquals(960 to 960, PreviewSizes.answer(listOf(960 to 960, 640 to 480), vendor::answer))
    assertEquals(1, vendor.asks)
  }

  /** A failed characteristics read lists nothing: the preview is never broken by our rule, it gets StreamPack's. */
  @Test
  fun `an empty list - the real source's answer stands (an empty input)`() {
    val vendor = Vendor(1600 to 720)
    assertEquals(1600 to 720, PreviewSizes.answer(emptyList(), vendor::answer))
    assertEquals(1, vendor.asks)
  }

  /** The PreviewView asks again on each size change and each return to visible: the answer holds no state. */
  @Test
  fun `a second ask gets the same answer`() {
    val vendor = Vendor(960 to 960)
    repeat(2) { assertEquals(1280 to 720, PreviewSizes.answer(cph2569, vendor::answer), "ask ${it + 1}") }
    repeat(2) { assertEquals(960 to 960, PreviewSizes.answer(listOf(960 to 960), vendor::answer), "ask ${it + 1}") }
    assertEquals(2, vendor.asks)
  }
}
