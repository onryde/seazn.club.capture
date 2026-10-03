package com.seazn.capture.engine.adapter

import com.seazn.capture.engine.core.BeatBounds
import com.seazn.capture.engine.core.DeviceSample
import com.seazn.capture.engine.core.ShedStep
import java.nio.ByteBuffer
import java.nio.ByteOrder
import kotlin.math.abs

/**
 * CD28: 16-bit little-endian PCM, StreamPack's default capture format. Reads a duplicate: the
 * encoder's buffer is never moved. The largest magnitude, 32 768 (`Short.MIN_VALUE`), is full scale,
 * so the peak runs 0 to 1.
 */
object PcmPeak {
  private const val FULL_SCALE = 32_768.0

  fun of(buffer: ByteBuffer): Double {
    val view = buffer.duplicate().order(ByteOrder.LITTLE_ENDIAN)
    var peak = 0
    while (view.remaining() >= 2) peak = maxOf(peak, abs(view.short.toInt()))
    return peak / FULL_SCALE
  }
}

/**
 * Written on the audio thread, taken on the scheduler thread at each snapshot. A level that is not
 * finite is no reading: an infinite one would pass the sound check (`Readiness.sound`) on nothing.
 */
class PeakMeter {
  private var peak = 0.0

  @Synchronized
  fun offer(level: Double) {
    if (level.isFinite() && level > peak) peak = level
  }

  @Synchronized fun take(): Double = peak.also { peak = 0.0 }
}

/**
 * P5: the battery percentage is too coarse for drain, and the charge counter (µAh) is not. The full
 * charge is estimated from the baseline: the first sample with both a counter and a percent of 1 to
 * 100. A counter of 0 or less is the platform's "unsupported" (0, or `Long.MIN_VALUE` from API 28).
 */
class ChargeDrain {
  private var first: Pair<Long, Long>? = null
  private var latest: Pair<Long, Long>? = null
  private var fullUah = 0.0

  fun add(monoMs: Long, chargeUah: Long?, percent: Int?) {
    if (chargeUah == null || chargeUah <= 0) return
    if (first == null) {
      val whole = percent?.takeIf { it in 1..100 } ?: return
      first = monoMs to chargeUah
      fullUah = chargeUah * 100.0 / whole
    }
    latest = monoMs to chargeUah
  }

  fun pctPerHour(): Double? {
    val (t0, c0) = first ?: return null
    val (t1, c1) = latest ?: return null
    val elapsed = t1 - t0
    if (elapsed < MIN_WINDOW_MS || c1 > c0) return null
    return (c0 - c1) / fullUah * 100.0 * (3_600_000.0 / elapsed)
  }

  companion object {
    /** Judgment: a shorter window reads the counter's own steps as drain. Measured on the device gate's phones (Task 40). */
    const val MIN_WINDOW_MS = 300_000L
  }
}

object Thermal {
  /** `PowerManager.THERMAL_STATUS_*` is 0–6, the beat's bound too; anything else is no reading. */
  fun status(raw: Int?): Int? = raw?.takeIf { it in 0..6 }

  /** API 30's `getThermalHeadroom` returns NaN when it has no forecast; P5's Redmi read −1. 0 is no throttling. */
  fun headroom(raw: Float?): Double? = raw?.takeIf { it.isFinite() && it >= 0f }?.toDouble()

  /** CD20: moderate sheds the overlay preview, severe the preview frame rate, critical and worse the encode. */
  fun shed(status: Int?): ShedStep? =
    when (status) {
      2 -> ShedStep.OVERLAY_PREVIEW
      3 -> ShedStep.PREVIEW_FRAMERATE
      4, 5, 6 -> ShedStep.ENCODE
      else -> null
    }
}

/**
 * What the glue reads from Android, unjudged. Null is unread: `plugged` from the battery intent's
 * `EXTRA_PLUGGED`, `chargeUah` from `BATTERY_PROPERTY_CHARGE_COUNTER`, which the glue also adds to
 * the [ChargeDrain] with the monotonic time.
 */
data class RawDevice(val thermalStatus: Int?, val thermalHeadroom: Float?, val batteryPercent: Int?, val chargeUah: Long?, val plugged: Boolean?)

/**
 * The device sample, each fact within `capture-beat.v1`'s bound (web 09e87aabd, R1) or null: one bad
 * reading is no reading, never a 422, and an unread battery is null, never 0 (D2, D14).
 */
object DeviceReadings {
  private val PERCENT = 0..100

  fun sample(raw: RawDevice, drain: ChargeDrain): DeviceSample {
    val status = Thermal.status(raw.thermalStatus)
    return DeviceSample(
      thermalStatus = status,
      thermalHeadroom = Thermal.headroom(raw.thermalHeadroom),
      batteryPercent = raw.batteryPercent?.takeIf { it in PERCENT },
      charging = raw.plugged,
      // Bounded as it crosses: rounded to tenths first, as the beat writes it.
      drainPctPerHour = drain.pctPerHour()?.let { Math.round(it * 10) / 10.0 }?.takeIf { it in BeatBounds.DRAIN_PCT_PER_HOUR },
      shed = Thermal.shed(status),
    )
  }
}

/** Spec §2's capture timestamp: a frame's pts (the monotonic capture clock, µs) placed on the wall clock. */
object CaptureClock {
  fun epochMs(ptsUs: Long, monoNowUs: Long, wallNowMs: Long): Long = wallNowMs - (monoNowUs - ptsUs) / 1_000
}
