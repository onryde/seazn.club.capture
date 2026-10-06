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
 * `Release`. The accelerometer alone, never the screen. Its own thread: sensor callbacks, and the register
 * and unregister binder calls (review C7 I-4, CD9), never run on the scheduler thread or the main looper.
 * No accelerometer never blocks: `NoSensor`, and the record says so.
 */
class PoseWatch(private val context: Context, private val pose: (Pose) -> Unit, private val line: (RecordEntry) -> Unit) : SensorEventListener {
  private val thread = HandlerThread("capture-pose").apply { start() }
  private val handler = Handler(thread.looper)

  /** PV40: replaced by [register] and read by the callbacks, both on the pose thread since review C7 I-4; kept volatile. */
  @Volatile private var tracker = PoseTracker()

  @Volatile private var held: Side = Side.LEFT

  /** The side the build rotates to (CD42): the last side held, `LEFT` before any (A11's default). */
  fun side(): Side = held

  /** `Hold`, on the scheduler thread: the register is posted to the pose thread (I-4); returns at once. */
  fun start() {
    held = Side.LEFT // review C7 M-10: a new pairing's build never encodes the last pairing's side
    handler.post { guarded("pose-start") { register() } }
  }

  /** `Release`, on the scheduler thread: posted behind any start, so it unregisters what that registered (I-4). */
  fun stop() {
    handler.post { guarded("pose-stop") { unregister() } }
  }

  /** A second `Hold` replaces the tracker, a fresh hold, and registers nothing twice (Android keeps one). Pose thread. */
  private fun register() {
    val manager = context.getSystemService(SensorManager::class.java)
    val sensor = manager?.getDefaultSensor(Sensor.TYPE_ACCELEROMETER)
    if (manager == null || sensor == null) {
      line(HeldPose.NO_SENSOR)
      return pose(Pose.NoSensor)
    }
    tracker = PoseTracker()
    manager.registerListener(this, sensor, SensorManager.SENSOR_DELAY_UI, handler)
  }

  /** Unregisters this listener, if it is registered; with none, nothing. Pose thread. */
  private fun unregister() {
    context.getSystemService(SensorManager::class.java)?.unregisterListener(this)
  }

  /** A throw on the pose thread would end the process: it costs a line instead. */
  private fun guarded(action: String, block: () -> Unit) {
    try {
      block()
    } catch (e: Exception) {
      line(RecordEntry("watch-failed", listOf("action" to action, "error" to e.javaClass.simpleName)))
    }
  }

  /** Review C7 M-8: the sensor's callback, guarded like the posted steps. */
  override fun onSensorChanged(event: SensorEvent) = guarded("pose") { sensed(event) }

  /** In g, as the vector file is: Android reports m/s², as Float, and the rule reads Double (Task 17). */
  private fun sensed(event: SensorEvent) {
    val g = SensorManager.GRAVITY_EARTH.toDouble()
    val (x, y, z) = Triple(event.values[0] / g, event.values[1] / g, event.values[2] / g)
    val changed = tracker.sample(x, y, z, SystemClock.elapsedRealtime()) ?: return
    if (changed is Pose.Held) held = changed.side
    pose(changed)
  }

  override fun onAccuracyChanged(sensor: Sensor?, accuracy: Int) = Unit
}
