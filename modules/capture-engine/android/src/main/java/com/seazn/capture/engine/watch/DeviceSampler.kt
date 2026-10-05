package com.seazn.capture.engine.watch

import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.os.BatteryManager
import android.os.PowerManager
import android.os.SystemClock
import com.seazn.capture.engine.adapter.ChargeDrain
import com.seazn.capture.engine.adapter.DeviceReadings
import com.seazn.capture.engine.adapter.RawDevice
import com.seazn.capture.engine.core.Input
import com.seazn.capture.engine.core.RecordEntry
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

/** Thermal and battery every 10 s, on its own thread: binder calls never run on the scheduler thread (CD9). */
class DeviceSampler(
  private val context: Context,
  private val report: (Input) -> Unit,
  private val line: (RecordEntry) -> Unit,
) {
  private val io = Executors.newSingleThreadScheduledExecutor { task -> Thread(task, "capture-device") }

  @Volatile private var drain = ChargeDrain()

  /**
   * N9: the first failure in the process is recorded; later ones are not, so a sampler that always fails
   * cannot flood the record. Touched only on the sampler's own thread.
   */
  private var failureNoted = false

  fun start() {
    io.scheduleWithFixedDelay({ sample() }, 0, PERIOD_S, TimeUnit.SECONDS)
  }

  /** A new drain at each pairing's `Hold`: drain is per pairing, the span the phone waits and works. */
  fun paired() {
    drain = ChargeDrain()
  }

  /** The drain is read once, so a `Hold` landing mid-sample never splits one sample across two drains. */
  private fun sample() {
    val counting = drain
    try {
      report(Input.Device(DeviceReadings.sample(read(counting), counting)))
    } catch (e: Exception) {
      // A failed reading skips one sample; the next comes in 10 s. Never stops the executor.
      if (!failureNoted) {
        failureNoted = true
        line(RecordEntry("watch-failed", listOf("action" to "device", "error" to e.javaClass.simpleName)))
      }
    }
  }

  /** `DeviceReadings.sample` only reads the drain (Task 17), so this `add` is the one place a sample is counted. */
  private fun read(counting: ChargeDrain): RawDevice {
    val power = context.getSystemService(PowerManager::class.java)
    val battery = context.getSystemService(BatteryManager::class.java)
    val sticky = context.registerReceiver(null, IntentFilter(Intent.ACTION_BATTERY_CHANGED))
    val raw =
      RawDevice(
        thermalStatus = power?.currentThermalStatus, // API 29; minSdk 31 (CD34)
        thermalHeadroom = power?.getThermalHeadroom(HEADROOM_FORECAST_S), // API 30
        batteryPercent = battery?.getIntProperty(BatteryManager.BATTERY_PROPERTY_CAPACITY)?.takeIf { it in 0..100 },
        chargeUah = battery?.getLongProperty(BatteryManager.BATTERY_PROPERTY_CHARGE_COUNTER)?.takeIf { it > 0 },
        plugged = sticky?.getIntExtra(BatteryManager.EXTRA_PLUGGED, -1)?.takeIf { it >= 0 }?.let { it != 0 },
      )
    counting.add(SystemClock.elapsedRealtime(), raw.chargeUah, raw.batteryPercent)
    return raw
  }

  private companion object {
    const val PERIOD_S = 10L
    const val HEADROOM_FORECAST_S = 10
  }
}
