package com.seazn.capture.engine.endpoints

import java.util.concurrent.Executors
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.asCoroutineDispatcher

/** RTMP's IO runs on our two threads, each with the TLS guard as its handler (F-P5-12, CD15). */
object RtmpDispatcher {
  fun create(): CoroutineDispatcher =
    Executors.newFixedThreadPool(2) { task -> Thread(task, "rtmp-io").apply { uncaughtExceptionHandler = TlsGuard.handler(previous = null) } }
      .asCoroutineDispatcher()
}
