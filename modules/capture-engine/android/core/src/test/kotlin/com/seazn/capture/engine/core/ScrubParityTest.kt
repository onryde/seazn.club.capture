package com.seazn.capture.engine.core

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue
import org.json.JSONArray
import org.json.JSONObject

/** Carry 11: the record's scrub is one rule set, pinned by files the JS scrub reads too. */
class ScrubParityTest {
  private val list = Shared.read("scrub/allow-list.json")
  private val vectors = Shared.read("scrub/vectors.json")

  private fun JSONArray.strings(): Set<String> = (0 until length()).map { getString(it) }.toSet()

  @Test
  fun `carry 11 the key sets are the shared file's`() {
    assertEquals(list.getJSONArray("plain").strings(), SessionRecord.PLAIN_KEYS)
    assertEquals(list.getJSONArray("publicUrl").strings(), SessionRecord.PUBLIC_URL_KEYS)
    assertEquals(list.getJSONArray("text").strings(), SessionRecord.TEXT_KEYS)
    assertEquals(list.getJSONArray("never").strings(), SessionRecord.NEVER)
    assertEquals(list.getJSONArray("reserved").strings(), SessionRecord.RESERVED_KEYS)
    assertEquals(list.getString("mask"), SessionRecord.MASK)
    // The word rule is the file's too, character for character (review I1).
    assertEquals(list.getString("plainWord"), SessionRecord.PLAIN_WORD.pattern)
    assertEquals(list.getJSONObject("reasons").keySet(), SessionRecord.PLAIN_KEYS, "every plain key has its reason")
  }

  @Test
  fun `carry 11 every shared case writes what the vectors say`() {
    val cases = vectors.getJSONArray("cases")
    val reserved = list.getJSONArray("reserved").strings()
    // The file's row count, so an emptied or truncated file cannot pass by sweeping nothing (PV12).
    assertEquals(48, cases.length())
    // Every row is checked and every wrong one named, as JS's it.each reports them.
    val wrong =
      (0 until cases.length()).mapNotNull { i ->
        val case = cases.getJSONObject(i)
        val key = case.getString("key")
        val line = JSONObject(written(RecordEntry("probe", listOf(key to value(case, "value")))))
        // A field named like a line key is written field_<key> (CD7), by the file's reserved list, not
        // the code under test's; the value is what the vectors pin.
        val writtenAs = if (key in reserved) "field_$key" else key
        val (expected, actual) = value(case, "expected") to value(line, writtenAs)
        when {
          // org.json's isNull is true for a missing key too, so a dropped field is caught here, not read as null.
          !line.has(writtenAs) -> "${case.getString("why")}: <$writtenAs> is missing from $line"
          expected == actual -> null
          else -> "${case.getString("why")}: expected <$expected> but was <$actual>"
        }
      }
    assertEquals(emptyList(), wrong)
  }

  @Test
  fun `carry 11 every shared kind case writes what the vectors say`() {
    val kinds = vectors.getJSONArray("kinds")
    assertEquals(4, kinds.length())
    for (i in 0 until kinds.length()) {
      val case = kinds.getJSONObject(i)
      assertEquals(case.getString("expected"), JSONObject(written(RecordEntry(case.getString("value")))).getString("kind"), case.getString("why"))
    }
  }

  @Test
  fun `the shared held block is the test config's secrets`() {
    val held = vectors.getJSONObject("held")
    val shared = held.getJSONArray("secrets").strings() + held.getJSONArray("streamIds").strings()
    assertEquals(shared, Configs.valid().secrets().toSet())
    assertEquals(held.getJSONArray("textOnly").strings(), Configs.pairRequest().textSecrets().toSet())
  }

  // Beyond the brief (dispatch carry): the file decides every kind and key the core writes at C1.

  @Test
  fun `every record kind the core writes passes the kind rule as itself, while a session is held`() {
    val kinds = list.getJSONObject("kinds").keySet()
    assertEquals(72, kinds.size)
    for (kind in kinds) assertEquals(kind, JSONObject(written(RecordEntry(kind))).getString("kind"), kind)
  }

  @Test
  fun `a scalar key sits on no list, so its numbers and booleans pass and a string under it is masked`() {
    val scalars = list.getJSONObject("scalars").keySet()
    assertEquals(25, scalars.size)
    val listed = SessionRecord.PLAIN_KEYS + SessionRecord.PUBLIC_URL_KEYS + SessionRecord.TEXT_KEYS + SessionRecord.NEVER + SessionRecord.RESERVED_KEYS
    assertTrue(scalars.intersect(listed).isEmpty(), "on a list: ${scalars.intersect(listed)}")
    for (key in scalars) {
      for ((value, expected) in listOf(7 to 7, true to true, "srt" to "***")) {
        assertEquals(expected, JSONObject(written(RecordEntry("probe", listOf(key to value)))).get(key), "$key = $value")
      }
    }
  }

  /**
   * Protected as the engine protects (`Engine.protectFailure`): the token, and the code in free text
   * alone, at `Pair`; the session's secrets at an open code answer, with the stream id allowed in a
   * public URL. Every input protects again, so a later answer, such as a reconnect's, protects the
   * same values a second time: each row runs after that (review M3).
   */
  private fun written(entry: RecordEntry): String {
    val lines = mutableListOf<String>()
    val record = SessionRecord { lines += it }
    val request = Configs.pairRequest()
    record.protect(request.secrets(), inTextOnly = request.textSecrets())
    repeat(2) { record.protect(Configs.valid().secrets(), notInUrls = listOf(Configs.STREAM_ID)) }
    record.append(0, entry)
    return lines.single()
  }

  /** A key the line holds, its JSON null read as null. Whether the line holds it is asked first. */
  private fun value(obj: JSONObject, key: String): Any? = if (obj.isNull(key)) null else obj.get(key)
}
