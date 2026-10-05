package android.hardware.camera2

/** A stand-in for Camera2's own (android-36), by name only: core imports no Android, and reads it by name. */
class CameraAccessException(val reason: Int, message: String) : Exception(message)
