package com.seazn.capture.engine.core

/**
 * The server's word about the broadcast the engine holds (amendment, _One rule for the server's
 * word_). One rule over the beat's answer and the code's answer, so the two can never disagree about
 * the same sid. Replaces plan B's `SessionOver` (final review M-4).
 */
sealed interface ServerWord {
  /** [sid] is null only for a 410 to a call that named no sid: it ends nothing. */
  data class Over(val sid: String?, val endReason: String?) : ServerWord

  /** [cause] is null for the code's answer, which does not say who started it. */
  data class Open(val sid: String, val cause: Cause?) : ServerWord

  data object NoBroadcast : ServerWord

  data object Replaced : ServerWord

  data object Taken : ServerWord

  data object CodeEnded : ServerWord

  data object NotFound : ServerWord

  /** Counted; nothing changes. */
  data object NoEvidence : ServerWord

  /** Against the held sid: `Over(held)`, `NoBroadcast` and `Open(N ≠ held)` all mean it is over. */
  fun ends(held: String): Boolean =
    when (this) {
      is Over -> sid == held
      NoBroadcast -> true
      is Open -> sid != held
      else -> false
    }

  companion object {
    /** Descriptor states that mean the broadcast is over. */
    val OVER_STATES = setOf("ending", "completed", "failed")

    /** A beat's answer. [named] is the sid the beat carried, or its `stopped`, or null (RR3). */
    fun ofBeat(response: HeartbeatResponse, named: String?): ServerWord {
      if (response !is HeartbeatResponse.Answered) return NoEvidence
      return when (response.status) {
        401 -> CodeEnded
        404 -> NotFound
        // Beats are no longer answered 410 (2026-10-01); one is still read as the web ruled for any code call.
        410 -> Over(named, response.reply?.endReason)
        in 200..299 -> ofReply(response.reply)
        else -> NoEvidence
      }
    }

    private fun ofReply(reply: BeatReply?): ServerWord {
      val sid = reply?.sid
      return when (reply?.state) {
        "waiting" -> NoBroadcast
        "replaced" -> Replaced
        "taken" -> Taken
        "go-live" -> sid?.let { Open(it, Cause.startedBy(reply.startedBy)) } ?: NoEvidence
        "live" -> sid?.let { Open(it, Cause.REJOIN) } ?: NoEvidence
        "over" -> sid?.let { Over(it, reply.endReason) } ?: NoEvidence
        else -> NoEvidence
      }
    }

    /** The code's answer, at Arming or on a reconnect. [named] is the held sid. */
    fun ofCode(answer: CodeAnswer, named: String?): ServerWord =
      when (answer) {
        is CodeAnswer.Open -> Open(answer.sid, null)
        is CodeAnswer.Over -> Over(answer.sid, answer.endReason)
        is CodeAnswer.Waiting -> NoBroadcast
        is CodeAnswer.Status ->
          when (answer.status) {
            401 -> CodeEnded
            404 -> NotFound
            410 -> Over(named, answer.endReason)
            else -> NoEvidence
          }
        // No `cred` naming another sid while one is held is still "another sid" (M8): it ends the held one.
        is CodeAnswer.NotCurrent -> if (named != null && answer.sid != named) Open(answer.sid, null) else NoEvidence
        is CodeAnswer.ForeignIngest, is CodeAnswer.Unreadable, is CodeAnswer.Unreachable -> NoEvidence
      }
  }
}
