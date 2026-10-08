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
 *
 * Sound is the mic's availability, never its level (spec §4, owner 2026-10-06: "even though there is
 * no sound … it is ok, nothing wrong and should allow to go live"): [micAvailable] is false only while
 * the system silences our recording (a call) or audio capture is unavailable. `BridgeCore` judges it.
 */
data class Readiness(val cameraFrames: Boolean, val micAvailable: Boolean, val pose: Pose) {
  val sound: Boolean
    get() = micAvailable

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
    /** Before the platform's first reading: nothing is ready. */
    val UNKNOWN = Readiness(cameraFrames = false, micAvailable = false, pose = Pose.NotHeld)
  }
}
