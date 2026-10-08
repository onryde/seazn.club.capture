package com.seazn.capture.engine.adapter

import com.seazn.capture.engine.core.Claim
import com.seazn.capture.engine.core.Environment
import com.seazn.capture.engine.core.PairRequest
import com.seazn.capture.engine.core.characters

/**
 * The pair intent's wire → [PairRequest]. Lenient on purpose: a missing or mistyped field becomes a
 * blank or -1 that [PairRequest.problems] names, so a bad pair is refused, recorded and named, never
 * thrown at the bridge (spec §5).
 */
object PairMapping {
  fun request(wire: Map<String, Any?>): PairRequest =
    PairRequest(
      code = WireValues.text(wire["code"]),
      slot = WireValues.int(wire["slot"]) ?: -1,
      token = WireValues.text(wire["token"]),
      codeUrl = WireValues.text(wire["codeUrl"]),
      heartbeatUrl = WireValues.text(wire["heartbeatUrl"]),
      startUrl = WireValues.text(wire["startUrl"]),
      // (P3) The operator's language, for the notification only (CD16). "" when absent: the phone's, then English.
      language = WireValues.text(wire["language"]),
      // A4: the Settings switch is on unless the operator turned it off.
      automatic = WireValues.flag(wire["automatic"]) ?: true,
      // Absent or unknown is `resume` (controller ruling, review 11 I1): JS always names the claim, so a
      // lost word is a bug, and it takes the safe side. A `resume` never takes the slot from a newer
      // pairing (amendment, _Pairing, takeover and rejoin_); only a scan's own `new` can.
      claim = Claim.entries.firstOrNull { it.wire == wire["claim"] } ?: Claim.RESUME,
      // CD36: anything but `production` is staging, so a forgotten variable refuses a club's real codes.
      environment = Environment.of(wire["environment"] as? String),
      // The zone from the code's GET at the scan. Display only, so it never refuses a pair: outside the
      // schema's 1 to 64 characters, or absent, it is "" and the first descriptor or beat that has one sets it.
      venueTimezone = WireValues.text(wire["venueTimezone"]).takeIf { it.characters in 1..64 } ?: "",
      // The round line the scan's GET gave, with the match label it belongs to. Display only: outside 1 to 40
      // characters, or without its match, it is none, and never refuses a pair. JS read the kind rule at the scan.
      stageLabel = WireValues.text(wire["stageLabel"]).takeIf { it.characters in 1..40 && WireValues.text(wire["stageMatch"]).isNotEmpty() },
      stageMatch = WireValues.text(wire["stageMatch"]).takeIf { it.isNotEmpty() && WireValues.text(wire["stageLabel"]).characters in 1..40 },
    )
}
