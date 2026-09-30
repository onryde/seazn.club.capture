package com.seazn.capture.engine.core

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class FallbackPolicyTest {
  private val start = FallbackPolicy(Transport.SRT, Transport.RTMPS)

  private fun FallbackPolicy.failConnect(times: Int, failure: ConnectFailure = ConnectFailure.TIMEOUT, validated: Boolean = true) =
    (1..times).fold(this) { policy, _ -> policy.connectFailed(failure, validated).policy }

  @Test
  fun `C1 three validated connect failures fall back to RTMPS`() {
    val twice = start.failConnect(2)
    assertEquals(Transport.SRT, twice.current)
    val third = twice.connectFailed(ConnectFailure.TIMEOUT, networkValidated = true)
    assertTrue(third.fellBack)
    assertEquals(Transport.RTMPS, third.policy.current)
    assertTrue(third.policy.fellBack)
  }

  @Test
  fun `F-P5-1 a failure on a network that is not validated does not count`() {
    // The 20 s cut: "retries every 2 s failed on DNS with validated=false, so none counted".
    val policy = start.failConnect(9, validated = false)
    assertEquals(Transport.SRT, policy.current)
    assertEquals(0, policy.count)
  }

  @Test
  fun `F-P5-1 an unresolved host does not count even on a validated network`() {
    assertFalse(start.connectFailed(ConnectFailure.UNRESOLVED, networkValidated = true).counted)
    // Nine is past three: counted, they would have fallen back (and the count reset with it).
    val policy = start.failConnect(9, ConnectFailure.UNRESOLVED, validated = true)
    assertEquals(Transport.SRT, policy.current)
    assertEquals(0, policy.count)
  }

  @Test
  fun `F-P5-2 mid-session drops count toward fallback`() {
    // Redmi on weak wifi: 18 drops every 6–22 s, always endpoint-closed.
    var policy = start
    for (publishedMs in listOf(6_000L, 22_000L)) {
      val decision = policy.dropped(DropReason.ENDPOINT_CLOSED, networkValidated = true, publishedMs = publishedMs)
      assertTrue(decision.counted)
      policy = decision.policy
    }
    val third = policy.dropped(DropReason.ENDPOINT_CLOSED, networkValidated = true, publishedMs = 10_000)
    assertTrue(third.fellBack)
    assertEquals(Transport.RTMPS, third.policy.current)
  }

  @Test
  fun `connect failures and short drops count toward the same three`() {
    val policy = start.failConnect(2)
    assertTrue(policy.dropped(DropReason.ENDPOINT_CLOSED, true, publishedMs = 8_000).fellBack)
  }

  @Test
  fun `F-P5-13 a far-end close 31 s after connecting does not count, and clears the count`() {
    val two = start.failConnect(2)
    val decision = two.dropped(DropReason.ENDPOINT_CLOSED, networkValidated = true, publishedMs = 31_000)
    assertFalse(decision.counted)
    assertEquals(0, decision.policy.count)
  }

  @Test
  fun `inputs-stopped and requested drops never count`() {
    for (reason in listOf(DropReason.INPUTS_STOPPED, DropReason.REQUESTED)) {
      assertFalse(start.dropped(reason, networkValidated = true, publishedMs = 1_000).counted)
    }
  }

  @Test
  fun `a drop while the network is not validated does not count`() {
    assertFalse(start.dropped(DropReason.ENDPOINT_CLOSED, networkValidated = false, publishedMs = 6_000).counted)
  }

  @Test
  fun `the fallback is final for the session`() {
    val fell = start.failConnect(3)
    val after = fell.failConnect(10)
    assertEquals(Transport.RTMPS, after.current)
    assertEquals(0, after.count)
  }

  @Test
  fun `with no fallback transport nothing counts`() {
    val alone = FallbackPolicy(Transport.SRT, fallback = null).failConnect(5)
    assertEquals(Transport.SRT, alone.current)
    assertEquals(0, alone.count)
  }

  @Test
  fun `a code that prefers RTMPS falls back to SRT by the same rule`() {
    val policy = FallbackPolicy(Transport.RTMPS, Transport.SRT).failConnect(3)
    assertEquals(Transport.SRT, policy.current)
  }
}
