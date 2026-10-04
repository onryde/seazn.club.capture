package com.seazn.capture.engine.adapter

/** One `AudioRecordingConfiguration`, as the rule reads it: whose recording, and whether the system silenced it. */
data class RecordingConfig(val sessionId: Int, val silenced: Boolean)

/**
 * F-P5-8: a call silences our recording, and only ours counts, matched by our AudioRecord's session
 * id. `isClientSilenced` is API 29, and every supported phone has it (minSdk 31, CD34), so there is
 * no SDK argument. Android hands every recording's configuration on each change; this reports only
 * a change of ours. Not silenced is the baseline, so the first silenced reading is a change and the
 * first unsilenced one is not. With no session id of ours (no config has a null id), or our
 * recording not among the configs, there is no reading, and the last word told stands. Called on
 * the callback's one looper (Task 33).
 */
class MicSilenceWatch {
  private var last = false

  /** The new value when ours changed, else null. */
  fun update(ours: Int?, configs: List<RecordingConfig>): Boolean? {
    val config = configs.firstOrNull { it.sessionId == ours } ?: return null
    if (config.silenced == last) return null
    last = config.silenced
    return last
  }
}
