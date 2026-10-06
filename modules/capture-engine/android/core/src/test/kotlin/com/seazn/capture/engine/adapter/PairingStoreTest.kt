package com.seazn.capture.engine.adapter

import com.seazn.capture.engine.core.PairingName
import com.seazn.capture.engine.core.RecordEntry
import com.seazn.capture.engine.core.StoppedRecord
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

class PairingStoreTest {
  private val memory = MemoryStore()
  private val problems = mutableListOf<RecordEntry>()
  private var made = 0

  /** Counting ids (PV21), each 18 characters, within capture-beat.v1's 16 to 64. */
  private val store = PairingStore(memory, { made += 1; "phone-test-id-" + made.toString().padStart(4, '0') }) { problems += it }
  private val name = PairingName("fx42hmnp7k2q", 1, "c980ff38")

  private val sid41 = "0b6e4f2a-7c1d-4e3b-9a5f-2d8c6b1e4f41"
  private val sid42 = "0b6e4f2a-7c1d-4e3b-9a5f-2d8c6b1e4f42"

  private fun kinds() = problems.map { it.kind to it.fields.toMap()["op"] }

  @Test
  fun `the phone id is made once, then read, by this store and the next over the same storage`() {
    assertEquals("phone-test-id-0001", store.phone("1.0.0", "Pixel").phoneId)
    assertEquals("phone-test-id-0001", store.phone("1.0.0", "Pixel").phoneId)
    val restarted = PairingStore(memory, { "phone-test-id-9999" }) { problems += it }
    assertEquals("phone-test-id-0001", restarted.phone("1.0.0", "Pixel").phoneId, "a restart keeps the install's id")
    assertEquals(1, made)
    assertEquals(emptyList(), problems)
  }

  @Test
  fun `G2 a kept id outside capture-beat v1's 16 to 64 characters is made again and reported, the edges kept`() {
    // capture-beat.v1's `phone`: minLength 16, maxLength 64.
    for (edge in listOf("p".repeat(16), "p".repeat(64), "  " + "p".repeat(16) + "\n")) {
      memory.files[PairingStore.PHONE_ID] = edge
      assertEquals(edge.trim(), store.phone("1.0.0", "Pixel").phoneId, "kept: ${edge.length}")
    }
    assertEquals(0, made)
    for ((at, bad) in listOf("p".repeat(15), "p".repeat(65)).withIndex()) {
      memory.files[PairingStore.PHONE_ID] = bad
      val id = store.phone("1.0.0", "Pixel").phoneId
      assertEquals("phone-test-id-000${at + 1}", id, "replaced: ${bad.length}")
      assertEquals(id, memory.files[PairingStore.PHONE_ID], "and kept from now on")
    }
    assertEquals(listOf("store-unreadable", "store-unreadable"), problems.map { it.kind })
  }

  @Test
  fun `no kept id is made without a word, and a blank one is none`() {
    memory.files[PairingStore.PHONE_ID] = "  \n"
    assertEquals("phone-test-id-0001", store.phone("1.0.0", "Pixel").phoneId)
    assertEquals(emptyList(), problems)
  }

  @Test
  fun `a refused write still gives this run an id, reported, and an unreadable store never overwrites the kept one`() {
    memory.refuseWrites = true
    assertEquals("phone-test-id-0001", store.phone("1.0.0", "Pixel").phoneId)
    assertEquals(listOf("store-failed" to "write"), kinds())
    memory.refuseWrites = false
    memory.files[PairingStore.PHONE_ID] = "phone-kept-id-0042"
    memory.readFailure = java.io.IOException("unreadable")
    assertEquals("phone-test-id-0002", store.phone("1.0.0", "Pixel").phoneId)
    assertEquals("phone-kept-id-0042", memory.files[PairingStore.PHONE_ID], "kept for the next run, when it may read")
    assertEquals(listOf("store-failed" to "write", "store-failed" to "read"), kinds())
  }

  @Test
  fun `a record is found by code and slot, whatever issue of the code`() {
    store.write(StoppedRecord.of(name, sid41, 1_000, 60))
    assertEquals(sid41, store.stopped(name.copy(tokenTag = "0076912c"), 2_000)?.sid)
    assertNull(store.stopped(name.copy(slot = 2), 2_000))
    assertNull(store.stopped(name.copy(code = "fx42hmnp7k2r"), 2_000))
  }

  @Test
  fun `RR2 records past keepUntil are pruned at the read`() {
    store.write(StoppedRecord.of(name, sid41, 1_000, 1))
    assertNull(store.stopped(name, 1_000 + 60_000))
    assertNull(memory.files[PairingStore.STOPPED], "an empty list deletes the file")
  }

  @Test
  fun `a newer record for the same code and slot replaces the older, another slot's stays, and delete removes one`() {
    store.write(StoppedRecord.of(name, sid41, 1_000, 60))
    store.write(StoppedRecord.of(name.copy(slot = 2), sid41, 1_000, 60))
    store.write(StoppedRecord.of(name, sid42, 2_000, 60))
    assertEquals(sid42, store.stopped(name, 3_000)?.sid)
    assertEquals(2, memory.files.getValue(PairingStore.STOPPED).lines().size)
    store.delete("fx42hmnp7k2q", 1)
    assertNull(store.stopped(name, 3_000))
    assertEquals(sid41, store.stopped(name.copy(slot = 2), 3_000)?.sid)
  }

  @Test
  fun `an unreadable line is reported and skipped, never silent, and the readable one is still found`() {
    store.write(StoppedRecord.of(name, sid41, 1_000, 60))
    // After the readable line, each for this code and slot as `toInt` and `toLong` would read them,
    // so a reader that took a fraction would find the later one: a slot of 1.5, a stop at 1 000.5 ms.
    val fractions =
      listOf(
        "{\"code\":\"fx42hmnp7k2q\",\"slot\":1.5,\"sid\":\"$sid42\",\"stoppedAt\":1000,\"keepUntil\":3601000}",
        "{\"code\":\"fx42hmnp7k2q\",\"slot\":1,\"sid\":\"$sid42\",\"stoppedAt\":1000.5,\"keepUntil\":3601000}",
      )
    memory.files[PairingStore.STOPPED] =
      (listOf("not json", memory.files.getValue(PairingStore.STOPPED), "{\"code\":\"fx42hmnp7k2q\"}") + fractions).joinToString("\n")
    assertEquals(sid41, store.stopped(name, 2_000)?.sid)
    assertEquals(List(4) { "store-unreadable" }, problems.map { it.kind })
  }

  @Test
  fun `Task 11 gap 1 the lookup never throws - a refused prune still returns the record, and an unreadable store is none`() {
    store.write(StoppedRecord.of(name.copy(slot = 2), sid41, 1_000, 1))
    store.write(StoppedRecord.of(name, sid42, 1_000, 600))
    memory.refuseWrites = true
    assertEquals(sid42, store.stopped(name, 1_000 + 120_000)?.sid, "the slot-2 record lapsed; its prune is refused")
    assertEquals(listOf("store-failed" to "prune"), kinds())
    memory.readFailure = java.io.IOException("unreadable")
    assertNull(store.stopped(name, 1_000))
    assertEquals(listOf("store-failed" to "prune", "store-failed" to "read"), kinds())
  }
}
