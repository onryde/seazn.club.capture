package com.seazn.capture.engine.core

import kotlin.test.Test
import kotlin.test.assertEquals

/** The server's word that a session is over, from the heartbeat or the descriptor (final review M-4). */
class SessionOverTest {
  @Test
  fun `final review M-4 a descriptor answer of 410, or a 2xx with a finished state, is over`() {
    assertEquals(DescriptorCheck.Over("stopped"), DescriptorCheck.answered(410, null, "stopped"))
    assertEquals(DescriptorCheck.Over("organiser"), DescriptorCheck.answered(410, "live", "organiser"))
    for (state in listOf("ending", "completed", "failed")) {
      assertEquals(DescriptorCheck.Over("organiser"), DescriptorCheck.answered(200, state, "organiser"), state)
    }
    assertEquals(DescriptorCheck.Over(null), DescriptorCheck.answered(299, "completed", null))
  }

  @Test
  fun `final review M-4 any other 2xx is live, and any other status is unreachable whatever its body says`() {
    assertEquals(DescriptorCheck.Live, DescriptorCheck.answered(200, "live", null))
    assertEquals(DescriptorCheck.Live, DescriptorCheck.answered(200, null, null))
    assertEquals(DescriptorCheck.Live, DescriptorCheck.answered(204, "warming", null))
    assertEquals(DescriptorCheck.Live, DescriptorCheck.answered(200, "ENDING", null))
    assertEquals(DescriptorCheck.Unreachable("HTTP 500"), DescriptorCheck.answered(500, "ending", "stopped"))
    assertEquals(DescriptorCheck.Unreachable("HTTP 404"), DescriptorCheck.answered(404, null, null))
    assertEquals(DescriptorCheck.Unreachable("HTTP 300"), DescriptorCheck.answered(300, "completed", null))
    assertEquals(DescriptorCheck.Unreachable("HTTP 199"), DescriptorCheck.answered(199, "failed", null))
  }

  @Test
  fun `final review M-4 the heartbeat and the descriptor judge every answer the same way`() {
    val statuses = listOf(199, 200, 204, 299, 300, 401, 404, 410, 500)
    val states = listOf(null, "live", "warming", "ending", "completed", "failed", "ENDING")
    var over = 0
    for (status in statuses) {
      for (state in states) {
        val beat = Heartbeat.answered(HeartbeatState(inFlightId = 1), 1, HeartbeatResponse.Answered(status, state, null)).second
        val descriptor = DescriptorCheck.answered(status, state, null) is DescriptorCheck.Over
        assertEquals(descriptor, beat, "$status $state")
        if (beat) over += 1
      }
    }
    // Counted by hand: 410 with each of the 7 states, and 200, 204 and 299 with each of the 3 finished ones.
    assertEquals(7 + 3 * 3, over)
  }
}
