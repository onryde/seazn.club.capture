package com.seazn.capture.engine.capture.photo

import com.seazn.capture.engine.core.RecordEntry
import java.time.ZoneId
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.withTimeoutOrNull

/** What JS reads (spec §8): two words, closed, so the bridge can return nothing else. */
enum class PhotoResult(val wire: String) {
  SAVED("saved"),
  FAILED("failed"),
}

/**
 * Spec §8, Plan decisions D2: one photo, answered once. It is handed nothing of the session, so a photo that
 * fails has no way to fail the broadcast; the caller runs it on a scope of its own, never on the capture's queue.
 *
 * [ready] is what protects the stream. StreamPack 3.2.1's `takeSnapshot` blocks a thread on a
 * `ListenableFuture.get()` while it holds the input's source lock (javap: `DefaultSurfaceProcessor.takeSnapshot`,
 * `VideoInput$takeSnapshot$2`), and cancellation cannot interrupt a blocked `get()`. Go live, Stop, a camera
 * reopen and the slate swap take the same lock, so a snapshot of a camera that delivers nothing would hold them
 * all until a frame comes, which for a dead camera is never. So a photo is refused, `failed` at once and with no snapshot asked for, unless [ready] says the
 * camera is open and ours.
 *
 * What is left, stated plainly: [ready] reads the capture's state, never frames. A stall that starts during the
 * snapshot, or a camera that stalls with no failure or loss reported, still holds the lock until the next frame.
 * A call that honours cancellation is cut off at [SHOT_MS]; a blocked one cannot be, so it is answered by JS's own
 * deadline (`PHOTO_DEADLINE_MS`, 4 000), twice this.
 */
class PhotoRun(
  private val shoot: suspend (name: String) -> Unit,
  private val ready: () -> Boolean,
  private val wallMs: () -> Long,
  private val line: (RecordEntry) -> Unit,
  private val zone: () -> ZoneId = { ZoneId.systemDefault() },
) {
  /** Never throws. Only the scope ending escapes, as cancellation. */
  suspend fun take(): PhotoResult {
    try {
      if (!ready()) return failed("not-ready")
      val stored =
        withTimeoutOrNull(SHOT_MS) {
          shoot(PhotoName.of(wallMs(), zone()))
          true
        }
      return if (stored == true) PhotoResult.SAVED else failed("timeout")
    } catch (t: Throwable) { // an Error too: a bitmap can throw OutOfMemoryError
      currentCoroutineContext().ensureActive() // our own scope ending is cancellation; any other throw, a library's timeout included, is a failed photo
      return failed(t.javaClass.simpleName)
    }
  }

  /** One line, the class name only: a message can quote a URI or a path. */
  private fun failed(error: String): PhotoResult {
    line(RecordEntry("capture-call-failed", listOf("action" to "photo", "error" to error)))
    return PhotoResult.FAILED
  }

  companion object {
    /** A snapshot takes one frame and a JPEG, a few hundred ms; this is generous. */
    const val SHOT_MS = 2_000L
  }
}
