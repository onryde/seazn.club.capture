package com.seazn.capture.engine.core

/**
 * Plan D spec §3.4: every beat sent, in the session record, in every build. The record anyone reads after a match is
 * Diagnostics' Share record, the app's last 1,000 lines (`RECORD_CAPACITY`), and a line per beat is about 1,100 over a
 * three-hour match at 10 s. So the beats are summarised, as the spec provides (plan D1, D-3, D-4): a `beat-interval`
 * line each time the cadence the phone beats at changes, with the gap since the beat before, and a `beats` line for
 * each wall-clock minute in which a beat went: how many went, how many failed or never came back, and the last answer
 * word. A minute with no beat writes no line; an answer counts in the minute of the beat before it. `sent` counts
 * beats sent, not 2xx answers: a beat still in flight when the pairing ends is counted neither answered nor failed, so a
 * pairing's last minute can count one beat with no answer.
 *
 * Pure, held in the pairing. The machine writes the open minute when the pairing stops beating ([BeatLogs.closed]).
 */
data class BeatLog(
  /** This pairing's first beat. Beat ids never repeat across pairings, so it tells one pairing's log from the next. */
  val firstBeatId: Int? = null,
  /** The cadence of the last beat sent on the cadence, as [BeatCadence.intervalMs] gave it. */
  val intervalMs: Long? = null,
  /** The last beat sent, on the monotonic clock. */
  val lastSentMonoMs: Long? = null,
  /** The start of the minute being counted, on the wall clock (UTC). */
  val minuteEpochMs: Long? = null,
  val sent: Int = 0,
  val failed: Int = 0,
  /** The last answer word heard in the minute, as the `heartbeat` line writes it, or null. */
  val word: String? = null,
) {
  /**
   * Beat [beatId] goes now. [intervalMs] is its cadence, or null for the A8 final beat, which goes once, off the
   * cadence: counted, with no interval line. Returns the closed minute's line when a new minute opens, and the
   * interval line when the cadence changed.
   */
  fun send(beatId: Int, intervalMs: Long?, held: Boolean, now: Now): Pair<BeatLog, List<RecordEntry>> {
    val minute = now.wallMs - now.wallMs.mod(MINUTE_MS)
    val closed = if (minuteEpochMs != null && minuteEpochMs != minute) listOfNotNull(minuteLine()) else emptyList()
    val counting = if (minuteEpochMs == minute) this else copy(minuteEpochMs = minute, sent = 0, failed = 0, word = null)
    val changed =
      if (intervalMs == null || intervalMs == this.intervalMs) emptyList()
      else listOf(RecordEntry("beat-interval", listOf("intervalMs" to intervalMs, "sinceLastMs" to lastSentMonoMs?.let { now.monoMs - it }, "held" to held)))
    val next =
      counting.copy(
        firstBeatId = firstBeatId ?: beatId,
        intervalMs = intervalMs ?: this.intervalMs,
        lastSentMonoMs = now.monoMs,
        sent = counting.sent + 1,
      )
    return next to closed + changed
  }

  /** A beat's answer ([ok] for a 2xx), or a beat given up ([word] null, not [ok]). */
  fun heard(word: String?, ok: Boolean): BeatLog = copy(failed = if (ok) failed else failed + 1, word = word ?: this.word)

  /** The counted minute's line, or null before the first beat: only [send] opens a minute, and counts its beat. */
  fun minuteLine(): RecordEntry? {
    val minute = minuteEpochMs ?: return null
    return RecordEntry("beats", listOf("minuteEpochMs" to minute, "sent" to sent, "failed" to failed, "word" to word))
  }

  companion object {
    const val MINUTE_MS = 60_000L
  }
}

/**
 * The open minute's line when a pairing stops beating, whatever the input: unpaired, ended (an operator Stop's final
 * beat included, from the Ended pairing's log), or left for a re-pair. One place, so no end path can forget it. The log
 * written is the one the step last held: the one it left for Idle ([Step.leftLog], so the answer that unpaired the
 * phone counts), the Ended pairing's, or else the one the input found (an Unpair or a re-pair changes no beat).
 */
internal object BeatLogs {
  fun closed(before: Phase, step: Step): Step {
    val log = before.beating?.beatLog ?: return step
    val first = log.firstBeatId ?: return step
    if (step.phase.beating?.beatLog?.firstBeatId == first) return step
    val last = step.leftLog ?: step.phase.pairing?.beatLog?.takeIf { it.firstBeatId == first } ?: log
    val line = last.minuteLine() ?: return step
    return step.copy(commands = step.commands + Command.Record(line))
  }
}
