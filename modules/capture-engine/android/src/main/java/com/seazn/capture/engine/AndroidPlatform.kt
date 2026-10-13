package com.seazn.capture.engine

import android.os.Handler
import android.os.Looper
import com.seazn.capture.engine.adapter.HttpOutcome
import com.seazn.capture.engine.adapter.HttpRequest
import com.seazn.capture.engine.adapter.Platform
import com.seazn.capture.engine.adapter.PlatformFacts
import com.seazn.capture.engine.capture.Capture
import com.seazn.capture.engine.core.Command
import com.seazn.capture.engine.core.PairRequest
import com.seazn.capture.engine.core.RecordEntry
import com.seazn.capture.engine.http.HttpPort
import com.seazn.capture.engine.watch.DeviceSampler
import com.seazn.capture.engine.watch.PoseWatch

/** The Android `Platform` (CD3): every call passes through to a part. */
class AndroidPlatform(
  private val capture: Capture,
  private val http: HttpPort,
  private val file: RecordFile,
  private val pose: PoseWatch,
  private val device: DeviceSampler,
  private val keeper: PairingKeeper,
  private val emit: (String, Map<String, Any?>) -> Unit,
  /** N27: the app's battery mode (`PowerMode`), or null when it cannot be read. */
  private val power: () -> String?,
) : Platform {
  private val main = Handler(Looper.getMainLooper())

  /**
   * `Hold` to `Release` is the span the pairing holds the service, the wake lock and the pose watch
   * (Task 17), and drain counts from it. The keeper releases at `Release` alone (C0b): an End leaves the
   * service held until A8's final beat answers.
   */
  override fun execute(command: Command) {
    when (command) {
      Command.AskPermissions -> keeper.ask()
      Command.Hold -> {
        keeper.hold()
        // N27: which battery mode the pairing runs in, so a locked failure's record says.
        EngineHost.line(RecordEntry("power", listOf("mode" to power())))
        device.paired()
        pose.start()
      }
      Command.Release -> {
        keeper.release()
        pose.stop()
      }
      else -> Unit
    }
    capture.execute(command)
  }

  override fun http(request: HttpRequest, answer: (HttpOutcome) -> Unit) = http.send(request, answer)

  /** CD37: BridgeCore decides when; the capture opens for the pairing it was asked for, or closes. */
  override fun capture(wanted: Boolean, request: PairRequest?) {
    if (wanted && request != null) capture.open(request) else capture.close()
  }

  override fun frames(attemptId: Int) = capture.frames(attemptId)

  override fun link(attemptId: Int) = capture.link(attemptId)

  /** `survivesBackground` is the keeper's (CD16); `deliveryCheckedAtMs` is BridgeCore's. */
  override fun facts(): PlatformFacts {
    val read = capture.facts()
    return PlatformFacts(
      audioLevel = read.audioLevel,
      deliveryCheckedAtMs = null,
      captureTimestampMs = read.captureTimestampMs,
      survivesBackground = keeper.survivesBackground,
    )
  }

  /** The notification follows the snapshot only while the service is held, so an idle phone posts nothing. */
  override fun snapshot(wire: Map<String, Any?>) {
    emit("onSnapshot", wire)
    if (keeper.survivesBackground) main.post { keeper.notify(wire) }
  }

  /** Carry C4c-I3: the line goes to disk as written, and to JS with its seq, a Double like every number JS reads. */
  override fun recordLine(line: String, seq: Long) {
    file.append(line)
    emit("onRecord", mapOf("line" to line, "seq" to seq.toDouble()))
  }

  override fun acked(seq: Int) = emit("onAck", mapOf("seq" to seq.toDouble()))
}
