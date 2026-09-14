package com.seazn.p5spike

import android.content.Context
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import java.io.File
import java.util.concurrent.atomic.AtomicBoolean

/**
 * F-P5-6's on-device proof hook. Switched from the laptop by pushing an empty
 * `p5-simulate-video-stall` into the app's external files dir, beside `p5-no-wakelock` and
 * `p5-session.json`.
 *
 * While the file is present, [CountingEndpoint] discards every video frame before counting it. The
 * counter goes flat exactly as it did in Soak A, while audio and the transport carry on. The file is
 * deleted when a recovery starts, so the next attempt carries video, and one run proves detection,
 * recovery and `video-recovered` together.
 */
object StallSimulation {
  const val FILE_NAME = "p5-simulate-video-stall"
  private const val POLL_MS = 1_000L

  private val discarding = AtomicBoolean(false)
  @Volatile private var file: File? = null
  @Volatile private var onChange: (Boolean) -> Unit = {}

  /**
   * Read for every encoded video frame, so it is a flag rather than a file check: thirty stats a
   * second on the encoder's output thread is a cost the frames being measured would pay.
   */
  fun discardVideo(): Boolean = discarding.get()

  /** Whether the hook file is present now, for the `service-started` row. */
  fun present(context: Context): Boolean =
    runCatching { File(context.getExternalFilesDir(null), FILE_NAME).exists() }.getOrDefault(false)

  /**
   * Polls once a second. [onChange] hears every change of state, so the CSV says when discarding
   * began and ended, even for a file pushed mid-session.
   */
  fun watch(context: Context, scope: CoroutineScope, onChange: (Boolean) -> Unit) {
    file = File(context.getExternalFilesDir(null), FILE_NAME)
    this.onChange = onChange
    scope.launch {
      while (isActive) {
        runCatching { refresh() }
        delay(POLL_MS)
      }
    }
  }

  /** Re-reads the file now. Called at every connect, so a file pushed just before a start applies from its first frame. */
  fun refresh() {
    val present = runCatching { file?.exists() == true }.getOrDefault(false)
    if (discarding.getAndSet(present) != present) onChange(present)
  }

  /** Stops discarding and deletes the file. Returns whether a simulation was in force. */
  fun clear(): Boolean {
    runCatching { file?.delete() }
    val was = discarding.getAndSet(false)
    if (was) onChange(false)
    return was
  }
}
