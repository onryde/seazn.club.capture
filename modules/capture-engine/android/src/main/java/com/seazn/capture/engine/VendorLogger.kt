package com.seazn.capture.engine

import io.github.thibaultbee.streampack.core.logger.ILogger

/**
 * StreamPack's logger, replaced (CD30). Warnings and errors go to the session record, where
 * `message` is a text key and so masked by value; the throwable is its class name only, because a
 * vendor message can quote a URL holding a stream key. Nothing reaches logcat, in any build.
 */
class VendorLogger(private val line: (level: String, fields: Map<String, Any?>) -> Unit) : ILogger {
  override fun e(tag: String, message: String, tr: Throwable?) = forward("error", tag, message, tr)

  override fun w(tag: String, message: String, tr: Throwable?) = forward("warn", tag, message, tr)

  override fun i(tag: String, message: String, tr: Throwable?) = Unit

  override fun v(tag: String, message: String, tr: Throwable?) = Unit

  override fun d(tag: String, message: String, tr: Throwable?) = Unit

  private fun forward(level: String, tag: String, message: String, tr: Throwable?) =
    line(level, mapOf("tag" to tag, "message" to message, "error" to tr?.javaClass?.name))
}
