package com.seazn.capture.engine.adapter

import com.seazn.capture.engine.core.Claim
import com.seazn.capture.engine.core.Environment
import com.seazn.capture.engine.core.PairRequest

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
      // A9: a word this build does not know claims as a scan does, never as a resume.
      claim = Claim.entries.firstOrNull { it.wire == wire["claim"] } ?: Claim.NEW,
      // CD36: anything but `production` is staging, so a forgotten variable refuses a club's real codes.
      environment = Environment.of(wire["environment"] as? String),
    )
}
