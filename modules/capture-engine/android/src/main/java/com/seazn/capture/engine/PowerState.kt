package com.seazn.capture.engine

import android.app.ActivityManager
import android.content.Context
import android.os.PowerManager
import com.seazn.capture.engine.core.PowerMode

/**
 * R5, N27 of the D3 findings design; M5 of the Batch 5 review: the app's battery mode, read at once from Android's two
 * readings (the exemption from battery optimisation, and background restriction, API 28) by core's [PowerMode] rule;
 * null when it cannot be read. Neither read needs a permission.
 */
object PowerState {
  fun mode(context: Context): String? =
    PowerMode.of(
      runCatching { context.getSystemService(PowerManager::class.java)?.isIgnoringBatteryOptimizations(context.packageName) }.getOrNull(),
      runCatching { context.getSystemService(ActivityManager::class.java)?.isBackgroundRestricted }.getOrNull(),
    )
}
