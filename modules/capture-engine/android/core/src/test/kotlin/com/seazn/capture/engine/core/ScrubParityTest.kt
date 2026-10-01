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
    assertEquals(list.getJSONObject("reasons").keySet(), SessionRecord.PLAIN_KEYS, "every plain key has its reason")
  }

  @Test
  fun `carry 11 every shared case writes what the vectors say`() {
    val cases = vectors.getJSONArray("cases")
    // The file's row count, so an emptied or truncated file cannot pass by sweeping nothing (PV12).
    assertEquals(30, cases.length())
    // Every row is checked and every wrong one named, as JS's it.each reports them.
    val wrong =
      (0 until cases.length()).mapNotNull { i ->
        val case = cases.getJSONObject(i)
        val key = case.getString("key")
        val line = JSONObject(written(RecordEntry("probe", listOf(key to value(case, "value")))))
        // A field named like a line key is written field_<key> (CD7); the value is what the vectors pin.
        val writtenAs = if (key in SessionRecord.RESERVED_KEYS) "field_$key" else key
        val (expected, actual) = value(case, "expected") to value(line, writtenAs)
        if (expected == actual) null else "${case.getString("why")}: expected <$expected> but was <$actual>"
      }
    assertEquals(emptyList(), wrong)
  }

  @Test
  fun `carry 11 every shared kind case writes what the vectors say`() {
    val kinds = vectors.getJSONArray("kinds")
    assertEquals(3, kinds.length())
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
  }

  // Beyond the brief (dispatch carry): the file decides every kind and key the core writes at C1.

  @Test
  fun `every record kind the core writes passes the kind rule as itself, while a session is held`() {
    val kinds = list.getJSONObject("kinds").keySet()
    assertEquals(52, kinds.size)
    for (kind in kinds) assertEquals(kind, JSONObject(written(RecordEntry(kind))).getString("kind"), kind)
  }

  @Test
  fun `a scalar key sits on no list, so its numbers and booleans pass and a string under it is masked`() {
    val scalars = list.getJSONObject("scalars").keySet()
    assertEquals(18, scalars.size)
    val listed = SessionRecord.PLAIN_KEYS + SessionRecord.PUBLIC_URL_KEYS + SessionRecord.TEXT_KEYS + SessionRecord.NEVER + SessionRecord.RESERVED_KEYS
    assertTrue(scalars.intersect(listed).isEmpty(), "on a list: ${scalars.intersect(listed)}")
    for (key in scalars) {
      for ((value, expected) in listOf(7 to 7, true to true, "srt" to "***")) {
        assertEquals(expected, JSONObject(written(RecordEntry("probe", listOf(key to value)))).get(key), "$key = $value")
      }
    }
  }

  private fun written(entry: RecordEntry): String {
    val lines = mutableListOf<String>()
    val record = SessionRecord { lines += it }
    // Task 5's signature: the secrets, and the stream ids a public URL may carry.
    record.protect(Configs.valid().secrets(), notInUrls = listOf(Configs.STREAM_ID))
    record.append(0, entry)
    return lines.single()
  }

  private fun value(obj: JSONObject, key: String): Any? = if (obj.isNull(key)) null else obj.get(key)
}
