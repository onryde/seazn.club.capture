package com.seazn.capture.engine.core

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

class PairingValuesTest {
  @Test
  fun `a pair request is named by code, slot and the token's tag, and never prints the token`() {
    val request = Configs.pairRequest()
    assertEquals(PairingName("fx-42", 1, "c980ff38"), request.name)
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
        codeUrl = "https://evil.io/api/capture/codes/fx-42",
        heartbeatUrl = "https://stg.seazn.club/api/capture/codes/fx-42/beat",
        startUrl = "https://stg.seazn.club.evil.io/api/capture/codes/fx-42/start",
        language = "en",
        automatic = false,
        claim = Claim.RESUME,
        environment = Environment.STAGING,
      )
    assertEquals(listOf("code is blank", "slot is below 0", "codeUrl is not on stg.seazn.club", "startUrl is not on stg.seazn.club"), bad.problems())
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
}
