package com.seazn.capture.engine.vendor

import com.seazn.capture.engine.core.RecordEntry
import com.seazn.capture.engine.core.SessionRecord
import java.io.IOException
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue
import org.json.JSONObject

/**
 * C6 m-4: the vendor loggers' one rule, written as komuxer's RTMPS client logs (its message quotes the
 * throwable's), into a real [SessionRecord] that holds the stream key, as the engine's does once a
 * session's answer arrives, and wired as EngineHost wires it. Every value is made up.
 */
class VendorLinesTest {
  private val key = "live-made-up-7f3a9c"

  private fun recorded(log: (VendorLines, IOException) -> Unit): List<String> {
    val lines = mutableListOf<String>()
    val record = SessionRecord { lines += it }.apply { protect(listOf(key)) }
    val vendor = VendorLines { level, fields -> record.append(0, RecordEntry("vendor-log", fields.toList(), level)) }
    log(vendor, IOException("publish refused for rtmps://live.example/app/$key"))
    return lines
  }

  @Test
  fun `C6 m-4 a vendor's error and warning reach the record with the key masked, and the throwable by its class alone`() {
    val lines =
      recorded { vendor, failure ->
        vendor.e("RtmpClient", "connect failed: ${failure.message}", failure)
        vendor.w("RtmpClient", "retrying after: ${failure.message}", failure)
      }
    assertEquals(listOf("error", "warn"), lines.map { JSONObject(it).getString("level") }, "each call, once, at its level")
    for (line in lines) {
      val written = JSONObject(line)
      assertFalse(key in line, line)
      assertFalse("publish refused" in written.getString("error"), "the throwable's message is never written: $line")
      assertEquals("vendor-log", written.getString("kind"))
      assertEquals("RtmpClient", written.getString("tag"))
      assertEquals("java.io.IOException", written.getString("error"))
      assertTrue(written.getString("message").endsWith("rtmps://live.example/app/***"), "the key is masked where it stands: $line")
    }
  }

  @Test
  fun `C6 m-4 a call with no throwable writes no error`() {
    val lines = recorded { vendor, _ -> vendor.w("RtmpClient", "slow ack", null) }
    assertEquals(1, lines.size)
    assertTrue(JSONObject(lines.single()).isNull("error"), lines.single())
  }
}
