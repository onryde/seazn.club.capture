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
   *
   * The magnitude is a plain root where JS calls `Math.hypot`. The two can differ in the last bit, so a
   * reading exactly on an edge may fall either way; on float32 sensor readings they agreed on every one
   * swept (task 17's report, fix round 1). The shared rows sit 1e-9 off each edge for that reason.
   */
  fun classify(x: Double, y: Double, z: Double): PoseReading? {
    if (!x.isFinite() || !y.isFinite() || !z.isFinite()) return null
    val magnitude = sqrt(x * x + y * y + z * z)
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
}

/**
 * JS's `track`: the dead band makes no progress, and a new reading must hold [HeldPose.HOLD_MS]. A
 * change of side is a new reading here, where JS's one `landscape` is not. One thread.
 *
 * The settled reading is JS's, hysteresis and all, so it stays at parity with the turn card. Held is
 * not only that: A11 reads the dead band as not ready, so [pose] is not held while the latest reading
 * is in it, and held again as soon as the phone is back out, with no new hold.
 */
class PoseTracker {
  /** Nothing settled yet is `unknown`, as JS's `INITIAL_TRACKER` starts. */
  var settled = PoseReading(Physical.UNKNOWN, null)
    private set

  private var candidate = settled
  private var sinceMs = 0L

  /** The latest reading was the dead band, or not finite. */
  private var inDeadBand = false

  /**
   * Held only on a settled side, and only while the latest reading is out of the dead band. Flat,
   * upright, unknown, not yet settled and the dead band are not held.
   */
  val pose: Pose
    get() = if (inDeadBand) Pose.NotHeld else settled.side?.let { Pose.Held(it) } ?: Pose.NotHeld

  /** The new pose when this reading changes it, or null. */
  fun sample(x: Double, y: Double, z: Double, monoMs: Long): Pose? {
    val before = pose
    val reading = HeldPose.classify(x, y, z)
    inDeadBand = reading == null
    when {
      reading == null -> {
        candidate = settled
        // JS's line, kept for the port: never read, as the next reading either differs from the
        // candidate, which resets it, or is the settled one, which settles nothing (mutant 9c).
        sinceMs = monoMs
      }
      reading != candidate -> {
        candidate = reading
        sinceMs = monoMs
      }
      // `reading != settled` is JS's too. Without it a settled reading would settle again as itself,
      // which changes nothing (mutant R6).
      reading != settled && monoMs - sinceMs >= HeldPose.HOLD_MS -> settled = reading
    }
    return pose.takeIf { it != before }
  }
}
