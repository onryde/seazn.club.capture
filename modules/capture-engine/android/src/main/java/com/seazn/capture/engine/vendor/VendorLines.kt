package com.seazn.capture.engine.vendor

/**
 * The one rule both vendor loggers follow (CD30, C6 m-4): StreamPack's (`VendorLogger`) and komuxer's,
 * its RTMPS client's (`KomuxerVendorLogger`), each replaced so nothing reaches logcat, in any build.
 * Warnings and errors go to the session record as `vendor-log` lines, where `message` is a text key and
 * so masked by value; the throwable is its class name only, because a vendor message can quote a URL
 * holding a stream key, and komuxer's own logger writes `Throwable.getMessage`. Each adapter drops the
 * rest (info, verbose, debug).
 *
 * Imports nothing, so core's tests run it into a real record.
 */
class VendorLines(private val line: (level: String, fields: Map<String, Any?>) -> Unit) {
  fun e(tag: String, message: String, tr: Throwable?) = forward("error", tag, message, tr)

  fun w(tag: String, message: String, tr: Throwable?) = forward("warn", tag, message, tr)

  private fun forward(level: String, tag: String, message: String, tr: Throwable?) =
    line(level, mapOf("tag" to tag, "message" to message, "error" to tr?.javaClass?.name))
}
