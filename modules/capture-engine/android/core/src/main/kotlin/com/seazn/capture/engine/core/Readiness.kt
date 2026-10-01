package com.seazn.capture.engine.core

/** Which way round the phone is held sideways (A11). [rotationDegrees] is the encoded rotation. */
enum class Side(override val wire: String, val rotationDegrees: Int) : Wire {
  /** The phone's top to the operator's left: `Surface.ROTATION_90`. */
  LEFT("left", 90),

  /** The phone's top to the operator's right: `Surface.ROTATION_270`. */
  RIGHT("right", 270),
}

/** How the accelerometer reads the phone, as the adapter's pose rule (Task 17) settled it. */
sealed interface Pose {
  data class Held(val side: Side) : Pose

  /** Flat, upright, in the dead band, or not yet settled: not ready. */
  data object NotHeld : Pose

  /** No accelerometer at all: never blocks (A11, JS's `watchPhysical` rule). */
  data object NoSensor : Pose
}

/**
 * The platform's readiness facts (A11). Native judges readiness for every start, held or remote:
 * one gate, one authority. The network is the machine's own fact (`Input.Network`), passed in.
 */
data class Readiness(val cameraFrames: Boolean, val audioPeak: Double, val pose: Pose) {
  /** At or above the floor; a NaN level compares false and reads silent. */
  val sound: Boolean
    get() = audioPeak >= AUDIO_FLOOR

  val held: Boolean
    get() = pose != Pose.NotHeld

  /** The side the broadcast encodes, read when Armed turns to Connecting: the side held, or LEFT with no sensor. */
  val side: Side
    get() = (pose as? Pose.Held)?.side ?: Side.LEFT

  /** The first check that fails, in the status line's order (amendment §2), or null when ready. */
  fun notReady(camera: CameraState, networkValidated: Boolean): NotReady? =
    when {
      !cameraFrames || camera != CameraState.OWN -> NotReady.CAMERA
      !sound -> NotReady.SOUND
      !networkValidated -> NotReady.NETWORK
      !held -> NotReady.HELD
      else -> null
    }

  companion object {
    /** Shared with JS's meter notch through `modules/capture-engine/src/wire/audio-floor.json`. */
    const val AUDIO_FLOOR = 0.05

    /** Before the platform's first reading: nothing is ready. */
    val UNKNOWN = Readiness(cameraFrames = false, audioPeak = 0.0, pose = Pose.NotHeld)
  }
}
