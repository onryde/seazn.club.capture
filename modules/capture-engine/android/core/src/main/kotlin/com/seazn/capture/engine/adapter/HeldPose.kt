package com.seazn.capture.engine.adapter

import com.seazn.capture.engine.core.Pose
import com.seazn.capture.engine.core.RecordEntry
import com.seazn.capture.engine.core.Side
import kotlin.math.PI
import kotlin.math.abs
import kotlin.math.atan2
import kotlin.math.sqrt

enum class Physical(val wire: String) {
  PORTRAIT("portrait"),
  LANDSCAPE("landscape"),
  FLAT("flat"),
  UNKNOWN("unknown"),
}

/** A settled or candidate reading. [side] is set only for [Physical.LANDSCAPE]. */
data class PoseReading(val physical: Physical, val side: Side?)

/**
 * A11: JS's pose rule (`src/domain/orientation/orientation.ts` `classify`), with the side it folds
 * away. Both pass `modules/capture-engine/src/wire/pose-vectors.json`, row by row.
 */
object HeldPose {
  const val HOLD_MS = 300L
  private const val LANDSCAPE_FROM_DEG = 60.0
  private const val PORTRAIT_UNDER_DEG = 30.0
  private const val FLAT_ABOVE_Z_SHARE = 0.94
  private const val HELD_BELOW_Z_SHARE = 0.87
  private const val MIN_MAGNITUDE_G = 0.3

  /** The record's line when the phone has no accelerometer: held reads ready, the side [Side.LEFT]. */
  val NO_SENSOR = RecordEntry("no-accelerometer")

  /**
   * Gravity in g (the glue divides `SensorEvent.values` by `SensorManager.GRAVITY_EARTH`). Null is the
   * dead band. A value that is not finite is no reading, so it is the dead band too: it never crosses
   * as a pose. (JS's `classify` is never handed one: JSON cannot carry it, and expo-sensors' values
   * come from the same sensor.)
   */
  fun classify(x: Double, y: Double, z: Double): PoseReading? {
    if (!x.isFinite() || !y.isFinite() || !z.isFinite()) return null
    val magnitude = hypot(x, y, z)
    if (magnitude < MIN_MAGNITUDE_G) return PoseReading(Physical.UNKNOWN, null)
    val zShare = abs(z) / magnitude
    if (zShare > FLAT_ABOVE_Z_SHARE) return PoseReading(Physical.FLAT, null)
    if (zShare >= HELD_BELOW_Z_SHARE) return null
    // JS's `(Math.atan2(...) * 180) / Math.PI`, in that order. `Math.toDegrees` differs from it in the
    // last bit on about a quarter of angles, though never across 30° or 60° (no reading lands exactly
    // on either), so this keeps the port line for line rather than guarding anything.
    val fromUpright = atan2(abs(x), abs(y)) * 180 / PI
    if (fromUpright > LANDSCAPE_FROM_DEG) return PoseReading(Physical.LANDSCAPE, if (x > 0) Side.LEFT else Side.RIGHT)
    if (fromUpright < PORTRAIT_UNDER_DEG) return PoseReading(Physical.PORTRAIT, null)
    return null
  }

  /**
   * `Math.hypot(x, y, z)` as V8 computes it (`src/builtins/math.tq`, `MathHypot`): each value over the
   * largest, squared and Kahan-summed, then the root times the largest. A plain `sqrt(x² + y² + z²)`
   * differs from it in the last bit on about a third of readings, which moves the edge rows. Finite
   * values only: [classify] has turned the others away.
   */
  private fun hypot(x: Double, y: Double, z: Double): Double {
    val values = doubleArrayOf(abs(x), abs(y), abs(z))
    val max = values.max()
    if (max == 0.0) return 0.0
    var sum = 0.0
    var compensation = 0.0
    for (value in values) {
      val n = value / max
      val summand = n * n - compensation
      val preliminary = sum + summand
      compensation = (preliminary - sum) - summand
      sum = preliminary
    }
    return sqrt(sum) * max
  }
}

/**
 * JS's `track`: the dead band makes no progress, and a new reading must hold [HeldPose.HOLD_MS]. A
 * change of side is a new reading here, where JS's one `landscape` is not. One thread.
 */
class PoseTracker {
  /** Nothing settled yet is `unknown`, as JS's `INITIAL_TRACKER` starts. */
  var settled = PoseReading(Physical.UNKNOWN, null)
    private set

  private var candidate = settled
  private var sinceMs = 0L

  /** Held only on a settled side; flat, upright, unknown and not yet settled are not held. */
  val pose: Pose
    get() = settled.side?.let { Pose.Held(it) } ?: Pose.NotHeld

  /** The new pose when the settled one changes it, or null. */
  fun sample(x: Double, y: Double, z: Double, monoMs: Long): Pose? {
    val reading = HeldPose.classify(x, y, z)
    when {
      reading == null -> {
        candidate = settled
        sinceMs = monoMs
      }
      reading != candidate -> {
        candidate = reading
        sinceMs = monoMs
      }
      reading != settled && monoMs - sinceMs >= HeldPose.HOLD_MS -> {
        val before = pose
        settled = reading
        return pose.takeIf { it != before }
      }
    }
    return null
  }
}
