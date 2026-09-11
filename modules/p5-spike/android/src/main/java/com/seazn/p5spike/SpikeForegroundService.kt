package com.seazn.p5spike

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.IBinder
import android.os.PowerManager
import androidx.core.app.NotificationCompat
import androidx.core.app.ServiceCompat
import androidx.core.content.ContextCompat

/**
 * AGENTS.md §9: camera + microphone foreground service, started from the
 * foreground. The wake lock is part of what P5 measures — record whether
 * publishing survives screen-off with it, and try one lock cycle without it.
 */
class SpikeForegroundService : Service() {
  private var wakeLock: PowerManager.WakeLock? = null

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    val notifications = getSystemService(NotificationManager::class.java)
    notifications.createNotificationChannel(
      NotificationChannel(CHANNEL, "P5 spike", NotificationManager.IMPORTANCE_LOW),
    )
    val notification = NotificationCompat.Builder(this, CHANNEL)
      .setContentTitle("P5 spike")
      .setContentText("Publishing")
      .setSmallIcon(android.R.drawable.presence_video_online)
      .setOngoing(true)
      .build()
    ServiceCompat.startForeground(
      this,
      NOTIFICATION_ID,
      notification,
      ServiceInfo.FOREGROUND_SERVICE_TYPE_CAMERA or ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE,
    )
    if (wakeLock == null) {
      wakeLock = getSystemService(PowerManager::class.java)
        .newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "p5spike:publish")
        .apply { acquire() }
    }
    SpikeSession.event("service-started")
    return START_NOT_STICKY
  }

  override fun onDestroy() {
    wakeLock?.release()
    wakeLock = null
    SpikeSession.event("service-stopped")
    super.onDestroy()
  }

  companion object {
    private const val CHANNEL = "p5-spike"
    private const val NOTIFICATION_ID = 7105

    fun start(context: Context) {
      ContextCompat.startForegroundService(context, Intent(context, SpikeForegroundService::class.java))
    }

    fun stop(context: Context) {
      context.stopService(Intent(context, SpikeForegroundService::class.java))
    }
  }
}
