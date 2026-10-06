package com.seazn.capture.engine

import com.seazn.capture.engine.vendor.VendorLines
import io.github.komedia.komuxer.logger.IKomuxerLogger

/**
 * komuxer's logger (the RTMPS client's), replaced as StreamPack's is (CD30, C6 m-4): komuxer's own logs
 * `Throwable.getMessage`, which can echo the stream name, to logcat. Warnings and errors go to the
 * session record by [VendorLines]' rule, the one [VendorLogger] follows; the rest is dropped.
 */
class KomuxerVendorLogger(private val lines: VendorLines) : IKomuxerLogger {
  override fun e(tag: String, message: String, tr: Throwable?) = lines.e(tag, message, tr)

  override fun w(tag: String, message: String, tr: Throwable?) = lines.w(tag, message, tr)

  override fun i(tag: String, message: String, tr: Throwable?) = Unit

  override fun v(tag: String, message: String, tr: Throwable?) = Unit

  override fun d(tag: String, message: String, tr: Throwable?) = Unit
}
