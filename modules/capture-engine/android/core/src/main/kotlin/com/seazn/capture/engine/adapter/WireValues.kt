package com.seazn.capture.engine.adapter

/** Reading a bridge value that may be missing or of the wrong type. Never throws. */
object WireValues {
  /**
   * Expo hands every JS number over as a Double (expo-modules-core 57.0.20, `FrontendConverter.cpp`'s
   * `AnyFrontendConvert`). Only a whole number that fits an Int is one: the one test is that it comes
   * back from its Int unchanged. `toInt()` drops a fraction, saturates past Int's edges and reads NaN
   * as 0, so a fraction, a number past either edge, an infinity and NaN each come back different.
   */
  fun int(value: Any?): Int? =
    when (value) {
      is Int -> value
      is Long -> value.toInt().takeIf { it.toLong() == value }
      is Double -> value.toInt().takeIf { it.toDouble() == value }
      else -> null
    }

  fun text(value: Any?): String = value as? String ?: ""

  fun flag(value: Any?): Boolean? = value as? Boolean
}
