package com.seazn.capture.engine

import android.os.SystemClock
import com.seazn.capture.engine.core.Clock

object AndroidClock : Clock {
  override fun monotonicMs(): Long = SystemClock.elapsedRealtime()

  override fun wallMs(): Long = System.currentTimeMillis()
}
