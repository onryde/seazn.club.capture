package com.seazn.capture.engine

import com.seazn.capture.engine.vendor.VendorLines
import io.github.thibaultbee.streampack.core.logger.ILogger

/**
 * StreamPack's logger, replaced (CD30). Warnings and errors go to the session record by [VendorLines]'
 * rule, which komuxer's replacement ([KomuxerVendorLogger]) shares: `message` is a text key and so
 * masked by value; the throwable is its class name only. Nothing reaches logcat, in any build.
 */
class VendorLogger(private val lines: VendorLines) : ILogger {
  override fun e(tag: String, message: String, tr: Throwable?) = lines.e(tag, message, tr)

  override fun w(tag: String, message: String, tr: Throwable?) = lines.w(tag, message, tr)

  override fun i(tag: String, message: String, tr: Throwable?) = Unit

  override fun v(tag: String, message: String, tr: Throwable?) = Unit

  override fun d(tag: String, message: String, tr: Throwable?) = Unit
}
