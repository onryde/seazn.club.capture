package com.seazn.capture.engine.endpoints

import com.seazn.capture.engine.adapter.CaptureClock
import com.seazn.capture.engine.core.RecordEntry
import io.github.thibaultbee.streampack.core.elements.utils.time.TimeUtils

/**
 * Carry 5: the last video frame's capture time on the wall clock. StreamPack stamps frames with
 * `TimeUtils.currentTime()` (uptime, in µs), so that is the clock read here. The first frame of each
 * attempt writes `capture-clock {lagMs}`: the device check reads it (Device-only claims).
 */
class CaptureClockLine(private val line: (RecordEntry) -> Unit) {
  @Volatile
  var lastVideoEpochMs: Long? = null
    private set

  @Volatile private var firstPending = false

  fun newAttempt() {
    firstPending = true
  }

  fun videoFrame(ptsUs: Long) {
    val wallNowMs = System.currentTimeMillis()
    val epochMs = CaptureClock.epochMs(ptsUs, TimeUtils.currentTime(), wallNowMs)
    lastVideoEpochMs = epochMs
    if (!firstPending) return
    firstPending = false
    line(RecordEntry("capture-clock", listOf("lagMs" to wallNowMs - epochMs)))
  }
}
