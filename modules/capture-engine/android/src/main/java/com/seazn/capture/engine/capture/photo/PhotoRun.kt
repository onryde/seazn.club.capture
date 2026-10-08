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
 * Spec §8, Plan decisions D2: one photo, answered once, within a bound. It is handed nothing of the session, so
 * a photo that fails has no way to fail the broadcast; the caller runs it on a scope of its own, never on the
 * capture's queue. A call that honours cancellation is cut off at [SHOT_MS]; a call that does not is answered by
 * JS's own deadline (`PHOTO_DEADLINE_MS`, 4 000), which is why it is twice this.
 */
class PhotoRun(
  private val shoot: suspend (name: String) -> Unit,
  private val wallMs: () -> Long,
  private val line: (RecordEntry) -> Unit,
  private val zone: () -> ZoneId = { ZoneId.systemDefault() },
) {
  /** Never throws. Only the scope ending escapes, as cancellation. */
  suspend fun take(): PhotoResult =
    try {
      val stored =
        withTimeoutOrNull(SHOT_MS) {
          shoot(PhotoName.of(wallMs(), zone()))
          true
        }
      if (stored == true) PhotoResult.SAVED else failed("timeout")
    } catch (t: Throwable) { // an Error too: a bitmap can throw OutOfMemoryError
      currentCoroutineContext().ensureActive() // our own scope ending is cancellation; any other throw, a library's timeout included, is a failed photo
      failed(t.javaClass.simpleName)
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
