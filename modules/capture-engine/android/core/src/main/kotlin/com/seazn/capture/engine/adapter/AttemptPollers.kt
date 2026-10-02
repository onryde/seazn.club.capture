package com.seazn.capture.engine.adapter

import com.seazn.capture.engine.core.Cancellable
import com.seazn.capture.engine.core.Command
import com.seazn.capture.engine.core.Input
import com.seazn.capture.engine.core.LinkCounters
import com.seazn.capture.engine.core.Scheduler

data class FrameCount(val video: Long, val audio: Long)

/**
 * Carries 16 and 19 (CD12): one Frames reader every 500 ms and one Link reader every second, for the
 * newest attempt that connected. Begun by its `Connected`, and kept through a camera switch so the LIVE
 * gate's bound holds. Ended by its drop or connect failure, or by a command that ends the attempt.
 * Scheduler thread only.
 *
 * Attempt ids only grow, across sessions too ([com.seazn.capture.engine.core.Ids]), so a `Connected`
 * older than the running attempt is stale: the machine answers it with a `Disconnect` of that attempt
 * (stale-connected), and neither the late `Connected` nor that `Disconnect` touches the running one.
 *
 * A reading that throws is not caught here: the throw reaches the scheduler's task boundary
 * ([GuardedScheduler], carry 15), and the next reading is posted first, so the poller keeps ticking.
 */
class AttemptPollers(
  private val scheduler: Scheduler,
  private val frames: (Int) -> FrameCount?,
  private val link: (Int) -> LinkCounters?,
  private val send: (Input) -> Unit,
) {
  var running: Int? = null
    private set

  private var loops: List<Repeating> = emptyList()

  fun onInput(input: Input) {
    when (input) {
      is Input.Connected -> begin(input.attemptId)
      is Input.Dropped -> if (input.attemptId == running) stop()
      is Input.ConnectFailed -> if (input.attemptId == running) stop()
      else -> Unit
    }
  }

  fun onCommand(command: Command) {
    when (command) {
      is Command.Disconnect -> if (command.attemptId == running) stop()
      is Command.Rebuild, is Command.StartNewSession, is Command.End, Command.StopBroadcast -> stop()
      else -> Unit
    }
  }

  private fun begin(attemptId: Int) {
    if (running == attemptId) return
    if (running?.let { attemptId < it } == true) return
    stop()
    running = attemptId
    loops =
      listOf(
        Repeating(scheduler, FRAMES_MS) { frames(attemptId)?.let { send(Input.Frames(attemptId, it.video, it.audio)) } },
        Repeating(scheduler, LINK_MS) { link(attemptId)?.let { send(Input.Link(attemptId, it)) } },
      )
  }

  private fun stop() {
    loops.forEach(Repeating::cancel)
    loops = emptyList()
    running = null
  }

  companion object {
    const val FRAMES_MS = 500L
    const val LINK_MS = 1_000L
  }
}

/** Runs [read] every [periodMs] until cancelled. A cancel between runs stops the next one. */
private class Repeating(private val scheduler: Scheduler, private val periodMs: Long, private val read: () -> Unit) {
  private var next: Cancellable? = null
  private var cancelled = false

  init {
    schedule()
  }

  private fun schedule() {
    next =
      scheduler.schedule(periodMs) {
        if (cancelled) return@schedule
        try {
          read()
        } finally {
          if (!cancelled) schedule()
        }
      }
  }

  fun cancel() {
    cancelled = true
    next?.cancel()
  }
}
