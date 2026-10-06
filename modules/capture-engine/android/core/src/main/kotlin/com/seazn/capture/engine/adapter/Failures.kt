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
  /** Lasts the process: a missing native library does not come back, nor a codec the phone cannot configure. */
  PROCESS,

  /**
   * Lasts the pairing: a failed permission ask, or a pair step that failed for a reason not known to be
   * permanent. The operator's tap on Continue re-pairs (`tapToPair`), and may succeed.
   */
  PAIRING,
}

/**
 * Which failures no retry heals. A command's `Exception` never reaches [GuardedScheduler]: plan B's
 * `Engine.execute` counts it as `command-failed`. So a permanent failure a command throws is classified
 * where the command is routed (Task 20's `executed`), never left to the guard.
 */
object Failures {
  private const val MAX_CAUSES = 8

  fun permanent(failure: Throwable): Boolean =
    generateSequence(failure) { it.cause }.take(MAX_CAUSES).any { it is LinkageError || it is PermanentPlatformFailure }

  /** The class and message, for the record, which scrubs the message as text (CD6). */
  fun describe(failure: Throwable): String = failure.javaClass.simpleName + (failure.message?.let { ": $it" } ?: "")
}

/**
 * Carry 18. Once a permanent failure is known, every later attempt is answered at once with
 * `PlatformFailed(thatAttemptId)`, and no connect reaches the platform. While a process failure is held,
 * a new pairing's permission ask is answered the same way, for [currentAttempt], so that pairing ends
 * fatal-error before any Hold or beat: it never claims a slot it cannot broadcast on (review 13, I1).
 * Every other command passes: End and Disconnect must still clean up, and HTTP still answers.
 *
 * Runs only on the scheduler thread, which `BridgeCore` (Task 20) guarantees, so it needs no lock.
 * [currentAttempt] is the engine's `phase.attemptInHand`, read there.
 */
class StickyFailure(
  private val inner: CommandSink,
  private val currentAttempt: () -> Int,
  private val report: (Input) -> Unit,
) : CommandSink {
  private class Held(val message: String, val scope: Scope)

  private var held: Held? = null

  /** One report a pairing: a second failure never ends a pairing twice, and the first in a new pairing ends that one. */
  private var reported = false

  /** Whether a failure is held: a pairing one until the next accepted pair, a process one for good. */
  val failed: Boolean
    get() = held != null

  /**
   * Reported once a pairing, at once, against the attempt in hand: the pairing ends fatal-error, named.
   * In Idle or Ended, or for an older attempt, the machine only records it (review C0b M3, final review
   * N-4). A process failure after a pairing one outlasts the pairing; a pairing one never shortens a
   * process one, and a second process one never replaces the first.
   */
  fun fail(message: String, attemptInHand: Int, scope: Scope) {
    val current = held
    if (current == null || (scope == Scope.PROCESS && current.scope == Scope.PAIRING)) held = Held(message, scope)
    if (reported) return
    reported = true
    report(Input.PlatformFailed(attemptInHand, message))
  }

  /** A new pairing may succeed where the last one failed for the pairing only. A process failure stays. */
  fun pairAccepted() {
    reported = false
    if (held?.scope == Scope.PAIRING) held = null
  }

  override fun execute(command: Command) {
    val current = held
    val attempt = current?.let { refusedFor(command, it) }
    if (current != null && attempt != null) report(Input.PlatformFailed(attempt, current.message)) else inner.execute(command)
  }

  /** The attempt [failure] answers [command] for, or null when the command passes. */
  private fun refusedFor(command: Command, failure: Held): Int? =
    when (command) {
      is Command.Connect -> command.attemptId
      is Command.Rebuild -> command.next.attemptId
      is Command.StartNewSession -> command.next.attemptId
      // A pairing failure here is the last pairing's: Task 20's noticePair heals it after this pair's commands.
      Command.AskPermissions -> if (failure.scope == Scope.PROCESS) currentAttempt() else null
      else -> null
    }
}
