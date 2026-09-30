package com.seazn.capture.engine.core

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

class DescriptorAsksTest {
  @Test
  fun `the first ask may go at once, and takes the next id`() {
    val asks = DescriptorAsks(nextId = 7)
    assertTrue(asks.mayAsk(0))
    val (asked, id) = asks.asked(1_000)
    assertEquals(7, id)
    assertEquals(DescriptorAsks(nextId = 8, inFlightId = 7, lastAskAtMs = 1_000), asked)
  }

  @Test
  fun `B6 ruling C1 an answered ask still spaces the next by 10 s`() {
    val answered = DescriptorAsks().asked(1_000).first.answered(1)!!
    assertFalse(answered.mayAsk(10_999))
    assertTrue(answered.mayAsk(11_000))
  }

  @Test
  fun `B6 ruling C1 an ask in flight blocks the next until it is given up at 30 s`() {
    val inFlight = DescriptorAsks().asked(1_000).first
    assertFalse(inFlight.mayAsk(11_000), "10 s on, but the first has not answered")
    assertFalse(inFlight.mayAsk(30_999))
    assertTrue(inFlight.mayAsk(31_000), "a lost answer never stops the asks for good")
  }

  @Test
  fun `B6 review I2 only the ask in flight is answered, and only once`() {
    val (first, one) = DescriptorAsks().asked(0)
    val (second, two) = first.asked(500)
    assertNull(second.answered(one), "superseded by the later ask")
    assertNull(DescriptorAsks().answered(1), "nobody asked")
    val answered = second.answered(two)!!
    assertNull(answered.inFlightId)
    assertNull(answered.answered(two), "a second answer to the same ask")
  }

  @Test
  fun `a given-up ask's late answer still counts until a newer ask supersedes it`() {
    val (asked, id) = DescriptorAsks().asked(0)
    assertTrue(asked.mayAsk(30_000))
    assertEquals(asked.copy(inFlightId = null), asked.answered(id))
  }
}
