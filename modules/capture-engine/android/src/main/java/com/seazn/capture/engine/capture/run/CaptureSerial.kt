package com.seazn.capture.engine.capture.run

import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.channels.consumeEach
import kotlinx.coroutines.channels.onFailure
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.launch

/**
 * The capture's one order (PV38): a single consumer of an unlimited queue, so calls are carried out one
 * at a time, in the order they were made. `scope.launch { mutex.withLock { … } }` is not that: launch
 * order is not lock order on a pool. [submit] never blocks, so the scheduler thread returns at once.
 *
 * A block's throw is handed to [failure] (I5) and the next block still runs. Only the scope's own
 * cancellation ends the queue, and a block submitted after that is a failure too, never silently lost.
 */
class CaptureSerial(scope: CoroutineScope, private val failure: (Throwable) -> Unit) {
  private val queue = Channel<suspend () -> Unit>(Channel.UNLIMITED)

  init {
    scope.launch {
      queue.consumeEach { block ->
        try {
          block()
        } catch (t: Throwable) {
          ensureActive() // the scope's cancellation ends the queue; it is no block's failure
          failure(t)
        }
      }
    }
  }

  fun submit(block: suspend () -> Unit) {
    queue.trySend(block).onFailure { failure(IllegalStateException("the capture's queue has ended", it)) }
  }
}
