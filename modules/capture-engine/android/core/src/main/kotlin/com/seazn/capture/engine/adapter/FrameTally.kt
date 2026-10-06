package com.seazn.capture.engine.adapter

import java.util.concurrent.atomic.AtomicLong

/**
 * F-P5-4: the encoded frames that reached the endpoint, counted as the sink writes them, video apart
 * from audio, with every byte. Written on the sink's thread, read on the scheduler thread (the Frames
 * poller, Task 14). Each attempt has its own counters, swapped in whole by [begin], so a frame racing
 * the swap counts toward one attempt or the other, never toward a third. Before any attempt, nothing
 * is counted.
 */
class FrameTally {
  private class Counters(val attemptId: Int) {
    val video = AtomicLong()
    val audio = AtomicLong()
    val bytes = AtomicLong()
  }

  @Volatile private var current: Counters? = null

  fun begin(attemptId: Int) {
    current = Counters(attemptId)
  }

  fun counted(mime: String?, bytes: Int) {
    val counters = current ?: return
    when {
      mime?.startsWith("video/") == true -> counters.video.incrementAndGet()
      mime?.startsWith("audio/") == true -> counters.audio.incrementAndGet()
    }
    counters.bytes.addAndGet(bytes.toLong())
  }

  /** Null for any attempt but the current one. */
  fun read(attemptId: Int): FrameCount? = of(attemptId)?.let { FrameCount(it.video.get(), it.audio.get()) }

  fun bytes(attemptId: Int): Long? = of(attemptId)?.bytes?.get()

  private fun of(attemptId: Int): Counters? = current?.takeIf { it.attemptId == attemptId }
}
