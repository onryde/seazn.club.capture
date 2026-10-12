package com.seazn.capture.engine.core

/**
 * R5 and N27 of the D3 findings design, M5 of the Batch 5 review (the controller's ruling, 2026-10-12): the app's
 * battery mode in the words Android's App battery usage page uses. Unrestricted when the app is exempt from battery
 * optimisation; else Restricted when its background is restricted; else Optimized, Android's default. Null when a
 * reading it needs is unknown: a guess would put a locked failure down to the wrong mode. The bridge sends the word
 * (`powerMode`) and the record writes it under `mode` at every pairing's hold.
 */
object PowerMode {
  const val UNRESTRICTED = "unrestricted"
  const val OPTIMIZED = "optimized"
  const val RESTRICTED = "restricted"

  fun of(ignoringOptimizations: Boolean?, backgroundRestricted: Boolean?): String? =
    when {
      ignoringOptimizations == true -> UNRESTRICTED
      ignoringOptimizations == null || backgroundRestricted == null -> null
      backgroundRestricted -> RESTRICTED
      else -> OPTIMIZED
    }
}
