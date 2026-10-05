package com.seazn.capture.engine.watch

import android.content.Context
import android.hardware.Sensor
import android.hardware.SensorEvent
import android.hardware.SensorEventListener
import android.hardware.SensorManager
import android.os.Handler
import android.os.HandlerThread
import android.os.SystemClock
import com.seazn.capture.engine.adapter.HeldPose
import com.seazn.capture.engine.adapter.PoseTracker
import com.seazn.capture.engine.core.Pose
import com.seazn.capture.engine.core.RecordEntry
import com.seazn.capture.engine.core.Side

/**
 * A11: how the phone is held, with JS's rule (Task 17's `HeldPose`, one vector file), from `Hold` to
 * `Release`. The accelerometer alone, never the screen. Its own thread: sensor callbacks never run on the
 * scheduler thread or the main looper. No accelerometer never blocks: `NoSensor`, and the record says so.
 */
class PoseWatch(private val context: Context, private val pose: (Pose) -> Unit, private val line: (RecordEntry) -> Unit) : SensorEventListener {
  private val thread = HandlerThread("capture-pose").apply { start() }

  /** PV40: replaced by `start` on the scheduler thread, read on the pose thread. */
  @Volatile private var tracker = PoseTracker()

  @Volatile private var held: Side = Side.LEFT

  /** The side the build rotates to (CD42): the last side held, `LEFT` before any (A11's default). */
  fun side(): Side = held

  /** A second `Hold` replaces the tracker, a fresh hold, and registers nothing twice (Android keeps one). */
  @Synchronized
  fun start() {
    val manager = context.getSystemService(SensorManager::class.java)
    val sensor = manager?.getDefaultSensor(Sensor.TYPE_ACCELEROMETER)
    if (manager == null || sensor == null) {
      line(HeldPose.NO_SENSOR)
      return pose(Pose.NoSensor)
    }
    tracker = PoseTracker()
    manager.registerListener(this, sensor, SensorManager.SENSOR_DELAY_UI, Handler(thread.looper))
  }

  /** Unregisters this listener, if it is registered; with none, nothing. */
  @Synchronized
  fun stop() {
    context.getSystemService(SensorManager::class.java)?.unregisterListener(this)
  }

  /** In g, as the vector file is: Android reports m/s², as Float, and the rule reads Double (Task 17). */
  override fun onSensorChanged(event: SensorEvent) {
    val g = SensorManager.GRAVITY_EARTH.toDouble()
    val (x, y, z) = Triple(event.values[0] / g, event.values[1] / g, event.values[2] / g)
    val changed = tracker.sample(x, y, z, SystemClock.elapsedRealtime()) ?: return
    if (changed is Pose.Held) held = changed.side
    pose(changed)
  }

  override fun onAccuracyChanged(sensor: Sensor?, accuracy: Int) = Unit
}
