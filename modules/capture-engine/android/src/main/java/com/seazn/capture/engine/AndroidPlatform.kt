package com.seazn.capture.engine

import com.seazn.capture.engine.adapter.HttpOutcome
import com.seazn.capture.engine.adapter.HttpRequest
import com.seazn.capture.engine.adapter.Platform
import com.seazn.capture.engine.adapter.PlatformFacts
import com.seazn.capture.engine.capture.Capture
import com.seazn.capture.engine.core.Command
import com.seazn.capture.engine.core.PairRequest
import com.seazn.capture.engine.http.HttpAdapter

/** The Android `Platform` (CD3): every call passes through to a part. */
class AndroidPlatform(
  private val capture: Capture,
  private val http: HttpAdapter,
  private val file: RecordFile,
  private val emit: (String, Map<String, Any?>) -> Unit,
) : Platform {
  override fun execute(command: Command) = capture.execute(command)

  override fun http(request: HttpRequest, answer: (HttpOutcome) -> Unit) = http.send(request, answer)

  /** CD37: BridgeCore decides when; the capture opens for the pairing it was asked for, or closes. */
  override fun capture(wanted: Boolean, request: PairRequest?) {
    if (wanted && request != null) capture.open(request) else capture.close()
  }

  override fun frames(attemptId: Int) = capture.frames(attemptId)

  override fun link(attemptId: Int) = capture.link(attemptId)

  /** `survivesBackground` arrives with Task 38's keeper; `deliveryCheckedAtMs` is BridgeCore's. */
  override fun facts(): PlatformFacts {
    val read = capture.facts()
    return PlatformFacts(audioLevel = read.audioLevel, deliveryCheckedAtMs = null, captureTimestampMs = read.captureTimestampMs, survivesBackground = false)
  }

  override fun snapshot(wire: Map<String, Any?>) = emit("onSnapshot", wire)

  /** Carry C4c-I3: the line goes to disk as written, and to JS with its seq, a Double like every number JS reads. */
  override fun recordLine(line: String, seq: Long) {
    file.append(line)
    emit("onRecord", mapOf("line" to line, "seq" to seq.toDouble()))
  }

  override fun acked(seq: Int) = emit("onAck", mapOf("seq" to seq.toDouble()))
}
