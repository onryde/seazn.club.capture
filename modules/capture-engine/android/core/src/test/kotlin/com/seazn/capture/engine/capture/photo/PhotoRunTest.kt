package com.seazn.capture.engine.capture.photo

import com.seazn.capture.engine.core.RecordEntry
import java.time.Instant
import java.time.ZoneOffset
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.awaitCancellation
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.currentTime
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.withTimeout
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

/**
 * Spec §8, Plan decisions D2: a photo is answered once, within a bound, and a failed photo is one line and a word.
 * Every case drives the real PhotoRun against a lambda that stands for the gallery write.
 */
@OptIn(ExperimentalCoroutinesApi::class) // runCurrent, currentTime
class PhotoRunTest {
  private val at = Instant.parse("2026-10-07T14:25:01Z").toEpochMilli()
  private val lines = mutableListOf<RecordEntry>()
  private var behaviour: suspend (String) -> Unit = {}
  private val names = mutableListOf<String>()
  private val run = PhotoRun({ name -> behaviour(name); names += name }, { at }, { lines += it }) { ZoneOffset.UTC }

  @Test
  fun `a photo is stored under the Seazn name, answers saved and writes no line`() =
    runTest {
      assertEquals(PhotoResult.SAVED, run.take())
      assertEquals(listOf("Seazn_20261007_142501.jpg"), names)
      assertEquals(emptyList(), lines)
    }

  @Test
  fun `M2 a snapshot that never completes is failed at the bound, with one line, and the next photo works`() =
    runTest {
      behaviour = { awaitCancellation() }
      assertEquals(PhotoResult.FAILED, run.take())
      assertEquals(PhotoRun.SHOT_MS, currentTime)
      assertEquals(listOf(RecordEntry("capture-call-failed", listOf("action" to "photo", "error" to "timeout"))), lines)
      assertEquals(emptyList(), names, "nothing was stored")
      behaviour = {}
      assertEquals(PhotoResult.SAVED, run.take(), "a later photo is not held up by the stuck one")
    }

  @Test
  fun `M1 an Error and an Exception alike fail the photo, and the line carries the class name and nothing else`() =
    runTest {
      val secret = "content://media/external/images/media/77 /storage/emulated/0/Pictures/Seazn Capture/x.jpg"
      // An Error that is not OutOfMemoryError: JUnit rethrows that one as unrecoverable, so under a mutant that lets it
      // through it would kill the test worker instead of failing this test. PhotoRun catches every Throwable alike.
      val thrown = listOf<Throwable>(NoClassDefFoundError(secret), IllegalStateException(secret), java.io.IOException(secret))
      val expected = listOf("NoClassDefFoundError", "IllegalStateException", "IOException")
      var seen = 0
      for ((index, throwable) in thrown.withIndex()) {
        lines.clear()
        behaviour = { throw throwable }
        assertEquals(PhotoResult.FAILED, run.take())
        assertEquals(listOf(RecordEntry("capture-call-failed", listOf("action" to "photo", "error" to expected[index]))), lines)
        assertFalse(lines.toString().contains("content://"), "no URI in a line")
        assertFalse(lines.toString().contains("/storage/"), "no path in a line")
        seen++
      }
      assertEquals(3, seen, "all three throwables were driven")
    }

  @Test
  fun `M3 a library's own timeout inside the call is a failed photo, not a cancellation`() =
    runTest {
      behaviour = { withTimeout(10) { awaitCancellation() } }
      assertEquals(PhotoResult.FAILED, run.take())
      assertEquals(10L, currentTime, "it failed at the library's 10 ms, long before the bound")
      assertEquals(listOf(RecordEntry("capture-call-failed", listOf("action" to "photo", "error" to "TimeoutCancellationException"))), lines)
    }

  @Test
  fun `M3 the scope ending is cancellation, not a failed photo, with no answer and no line`() =
    runTest {
      behaviour = { awaitCancellation() }
      val job = launch { run.take() }
      runCurrent()
      assertTrue(job.isActive, "the photo is in flight")
      job.cancel()
      job.join()
      assertTrue(job.isCancelled)
      assertEquals(emptyList(), lines, "a scope that ends writes no failure")
    }
}
