package com.seazn.capture.engine.vendor

/**
 * The one rule both vendor loggers follow (CD30, C6 m-4): StreamPack's (`VendorLogger`) and komuxer's,
 * its RTMPS client's (`KomuxerVendorLogger`), each replaced so nothing reaches logcat, in any build.
 * Warnings and errors go to the session record as `vendor-log` lines, where `message` is a text key and
 * so masked by value; the throwable is its class name only, because a vendor message can quote a URL
 * holding a stream key, and komuxer's own logger writes `Throwable.getMessage`. Each adapter drops the
 * rest (info, verbose, debug).
 *
 * Device session 4, F-S4-1: StreamPack 3.2.1 has no public word that the camera device was lost; its
 * `CameraUtils.openCamera` logs it, and only it (the sources): `onDisconnected` warns "Camera $id has been
 * disconnected", `onError` errs "Camera $id is in error $error". Each is told to [cameraLost] with the camera's
 * id, after its line. A busy error, another app's take, is the open's own failure, read where the open fails.
 *
 * Imports nothing, so core's tests run it into a real record.
 */
class VendorLines(
  private val cameraLost: (id: String) -> Unit = {},
  private val line: (level: String, fields: Map<String, Any?>) -> Unit,
) {
  fun e(tag: String, message: String, tr: Throwable?) = forward("error", tag, message, tr)

  fun w(tag: String, message: String, tr: Throwable?) = forward("warn", tag, message, tr)

  private fun forward(level: String, tag: String, message: String, tr: Throwable?) {
    line(level, mapOf("tag" to tag, "message" to message, "error" to tr?.javaClass?.name))
    if (tag == CAMERA_UTILS) lostCamera(message)?.let(cameraLost)
  }

  private fun lostCamera(message: String): String? {
    DISCONNECTED.matchEntire(message)?.let { return it.groupValues[1] }
    val error = IN_ERROR.matchEntire(message) ?: return null
    return error.groupValues[1].takeIf { error.groupValues[2].toIntOrNull() !in BUSY_ERRORS }
  }

  private companion object {
    /**
     * The StreamPack whose `CameraUtils.openCamera` lines [DISCONNECTED] and [IN_ERROR] were read from (re-review 3
     * m1). A bump re-reads them and moves this; GlueRulesTest holds it to build.gradle's strict pin.
     */
    const val STREAMPACK = "3.2.1"
    const val CAMERA_UTILS = "CameraUtils"
    val DISCONNECTED = Regex("Camera (\\S+) has been disconnected")
    val IN_ERROR = Regex("Camera (\\S+) is in error (\\d+)")

    /** `CameraDevice.StateCallback`'s ERROR_CAMERA_IN_USE and ERROR_MAX_CAMERAS_IN_USE (javap, android-36's android.jar). */
    val BUSY_ERRORS = setOf(1, 2)
  }
}
