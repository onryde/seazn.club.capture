package com.seazn.capture.engine.vendor

import com.seazn.capture.engine.core.RecordEntry
import com.seazn.capture.engine.core.SessionRecord
import com.seazn.capture.engine.core.SrtTarget
import com.seazn.capture.engine.core.Vendored
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

  /**
   * F-S4-1: StreamPack 3.2.1 has no public word that the camera device was lost; its `CameraUtils.openCamera`
   * logs it, and only it: `onDisconnected` warns "Camera $id has been disconnected", `onError` errs
   * "Camera $id is in error $error" (the sources). A busy error (1, 2: another app's take) is the open's own
   * failure, read where the open fails; any other is a loss. Every line still reaches the record.
   */
  @Test
  fun `F-S4-1 StreamPack's camera loss lines name the camera lost, and nothing else does`() {
    val lost = mutableListOf<String>()
    val written = mutableListOf<String>()
    val vendor = VendorLines(lost::add) { _, fields -> written += fields["message"].toString() }
    val rows =
      listOf(
        Triple("w", "Camera 0 has been disconnected", "0"),
        Triple("e", "Camera 1 is in error 4", "1"),
        Triple("e", "Camera 0 is in error 5", "0"),
        Triple("e", "Camera 2 is in error 3", "2"),
        Triple("e", "Camera 0 is in error 1", null), // ERROR_CAMERA_IN_USE: the open's busy failure
        Triple("e", "Camera 0 is in error 2", null), // ERROR_MAX_CAMERAS_IN_USE
        Triple("w", "Camera is not streaming", null),
        Triple("e", "Camera capture session closed for camera 0 and outputs []", null),
      )
    var checked = 0
    for ((level, message, expected) in rows) {
      lost.clear()
      if (level == "w") vendor.w("CameraUtils", message, null) else vendor.e("CameraUtils", message, null)
      assertEquals(listOfNotNull(expected), lost, message)
      checked += 1
    }
    lost.clear()
    vendor.w("CameraSource", "Camera 0 has been disconnected", null)
    assertEquals(emptyList<String>(), lost, "another tag's line is no loss")
    assertEquals(rows.size + 1, written.size, "every line reaches the record")
    assertEquals(rows.size, checked, "the sweep's own count")
  }

  @Test
  fun `C6 m-4 a call with no throwable writes no error`() {
    val lines = recorded { vendor, _ -> vendor.w("RtmpClient", "slow ack", null) }
    assertEquals(1, lines.size)
    assertTrue(JSONObject(lines.single()).isNull("error"), lines.single())
  }

  /**
   * Batch 11, Q4 of the web's record design: SRT's stream id and passphrase quoted in a vendor's message, written
   * into a record that holds them as the engine does once a session's answer arrives (Engine.kt: the descriptor's
   * secrets, its stream id kept out of URLs only), are masked where they stand, in either spelling of `streamid`.
   * What the record writes then trips no S3, the contract's own pattern (contracts/capture-record.v1.json), which
   * the same words unmasked do. Every value is made up.
   */
  @Test
  fun `Q4 a vendor message quoting SRT's stream id and passphrase is masked in place and trips no S3`() {
    val streamId = "0123456789abcdef0123456789abcdef"
    val passphrase = "made-up-passphrase-77"
    val lines = mutableListOf<String>()
    val record = SessionRecord { lines += it }
    record.protect(listOf(passphrase, streamId), notInUrls = listOf(streamId))
    val vendor = VendorLines { level, fields -> record.append(0, RecordEntry("vendor-log", fields.toList(), level)) }
    vendor.e("SrtSink", "handshake rejected: srt://h:1?streamid=$streamId&passphrase=$passphrase", null)
    vendor.w("SrtSink", "streamId=$streamId refused (streamid $streamId)", null)
    val messages = lines.map { JSONObject(it).getString("message") }
    val masked =
      listOf("handshake rejected: srt://h:1?streamid=***&passphrase=***", "streamId=*** refused (streamid ***)")
    assertEquals(masked, messages)
    val defs = JSONObject(Vendored.text("capture-record.v1.json")).getJSONObject("\$defs")
    val s3 = Regex(defs.getJSONObject("secretS3").getString("pattern"))
    for (line in lines) {
      assertFalse(streamId in line || passphrase in line, line)
      assertFalse(s3.containsMatchIn(JSONObject(line).getString("message")), line)
    }
    assertTrue(s3.containsMatchIn("streamId=$streamId refused"), "unmasked, S3 sees it: the rule is live")
  }

  /**
   * Batch 11, Q4's second minor: `SrtTarget.toString()` prints `streamId=<32 chars>`, which S3 reads as a pair. No
   * writer formats a target into text (the batch 11 answers list every text-key writer), and a target handed to the
   * record as a value is masked whole, never written as its toString.
   */
  @Test
  fun `Q4 a target handed to the record as a value is masked whole, never its toString`() {
    val lines = mutableListOf<String>()
    val target = SrtTarget("srt://h:1", "0123456789abcdef0123456789abcdef", "made-up-passphrase-77", 120)
    assertTrue("streamId=<32 chars>" in target.toString(), "the form the web's S3 would refuse")
    SessionRecord { lines += it }.append(0, RecordEntry("engine-error", listOf("message" to target)))
    assertEquals("***", JSONObject(lines.single()).getString("message"), lines.single())
  }
}
