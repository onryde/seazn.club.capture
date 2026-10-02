package com.seazn.capture.engine.adapter

import com.seazn.capture.engine.core.Input
import com.seazn.capture.engine.core.PairingName
import com.seazn.capture.engine.core.PhoneFacts
import com.seazn.capture.engine.core.StoppedRecord

/**
 * An intent from JS → the core's input (AGENTS §2: intents, not RPC). Null: a kind this build does
 * not know. [phone] and [stopped] are the platform's, read by `BridgeCore` (Task 20).
 */
object IntentMapping {
  fun input(wire: Map<String, Any?>, phone: PhoneFacts, stopped: (PairingName) -> StoppedRecord?): Input? =
    when (wire["kind"]) {
      // A malformed pair is still a pair: the machine refuses it and names its problems (spec §5).
      "pair" -> PairMapping.request(wire).let { Input.Pair(it, phone, stopped(it.name)) }
      "start" -> Input.Start
      "stop" -> Input.Stop
      "unpair" -> Input.Unpair
      "reset" -> Input.Reset
      "setAutomatic" -> WireValues.flag(wire["on"])?.let { Input.SetAutomatic(it) }
      // (P3) "" when absent: the notification falls back to the phone's language, then English.
      "setLanguage" -> Input.SetLanguage(WireValues.text(wire["language"]))
      // Carry 10: reserved. S1 has no control for it; the platform swaps to the other facing camera.
      "switchCamera" -> Input.SwitchCamera
      else -> null
    }
}
