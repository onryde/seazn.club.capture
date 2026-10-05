package com.seazn.capture.engine

import android.app.Service
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.IBinder
import androidx.core.app.ServiceCompat

/**
 * AGENTS §9: camera + microphone, started at pairing only after both are granted (A5, CD16), and
 * stopped only by the keeper at `Release` (C0b: the tick runs until the final beat releases it).
 * START_NOT_STICKY: never restarted by the system.
 */
class CaptureForegroundService : Service() {
  override fun onBind(intent: Intent?): IBinder? = null

  /**
   * Review C7 I-3: `startForeground` first, whatever comes after. A service started with
   * `startForegroundService` and stopped before it calls `startForeground` crashes the app (AOSP 14
   * `ActiveServices`: "did not then call startForeground"), so the keeper stops only a foreground one, and
   * one a Release came before stops itself here, once foreground.
   */
  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    val keeper = EngineHost.keeper(this)
    val held =
      try {
        ServiceCompat.startForeground(this, CaptureNotification.ID, keeper.notification(), TYPES)
        keeper.foregrounded()
      } catch (e: RuntimeException) { // SecurityException, ForegroundServiceStartNotAllowedException
        keeper.fgsRefused(e)
        false
      }
    // A refused start, or a Release that came before this start and could not stop it (I-3). Whether this stop
    // itself raises "did not then call startForeground": N10: proved by AOSP 14 source; device-unproved on 15/16.
    if (!held) stopSelf()
    return START_NOT_STICKY
  }

  companion object {
    /** Both types exist from API 30 (CD34: minSdk 31), and API 34+ requires them to match the manifest's `camera|microphone`. */
    private const val TYPES = ServiceInfo.FOREGROUND_SERVICE_TYPE_CAMERA or ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE
  }
}
