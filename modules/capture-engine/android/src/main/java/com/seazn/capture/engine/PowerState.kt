package com.seazn.capture.engine

import android.content.Context
import android.os.PowerManager

/**
 * R5, N27 of the D3 findings design: whether this app is exempt from battery optimisation (the app's battery page's
 * Unrestricted), read at once; null when it cannot be read. The read needs no permission.
 */
object PowerState {
  fun unrestricted(context: Context): Boolean? =
    runCatching { context.getSystemService(PowerManager::class.java)?.isIgnoringBatteryOptimizations(context.packageName) }.getOrNull()
}
