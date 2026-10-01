package com.seazn.capture.engine.core

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue
import org.json.JSONObject

class ServerWordTest {
  private fun JSONObject.text(key: String): String? = if (has(key) && !isNull(key)) getString(key) else null

  private fun beat(row: JSONObject): HeartbeatResponse =
    if (row.optBoolean("failed")) HeartbeatResponse.Failed("reset")
    else HeartbeatResponse.Answered(row.getInt("status"), BeatReply(row.text("state"), row.text("sid"), row.text("startedBy"), row.text("endReason"), null))

  private fun code(row: JSONObject): CodeAnswer {
    val sid = row.text("sid") ?: ""
    return when (row.getString("answer")) {
      "open" -> CodeAnswer.Open(sid, "live", Configs.descriptor(), null)
      "over" -> CodeAnswer.Over(sid, row.text("endReason"))
      "waiting" -> CodeAnswer.Waiting(WaitingFields.UNKNOWN)
      "not-current" -> CodeAnswer.NotCurrent(sid)
      "foreign-ingest" -> CodeAnswer.ForeignIngest(sid)
      "unreachable" -> CodeAnswer.Unreachable("dns")
      else -> CodeAnswer.Status(row.getInt("status"), null, null)
    }
  }

  private fun kind(word: ServerWord): String =
    when (word) {
      is ServerWord.Over -> "over"
      is ServerWord.Open -> "open"
      ServerWord.NoBroadcast -> "no-broadcast"
      ServerWord.Replaced -> "replaced"
      ServerWord.Taken -> "taken"
      ServerWord.CodeEnded -> "code-ended"
      ServerWord.NotFound -> "not-found"
      ServerWord.NoEvidence -> "no-evidence"
    }

  @Test
  fun `every row of the server's word, on both sources, and what it means for the held sid`() {
    val rows = Shared.read("wire/server-word-vectors.json").getJSONArray("rows")
    // The file's row count, 13 code rows and 18 beat rows, so a truncated file cannot pass (PV12).
    assertEquals(31, rows.length())
    for (i in 0 until rows.length()) {
      val row = rows.getJSONObject(i)
      val named = row.text("named")
      val word = if (row.getString("source") == "beat") ServerWord.ofBeat(beat(row), named) else ServerWord.ofCode(code(row), named)
      val label = "row $i: $row"
      assertEquals(row.getString("word"), kind(word), label)
      assertEquals(row.text("wordSid"), (word as? ServerWord.Over)?.sid ?: (word as? ServerWord.Open)?.sid, label)
      row.text("cause")?.let { assertEquals(it, (word as ServerWord.Open).cause?.wire, label) }
      assertEquals(row.getBoolean("ends"), word.ends("S"), label)
    }
  }

  @Test
  fun `a 410 to a beat that named nothing ends nothing`() {
    val word = ServerWord.ofBeat(HeartbeatResponse.Answered(410), named = null)
    assertEquals(ServerWord.Over(null, null), word)
    assertEquals(false, word.ends("S"))
  }

  @Test
  fun `an answer that names no sid, or a not-current answer with no sid held, is no evidence`() {
    // Guards the vector rows do not reach: every beat row saying over or live carries a sid, and every
    // code row is judged with S held.
    for (state in listOf("over", "live")) {
      val noSid = HeartbeatResponse.Answered(200, BeatReply(state, null, null, "stopped", null))
      assertEquals(ServerWord.NoEvidence, ServerWord.ofBeat(noSid, named = "S"), state)
    }
    assertEquals(ServerWord.NoEvidence, ServerWord.ofCode(CodeAnswer.NotCurrent("N"), named = null))
  }

  @Test
  fun `A18 a descriptor offers SRT when either transport is SRT, and RTMPS alone offers none`() {
    assertTrue(Configs.descriptor().srtOffered)
    assertTrue(Configs.descriptor(primary = Configs.rtmps, fallback = Configs.srt).srtOffered)
    assertFalse(Configs.descriptor(primary = Configs.rtmps, fallback = null).srtOffered)
  }
}
