package com.seazn.capture.engine.capture

import com.seazn.capture.engine.adapter.FrameCount
import com.seazn.capture.engine.core.Command
import com.seazn.capture.engine.core.LinkCounters
import com.seazn.capture.engine.core.PairRequest
import io.github.thibaultbee.streampack.core.streamers.single.SingleStreamer
import kotlinx.coroutines.flow.StateFlow

data class CaptureFacts(val audioLevel: Double, val captureTimestampMs: Long?)

/** What the platform asks of the camera, microphone and endpoints. Task 36's `StreamerAdapter` is the real one. */
interface Capture {
  /** The pairing's streamer while the capture is open; the preview view binds to it (Task 39). */
  val streamer: StateFlow<SingleStreamer?>

  /**
   * CD37: open the camera and microphone for [request]'s pairing, after CAMERA and RECORD_AUDIO are
   * granted (the engine asks before Paired). Returns at once. A failure is reported through
   * `BridgeCore.pairFailed(request, t)` (P11), never thrown to the caller.
   */
  fun open(request: PairRequest)

  /** CD37: release the camera and microphone. Returns at once; idempotent. */
  fun close()

  /** Carry out one command. Returns at once; outcomes are reported, never returned. */
  fun execute(command: Command)

  fun frames(attemptId: Int): FrameCount?

  fun link(attemptId: Int): LinkCounters?

  /** Volatile reads only: called on the scheduler thread at every publish. */
  fun facts(): CaptureFacts

  /** Review C7 I-2: the preview's open of the camera failed. From the main thread; never throws for a busy camera. */
  fun previewFailed(failure: Throwable)

  /** Re-review 4 cap: the app came back to the foreground, which re-arms the camera's loss rebuilds. Returns at once. */
  fun foreground()

  /**
   * Spec §8: one still, answered once with a photo word ("saved" or "failed"). Returns at once, from any thread; never
   * throws. The one call that answers, recorded in AGENTS §2.
   */
  fun takePhoto(done: (String) -> Unit)
}
