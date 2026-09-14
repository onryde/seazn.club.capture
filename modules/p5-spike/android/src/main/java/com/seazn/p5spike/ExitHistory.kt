package com.seazn.p5spike

import android.app.ActivityManager
import android.app.ActivityManager.RunningAppProcessInfo
import android.app.ApplicationExitInfo
import android.content.Context
import android.os.Build
import androidx.annotation.RequiresApi
import java.time.Instant

/**
 * Why this app's last processes ended, read back when the next one starts. The soak runs with the
 * USB cable out — no adb, no logcat — so if the process dies, this is the only account of why it
 * died that anyone will get (F-P5-3: the app can die while the handset stays reachable).
 *
 * One `exit-history` row comes first, always, so a CSV with no `previous-exit` rows says "none
 * recorded" or "could not read" rather than nothing at all — an absent reading must not pass for
 * a clean one.
 */
object ExitHistory {
  /** Enough to see through a relaunch loop without folding the whole history into every CSV. */
  private const val RECORDS = 5
  private const val DESCRIPTION_MAX = 200

  /**
   * The system writes the description, but nothing documents that it never quotes a library's
   * message, and a connect failure's message can quote a URL with the stream key in it. At process
   * start no session file is loaded, so SpikeSession's scrub has no secrets to mask yet. Anything
   * URL-shaped is dropped here instead.
   */
  private val URL = Regex("""[A-Za-z][A-Za-z0-9+.-]*://\S+""")

  fun record(context: Context) {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.R) {
      return SpikeSession.event("exit-history", "available" to false, "sdk" to Build.VERSION.SDK_INT)
    }
    val exits = try {
      context.getSystemService(ActivityManager::class.java)
        .getHistoricalProcessExitReasons(context.packageName, 0, RECORDS)
    } catch (failure: Exception) {
      return SpikeSession.event("exit-history", "available" to false, "error" to failure.javaClass.simpleName)
    }
    SpikeSession.event("exit-history", "available" to true, "count" to exits.size, "sdk" to Build.VERSION.SDK_INT)
    // Newest first, as the platform returns them.
    exits.forEach { SpikeSession.event("previous-exit", *fields(it)) }
  }

  @RequiresApi(Build.VERSION_CODES.R)
  private fun fields(exit: ApplicationExitInfo): Array<Pair<String, Any?>> = arrayOf(
    "exitAtMs" to exit.timestamp,
    "exitAt" to Instant.ofEpochMilli(exit.timestamp).toString(),
    "reason" to reasonName(exit.reason),
    "reasonCode" to exit.reason,
    // The exit code for exit-self, the signal number for signaled; 0 otherwise.
    "status" to exit.status,
    "importance" to importanceName(exit.importance),
    "importanceCode" to exit.importance,
    "pssKb" to exit.pss,
    "rssKb" to exit.rss,
    // Last, because it is free text with spaces in it and a key=value reader stops at the first.
    "description" to exit.description?.replace(URL, "<url>")?.take(DESCRIPTION_MAX),
  )

  /** Names, because nobody reading a cable-free CSV will have the SDK to look a number up in. */
  internal fun reasonName(reason: Int): String = when (reason) {
    ApplicationExitInfo.REASON_UNKNOWN -> "unknown"
    ApplicationExitInfo.REASON_EXIT_SELF -> "exit-self"
    ApplicationExitInfo.REASON_SIGNALED -> "signaled"
    ApplicationExitInfo.REASON_LOW_MEMORY -> "low-memory"
    ApplicationExitInfo.REASON_CRASH -> "crash"
    ApplicationExitInfo.REASON_CRASH_NATIVE -> "crash-native"
    ApplicationExitInfo.REASON_ANR -> "anr"
    ApplicationExitInfo.REASON_INITIALIZATION_FAILURE -> "initialization-failure"
    ApplicationExitInfo.REASON_PERMISSION_CHANGE -> "permission-change"
    ApplicationExitInfo.REASON_EXCESSIVE_RESOURCE_USAGE -> "excessive-resource-usage"
    ApplicationExitInfo.REASON_USER_REQUESTED -> "user-requested"
    ApplicationExitInfo.REASON_USER_STOPPED -> "user-stopped"
    ApplicationExitInfo.REASON_DEPENDENCY_DIED -> "dependency-died"
    ApplicationExitInfo.REASON_OTHER -> "other"
    ApplicationExitInfo.REASON_FREEZER -> "freezer"
    ApplicationExitInfo.REASON_PACKAGE_STATE_CHANGE -> "package-state-change"
    ApplicationExitInfo.REASON_PACKAGE_UPDATED -> "package-updated"
    // A reason newer than compileSdk 36 keeps its number rather than becoming "unknown".
    else -> "reason-$reason"
  }

  /** Whether the process was foreground-service or cached when it went is most of the story for F-P5-3. */
  internal fun importanceName(importance: Int): String = when (importance) {
    RunningAppProcessInfo.IMPORTANCE_FOREGROUND -> "foreground"
    RunningAppProcessInfo.IMPORTANCE_FOREGROUND_SERVICE -> "foreground-service"
    RunningAppProcessInfo.IMPORTANCE_VISIBLE -> "visible"
    RunningAppProcessInfo.IMPORTANCE_PERCEPTIBLE -> "perceptible"
    RunningAppProcessInfo.IMPORTANCE_SERVICE -> "service"
    RunningAppProcessInfo.IMPORTANCE_TOP_SLEEPING -> "top-sleeping"
    RunningAppProcessInfo.IMPORTANCE_CANT_SAVE_STATE -> "cant-save-state"
    RunningAppProcessInfo.IMPORTANCE_CACHED -> "cached"
    RunningAppProcessInfo.IMPORTANCE_EMPTY -> "empty"
    RunningAppProcessInfo.IMPORTANCE_GONE -> "gone"
    else -> "importance-$importance"
  }
}
