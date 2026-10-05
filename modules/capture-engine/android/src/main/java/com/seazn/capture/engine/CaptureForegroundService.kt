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

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    val keeper = EngineHost.keeper(this)
    try {
      ServiceCompat.startForeground(this, CaptureNotification.ID, keeper.notification(), TYPES)
    } catch (e: RuntimeException) { // SecurityException, ForegroundServiceStartNotAllowedException
      keeper.fgsRefused(e)
      stopSelf() // N10: whether this itself raises "did not then call startForeground" is unproved (Task 40)
    }
    return START_NOT_STICKY
  }

  companion object {
    /** Both types exist from API 30 (CD34: minSdk 31), and API 34+ requires them to match the manifest's `camera|microphone`. */
    private const val TYPES = ServiceInfo.FOREGROUND_SERVICE_TYPE_CAMERA or ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE
  }
}
