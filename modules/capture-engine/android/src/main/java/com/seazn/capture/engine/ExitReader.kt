package com.seazn.capture.engine

import android.app.ActivityManager
import android.content.Context
import com.seazn.capture.engine.adapter.PreviousExit
import com.seazn.capture.engine.core.RecordEntry
import java.io.File

/**
 * F-P5-3, CD22: was the last pairing lost with its process? Read once, at the engine's first build. The
 * keeper writes the marker at `Hold` and deletes it at `Release`, so a marker found here outlived its
 * process. `PreviousExit`'s word table matches android-36's `ApplicationExitInfo.REASON_*` 0..16 (javap).
 */
object ExitReader {
  fun previousLoss(context: Context): RecordEntry? {
    val marker = File(context.filesDir, PairingKeeper.MARKER)
    val present = marker.exists()
    // API 30; minSdk 31 (CD34).
    val info = context.getSystemService(ActivityManager::class.java)?.getHistoricalProcessExitReasons(context.packageName, 0, 1)?.firstOrNull()
    marker.delete()
    return PreviousExit.entry(present, info?.reason, info?.timestamp)
  }
}
