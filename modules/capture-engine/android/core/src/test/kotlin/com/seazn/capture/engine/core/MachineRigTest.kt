package com.seazn.capture.engine.core

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith

/** The rig's own guards: a fake that lets time run backwards would let a test assert an order no phone can produce. */
class MachineRigTest {
  @Test
  fun `the rig refuses to move time backwards`() {
    val rig = MachineRig()
    rig.at(1_000)
    val error = assertFailsWith<IllegalArgumentException> { rig.at(999) }
    assertEquals("at(999): time never runs backwards from 1000", error.message)
    assertEquals(Now(1_000, 1_790_000_001_000), rig.now)
  }

  @Test
  fun `moving time to now is legal and changes nothing`() {
    val rig = MachineRig()
    rig.at(1_000)
    rig.at(1_000)
    assertEquals(Now(1_000, 1_790_000_001_000), rig.now)
  }
}
