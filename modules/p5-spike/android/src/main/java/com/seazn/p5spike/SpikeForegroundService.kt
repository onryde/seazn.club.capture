package com.seazn.p5spike

import android.app.Service
import android.content.Context
import android.content.Intent
import android.os.IBinder

class SpikeForegroundService : Service() {
  override fun onBind(intent: Intent?): IBinder? = null

  companion object {
    fun start(context: Context) = Unit
    fun stop(context: Context) = Unit
  }
}
