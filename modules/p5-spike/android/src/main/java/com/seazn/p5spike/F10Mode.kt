package com.seazn.p5spike

import android.content.Context
import java.io.File

/**
 * F-P5-10's experiments, switched from the laptop like the stall hook ([StallSimulation]): the
 * controller pushes `p5-f10-mode` into the app's external files dir before a start. After WhatsApp
 * took camera 1, the broadcast carried noise at 30 fps from the watchdog's recovery on, and a
 * stream rebuild did not heal it. Two questions are open, one per rule:
 *
 * - [HOLD]: is the trigger our rebuild while the camera is contended? Never rebuild then; recover
 *   when the camera is released.
 * - [REOPEN]: does reopening the camera source, not just the stream, heal it? Do so on release.
 * - [BOTH]: hold, then reopen on release, then recover if video is still stalled.
 *
 * Absent, unreadable or any other content is [OFF], which is the behaviour before F-P5-10.
 */
enum class F10Mode(val word: String, val hold: Boolean, val reopen: Boolean) {
  OFF("off", hold = false, reopen = false),
  HOLD("hold", hold = true, reopen = false),
  REOPEN("reopen", hold = false, reopen = true),
  BOTH("both", hold = true, reopen = true),
  ;

  /** What was read, so a typo in the pushed file shows on the `f10-mode` row rather than as a silent off. */
  class Reading(val mode: F10Mode, val unrecognised: String?)

  companion object {
    const val FILE_NAME = "p5-f10-mode"

    /** Larger than this is not one word: read nothing rather than fold a stray file into the CSV. */
    private const val MAX_BYTES = 64L

    /** Read at every start intent, so a file pushed just before a start applies to it. Never throws. */
    fun read(context: Context): Reading {
      val text = runCatching {
        val file = File(context.getExternalFilesDir(null), FILE_NAME)
        if (file.isFile && file.length() in 1..MAX_BYTES) file.readText().trim() else null
      }.getOrNull()
      val mode = entries.firstOrNull { it != OFF && it.word == text } ?: OFF
      return Reading(mode, unrecognised = text?.takeIf { mode == OFF && it.isNotEmpty() && it != OFF.word })
    }
  }
}
