package com.seazn.capture.engine.preview

import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.job

/**
 * One value for the last key asked about (N30, Batch 3 fix round 1). The same key, compared with `==` as StreamPack's
 * PreviewView compares streamers and sources (`Intrinsics.areEqual`), gets the same value, so a wrapper reads as
 * unchanged exactly when the real object does. A different key drops the old value, then makes its own; [forget]
 * drops it and holds nothing. Only the last key is held. Not thread-safe: the glue asks on the main thread.
 */
class OneFor<K : Any, V>(private val make: (K) -> V, private val drop: (V) -> Unit) {
  private var held: Pair<K, V>? = null

  fun of(key: K): V {
    held?.let { (heldKey, value) -> if (heldKey == key) return value }
    forget()
    return make(key).also { held = key to it }
  }

  fun forget() {
    val value = held?.second ?: return
    held = null
    drop(value)
  }
}

/**
 * A [OneFor] whose every value is made with a child scope of [parent] of its own, cancelled when the value is dropped:
 * a new key or null. [parent] is the view's, never cancelled, so anything a value launches (a `stateIn`'s sharing
 * coroutine, which never completes by itself) would otherwise outlive it, and hold whatever it holds (review I1). A
 * value kept for the same key keeps its scope running. Null forgets: the next key gets a new value and a new scope.
 */
class ScopedOneFor<K : Any, V>(private val parent: CoroutineScope, private val make: (K, CoroutineScope) -> V) {
  private val values = OneFor<K, Pair<V, Job>>(::made) { (_, own) -> own.cancel() }

  private fun made(key: K): Pair<V, Job> {
    val own = Job(parent.coroutineContext.job)
    try {
      return make(key, CoroutineScope(parent.coroutineContext + own)) to own
    } catch (e: Throwable) {
      own.cancel()
      throw e
    }
  }

  fun of(key: K?): V? {
    if (key == null) {
      values.forget()
      return null
    }
    return values.of(key).first
  }
}
