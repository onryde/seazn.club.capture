package com.seazn.capture.engine.preview

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertFalse
import kotlin.test.assertNotSame
import kotlin.test.assertNull
import kotlin.test.assertSame
import kotlin.test.assertTrue
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.job
import kotlinx.coroutines.launch

/**
 * N30, Batch 3 fix round 1 (review I1 and M1): the identity rules the 16:9 glue stands on. StreamPack's PreviewView
 * compares each streamer and each source with the one before it (`areEqual`) and stops, resets and releases the old
 * one when they differ, so the glue must hand it the same wrapper for the same real object: `SixteenNineBinding` one
 * provider per streamer (a [ScopedOneFor]) and `SixteenNineProvider` one decorator per camera (a [OneFor]). A provider
 * runs its mirror in a scope of its own, cancelled when the streamer is replaced or unbound, so a released streamer is
 * never held by a coroutine that outlives it.
 */
class OneForTest {
  /** A key that is equal to another without being it, as PreviewView's `areEqual` would compare two real objects. */
  private data class Key(val name: String)

  private class Log {
    val lines = mutableListOf<String>()

    fun make(key: Key): String = "value of ${key.name}".also { lines += "make ${key.name}" }

    fun drop(value: String) {
      lines += "drop $value"
    }
  }

  private fun oneFor(log: Log) = OneFor<Key, String>(log::make, log::drop)

  @Test
  fun `the same key gets the same value, made once (a second call)`() {
    val log = Log()
    val values = oneFor(log)
    val first = values.of(Key("a"))
    assertSame(first, values.of(Key("a")))
    assertEquals(listOf("make a"), log.lines)
  }

  @Test
  fun `an equal key is the same key, as PreviewView compares them`() {
    val log = Log()
    val values = oneFor(log)
    val key = Key("a")
    val first = values.of(key)
    assertSame(first, values.of(Key("a").also { assertNotSame(key, it) }))
    assertEquals(listOf("make a"), log.lines)
  }

  @Test
  fun `a new key drops the old value, then makes its own`() {
    val log = Log()
    val values = oneFor(log)
    values.of(Key("a"))
    assertEquals("value of b", values.of(Key("b")))
    assertEquals(listOf("make a", "drop value of a", "make b"), log.lines)
  }

  @Test
  fun `only the last key is held - going back makes anew`() {
    val log = Log()
    val values = oneFor(log)
    val a = values.of(Key("a"))
    values.of(Key("b"))
    val again = values.of(Key("a"))
    assertNotSame(a, again)
    assertEquals(listOf("make a", "drop value of a", "make b", "drop value of b", "make a"), log.lines)
  }

  @Test
  fun `forget drops the value, and the same key afterwards gets a new one`() {
    val log = Log()
    val values = oneFor(log)
    val a = values.of(Key("a"))
    values.forget()
    val again = values.of(Key("a"))
    assertNotSame(a, again)
    assertEquals(listOf("make a", "drop value of a", "make a"), log.lines)
  }

  @Test
  fun `forget with nothing held drops nothing, and a second forget drops nothing more (an empty input)`() {
    val log = Log()
    val values = oneFor(log)
    values.forget()
    values.of(Key("a"))
    values.forget()
    values.forget()
    assertEquals(listOf("make a", "drop value of a"), log.lines)
  }

  @Test
  fun `a make that throws holds nothing, so the next ask makes again`() {
    var fail = true
    val values = OneFor<Key, String>({ if (fail) error("no") else it.name }, {})
    assertFailsWith<IllegalStateException> { values.of(Key("a")) }
    fail = false
    assertEquals("a", values.of(Key("a")))
  }

  /** A parent like CapturePreviewView's: a SupervisorJob, never cancelled; Unconfined so the work runs at once. */
  private fun parent() = CoroutineScope(SupervisorJob() + Dispatchers.Unconfined)

  private class Mirror(val key: Key, val scope: CoroutineScope, source: StateFlow<String>) {
    /** As SixteenNineProvider's mirror: a WhileSubscribed stateIn, whose sharing coroutine never completes by itself. */
    val flow = source.stateIn(scope, SharingStarted.WhileSubscribed(), source.value)
  }

  private val source = MutableStateFlow("camera")

  private fun mirrors(parent: CoroutineScope) = ScopedOneFor<Key, Mirror>(parent) { key, own -> Mirror(key, own, source) }

  @Test
  fun `each value runs in a child scope of its own, kept while its key stays`() {
    val parent = parent()
    val mirrors = mirrors(parent)
    val a = mirrors.of(Key("a"))!!
    assertSame(a, mirrors.of(Key("a")))
    assertTrue(a.scope.coroutineContext.job.isActive, "kept: a re-attach binds the same provider, whose flow must follow")
    assertEquals(listOf(a.scope.coroutineContext.job), parent.coroutineContext.job.children.toList())
    assertTrue(parent.coroutineContext.job.isActive)
  }

  @Test
  fun `a new key cancels the old value's scope, and its mirror with it, not the new one's`() {
    val parent = parent()
    val mirrors = mirrors(parent)
    val a = mirrors.of(Key("a"))!!
    val collector = parent.launch { a.flow.collect {} }
    collector.cancel()
    assertEquals(1, a.scope.coroutineContext.job.children.count(), "PreviewView has left, and a's sharing coroutine still runs")
    val b = mirrors.of(Key("b"))!!
    assertTrue(a.scope.coroutineContext.job.isCancelled, "the replaced streamer's mirror is cancelled")
    assertTrue(b.scope.coroutineContext.job.isActive)
    assertEquals(listOf(b.scope.coroutineContext.job), parent.coroutineContext.job.children.toList(), "nothing of a is left running")
    assertEquals("camera", a.flow.value, "a cancelled mirror keeps its last value, which PreviewView reads once more")
  }

  @Test
  fun `null cancels and forgets, and the same key afterwards gets a fresh scope (after an interruption)`() {
    val parent = parent()
    val mirrors = mirrors(parent)
    val a = mirrors.of(Key("a"))!!
    assertNull(mirrors.of(null))
    assertTrue(a.scope.coroutineContext.job.isCancelled)
    assertEquals(0, parent.coroutineContext.job.children.count())
    val again = mirrors.of(Key("a"))!!
    assertNotSame(a, again)
    assertTrue(again.scope.coroutineContext.job.isActive)
    assertTrue(parent.coroutineContext.job.isActive, "the view's own scope is never cancelled by the binding")
  }

  @Test
  fun `a second null, or a null first, cancels nothing (an empty input)`() {
    val parent = parent()
    val mirrors = mirrors(parent)
    assertNull(mirrors.of(null))
    val a = mirrors.of(Key("a"))!!
    assertNull(mirrors.of(null))
    assertNull(mirrors.of(null))
    assertTrue(a.scope.coroutineContext.job.isCancelled)
    assertTrue(parent.coroutineContext.job.isActive)
  }

  @Test
  fun `a make that throws leaves no scope behind`() {
    val parent = parent()
    val mirrors = ScopedOneFor<Key, Mirror>(parent) { _, _ -> error("no") }
    assertFailsWith<IllegalStateException> { mirrors.of(Key("a")) }
    assertEquals(0, parent.coroutineContext.job.children.count())
    assertFalse(parent.coroutineContext.job.isCancelled)
  }
}
