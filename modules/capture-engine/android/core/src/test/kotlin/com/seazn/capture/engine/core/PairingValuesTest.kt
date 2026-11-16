package com.seazn.capture.engine.core

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlin.test.assertTrue

class PairingValuesTest {
  @Test
  fun `a pair request is named by code, slot and the token's tag, and never prints the token`() {
    val request = Configs.pairRequest()
    assertEquals(PairingName("fx42hmnp7k2q", 1, "b24bb97b"), request.name)
    assertTrue(Configs.TOKEN !in request.toString())
  }

  @Test
  fun `a pair request off the Seazn host, or with a blank code or token, has problems`() {
    val foreign = Configs.pairRequest(heartbeatUrl = "https://evil.io/beat", token = "")
    assertEquals(listOf("token is blank", "heartbeatUrl is not on stg.seazn.club"), foreign.problems())
    assertEquals(emptyList(), Configs.pairRequest().problems())
  }

  @Test
  fun `every field a pair request needs is checked, and slot 0 is a slot`() {
    // The server defaults `?slot=` to 0 (amendment, Contract shapes), so 0 is a real slot and -1 is not.
    val bad =
      PairRequest(
        code = " ",
        slot = -1,
        token = Configs.TOKEN,
        codeUrl = "https://evil.io/api/capture/codes/fx42hmnp7k2q",
        heartbeatUrl = "https://stg.seazn.club/api/capture/codes/fx42hmnp7k2q/beat",
        startUrl = "https://stg.seazn.club.evil.io/api/capture/codes/fx42hmnp7k2q/start",
        language = "en",
        automatic = false,
        claim = Claim.RESUME,
        environment = Environment.STAGING,
      )
    assertEquals(listOf("code is blank", "slot is below 0", "codeUrl is not the code's URL on stg.seazn.club", "startUrl is not on stg.seazn.club"), bad.problems())
    assertEquals(emptyList(), Configs.pairRequest(slot = 0).problems())
  }

  @Test
  fun `the server's end reasons map onto the phone's words, anything else is stopped`() {
    // The amendment's lastEnd table, row by row; phone_lost and failed are round 4's additions (ask 10, G0-f).
    val table =
      mapOf(
        "stopped" to LastEnd.STOPPED_BY_ORGANISER,
        "auto_stopped" to LastEnd.STOPPED_AUTOMATICALLY,
        "no_inbound_timeout" to LastEnd.NO_SIGNAL,
        "target_rejected" to LastEnd.DESTINATION_REFUSED,
        "max_duration" to LastEnd.MAX_DURATION,
        "phone_lost" to LastEnd.PHONE_LOST,
        "failed" to LastEnd.ENDED_BY_SEAZN,
        "something_new" to LastEnd.STOPPED,
      )
    for ((server, phone) in table) assertEquals(phone, LastEnd.of(server), server)
    assertEquals(LastEnd.STOPPED, LastEnd.of(null))
  }

  @Test
  fun `a refusal's code maps to its line, and an unknown code to the generic one`() {
    assertEquals(Refusal.NO_DESTINATION, Refusal.of("no_destination"))
    assertEquals(Refusal.NO_CREDIT, Refusal.of("no_credit"))
    assertEquals(Refusal.NOT_ENTITLED, Refusal.of("not_entitled"))
    assertEquals(Refusal.NO_MATCH, Refusal.of("no_match"))
    assertEquals(Refusal.UNKNOWN, Refusal.of("org_suspended"))
    assertEquals(Refusal.UNKNOWN, Refusal.of("start-failed"))
    assertEquals(Refusal.UNKNOWN, Refusal.of(null))
  }

  @Test
  fun `the record writes the pairing's words plain, even as bare strings`() {
    // A Wire value passes the scrub under any key; a String passes only under an allowed key. So each
    // new word is written here as the string its line will carry, or a dropped key would go unseen.
    val lines = mutableListOf<String>()
    val words =
      listOf(
        "claim" to "new",
        "tokenTag" to "c980ff38",
        "notReady" to "held",
        "startFailed" to "cred-host",
        "refusal" to "no_credit",
        "lastEnd" to "phone-lost",
        "side" to "left",
        "word" to "no-broadcast",
        "answer" to "waiting",
      )
    SessionRecord { lines += it }.append(1_790_000_000_000, RecordEntry("pairing", words))
    for ((key, value) in words) assertTrue(""""$key":"$value"""" in lines.single(), key)
  }

  @Test
  fun `go-live's startedBy names the cause, and nothing the server says reads as a rejoin`() {
    assertEquals(Cause.AUTOMATIC, Cause.startedBy("automatic"))
    assertEquals(Cause.OPERATOR, Cause.startedBy("operator"))
    assertEquals(Cause.ORGANISER, Cause.startedBy("organiser"))
    assertEquals(Cause.ORGANISER, Cause.startedBy("rejoin"))
    assertEquals(Cause.ORGANISER, Cause.startedBy(null))
  }

  // Court stream (spec 2026-11-14 §6.1, §5.3): the merge rules. A beat carries no court, and a descriptor no next.
  private val held = Configs.waiting().copy(courtName = "Court 2", next = NextMatch("A v B", 1_793_534_400))

  /** A beat's answer as Bodies reads it: no zone (D4), no court, and [next] as the beat said. */
  private fun beat(next: NextMatch?) = Configs.waiting().copy(venueTimezone = "", next = next)

  @Test
  fun `a beat keeps the held court, and its next replaces the held one - none clears it`() {
    val bare = beat(next = null)
    assertEquals("Court 2", bare.overBeat(held).courtName, "a beat carries no court")
    // A beat with no next clears it: the court has no next streamed match now.
    assertNull(bare.overBeat(held).next)
    val next = NextMatch("C v D", null)
    assertEquals(next, beat(next).overBeat(held).next)
    // Four questions (1): the same next twice leaves it unchanged, and a third beat without one clears it.
    val twice = beat(next).overBeat(beat(next).overBeat(held))
    assertEquals(next, twice.next)
    assertEquals("Court 2", twice.courtName)
    assertNull(bare.overBeat(twice).next)
    assertEquals("Court 2", bare.overBeat(twice).courtName)
    // A fixture's code: no court held, none after.
    assertNull(beat(next).overBeat(Configs.waiting()).courtName)
  }

  /**
   * P1 review M1: the schema bars `court` on every beat answer, so a beat that carries one anyway (an off-contract
   * server) never renames the court, nor makes a fixture's pairing a court's: a beat keeps the court (spec §5.3).
   */
  @Test
  fun `a beat that carries a court anyway keeps the held one`() {
    assertEquals("Court 2", beat(null).copy(courtName = "Court 9").overBeat(held).courtName)
    assertNull(beat(null).copy(courtName = "Court 9").overBeat(Configs.waiting()).courtName, "a fixture's pairing stays one")
  }

  @Test
  fun `a descriptor's court replaces the held one, its silence keeps it, and it keeps the held next`() {
    val descriptor = Configs.waiting().copy(venueTimezone = "Europe/Madrid")
    assertEquals("Court 3", descriptor.copy(courtName = "Court 3").over(held).courtName)
    // Never a fixture's code by silence: a court pairing stays one (spec §3).
    assertEquals("Court 2", descriptor.over(held).courtName)
    // A descriptor never carries next (capture-descriptor.v1): the beat's stands. Four questions (3): at a reconnect too.
    assertEquals(NextMatch("A v B", 1_793_534_400), descriptor.over(held).next)
    assertEquals(NextMatch("A v B", 1_793_534_400), descriptor.copy(next = NextMatch("X v Y", null)).over(held).next)
    // The zone rule is as before: the descriptor's zone replaces the held one, and an empty one keeps it.
    assertEquals("Europe/Madrid", descriptor.over(held).venueTimezone)
    assertEquals("Europe/London", descriptor.copy(venueTimezone = "").over(held).venueTimezone)
  }
}
