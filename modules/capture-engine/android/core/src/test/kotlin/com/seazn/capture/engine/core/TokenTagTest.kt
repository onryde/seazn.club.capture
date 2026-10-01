package com.seazn.capture.engine.core

import kotlin.test.Test
import kotlin.test.assertEquals

class TokenTagTest {
  @Test
  fun `carry 2 the token tag matches the JS one on every shared vector, non-ASCII included`() {
    val vectors = Shared.read("wire/token-tag-vectors.json").getJSONArray("vectors")
    // The file's row count, so an emptied or truncated file cannot pass by sweeping nothing (PV12).
    assertEquals(8, vectors.length())
    for (i in 0 until vectors.length()) {
      val row = vectors.getJSONObject(i)
      assertEquals(row.getString("tag"), TokenTag.of(row.getString("token")), row.getString("token"))
    }
  }
}
