package com.seazn.capture.engine.capture

import com.seazn.capture.engine.adapter.PermanentPlatformFailure
import com.seazn.capture.engine.core.Command
import com.seazn.capture.engine.core.PairRequest
import io.github.thibaultbee.streampack.core.streamers.single.SingleStreamer
import kotlinx.coroutines.flow.MutableStateFlow

/**
 * Task 33 only, deleted by Task 36. `open` fails permanently through [failed], so a JVM-free compile
 * proves the P11 path's wiring: a capture that cannot open ends the pairing fatal-error and named.
 */
class NoCapture(private val failed: (PairRequest, Throwable) -> Unit) : Capture {
  override val streamer = MutableStateFlow<SingleStreamer?>(null)

  override fun open(request: PairRequest) = failed(request, PermanentPlatformFailure("capture not built"))

  override fun close() = Unit

  override fun execute(command: Command) = Unit

  override fun frames(attemptId: Int) = null

  override fun link(attemptId: Int) = null

  override fun facts() = CaptureFacts(0.0, captureTimestampMs = null)
}
