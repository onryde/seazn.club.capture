package com.seazn.capture.engine.adapter

import com.seazn.capture.engine.core.Command
import com.seazn.capture.engine.core.CommandSink
import com.seazn.capture.engine.core.Input

/**
 * A failure the glue knows no retry can heal: a codec that cannot be configured (CD11). A refused
 * permission is not one (the core's `PermissionsAnswered`), and neither is a camera another app holds
 * (P12: that is contention, recovered by the reopen).
 */
class PermanentPlatformFailure(message: String, cause: Throwable? = null) : Exception(message, cause)

enum class Scope {
  /** Lasts the process: a missing native library does not come back. */
  PROCESS,

  /** Lasts the pairing: the operator's tap on Continue re-pairs (`tapToPair`), and may succeed. */
  PAIRING,
}

object Failures {
  private const val MAX_CAUSES = 8

  fun permanent(failure: Throwable): Boolean =
    generateSequence(failure) { it.cause }.take(MAX_CAUSES).any { it is LinkageError || it is PermanentPlatformFailure }

  /** The class and message, for the record, which scrubs the message as text (CD6). */
  fun describe(failure: Throwable): String = failure.javaClass.simpleName + (failure.message?.let { ": $it" } ?: "")
}

/**
 * Carry 18. Once a permanent failure is known, every later attempt is answered at once with
 * `PlatformFailed(thatAttemptId)`, and no connect reaches the platform. Every other command passes:
 * End and Disconnect must still clean up, and HTTP still answers.
 *
 * Runs only on the scheduler thread, which `BridgeCore` (Task 20) guarantees, so it needs no lock.
 */
class StickyFailure(private val inner: CommandSink, private val report: (Input) -> Unit) : CommandSink {
  private class Held(val message: String, val scope: Scope)

  private var held: Held? = null

  /** One report a pairing: a second failure never ends a pairing twice, and the first in a new pairing ends that one. */
  private var reported = false

  val failed: Boolean
    get() = held != null

  /**
   * Reported once a pairing, at once, against the attempt in hand: the pairing ends fatal-error, named,
   * from any phase but Idle, where the machine only records it (review C0b M3). A process failure
   * after a pairing one outlasts the pairing; a pairing one never shortens a process one.
   */
  fun fail(message: String, attemptInHand: Int, scope: Scope) {
    val current = held
    if (current == null || (scope == Scope.PROCESS && current.scope == Scope.PAIRING)) held = Held(message, scope)
    if (reported) return
    reported = true
    report(Input.PlatformFailed(attemptInHand, message))
  }

  /** A new pairing may succeed where the last one's codec failed. A missing library stays missing. */
  fun pairAccepted() {
    reported = false
    if (held?.scope == Scope.PAIRING) held = null
  }

  override fun execute(command: Command) {
    val current = held
    val attempt = attemptOf(command)
    if (current != null && attempt != null) report(Input.PlatformFailed(attempt, current.message)) else inner.execute(command)
  }

  private fun attemptOf(command: Command): Int? =
    when (command) {
      is Command.Connect -> command.attemptId
      is Command.Rebuild -> command.next.attemptId
      is Command.StartNewSession -> command.next.attemptId
      else -> null
    }
}
