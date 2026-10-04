package com.seazn.capture.engine.adapter

import kotlin.test.Test
import kotlin.test.assertEquals

class OwnedSlotTest {
  @Test
  fun `CD32 the newer owner keeps the slot when the older one releases late`() {
    val slot = OwnedSlot<String>()
    val old = Any()
    val new = Any()
    slot.take(old, "old listener")
    slot.take(new, "new listener")
    slot.release(old)
    assertEquals("new listener", slot.value)
  }

  @Test
  fun `an owner's release clears its own value, and a release of an empty slot is harmless`() {
    val slot = OwnedSlot<String>()
    val only = Any()
    slot.release(only)
    assertEquals(null, slot.value)
    slot.take(only, "x")
    slot.release(only)
    assertEquals(null, slot.value)
  }
}
