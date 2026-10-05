package com.seazn.capture.engine

import android.annotation.SuppressLint
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.os.Handler
import android.os.Looper
import android.os.PowerManager
import android.os.SystemClock
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import com.seazn.capture.engine.adapter.NotificationText
import com.seazn.capture.engine.core.RecordEntry
import java.io.File
import java.util.Locale

/**
 * A5, CD10, CD16 and CD21: what keeps a pairing alive with the phone locked, and who may start it. It
 * carries out `AskPermissions`, `Hold` and `Release`, and holds no rule. Its work runs on the main
 * looper (M8): the marker write, the wake lock, the permission request and the service start are file
 * IO and binder calls, which never run on the scheduler thread.
 */
class PairingKeeper(
  private val context: Context,
  private val permissions: Permissions,
  private val line: (RecordEntry) -> Unit,
  private val answered: (Boolean) -> Unit,
  private val askFailed: (Throwable) -> Unit,
  language: () -> String?,
) {
  private val main = Handler(Looper.getMainLooper())
  private val marker = File(context.filesDir, MARKER)
  private val wakeLock =
    context.getSystemService(PowerManager::class.java)
      .newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "seazn:capture")
      .apply { setReferenceCounted(false) }
  private val notes = CaptureNotification(context, language)

  /** CD16: true from `Hold` so the keep-open caption never flashes; false once the start fails or at `Release`. */
  @Volatile
  var survivesBackground = false
    private set

  /**
   * Review C7 I-3: the service went foreground, so the keeper may stop it. Main looper only: the service's
   * callbacks and [finish] both run there.
   */
  private var foreground = false

  /** `Command.AskPermissions`, on the scheduler thread; returns at once. */
  fun ask() {
    main.post { asking() }
  }

  /** `Command.Hold`: the pairing is Paired. On the scheduler thread; returns at once. */
  fun hold() {
    survivesBackground = true
    main.post {
      recordOnly("marker") { marker.writeText("1") }
      recordOnly("wake-lock") { lock() }
      startService()
    }
  }

  /**
   * `Command.Release` alone: an unpair, Ended, or A8's final beat answered (C0b: the tick runs until
   * then). With no service running and no lock held, it stops and releases nothing. Scheduler thread.
   */
  fun release() {
    survivesBackground = false
    main.post { finish() }
  }

  /** The service could not go foreground (C3's catch): the pairing carries on, and says to keep the app open. */
  fun fgsRefused(e: Throwable) {
    survivesBackground = false
    foreground = false
    line(RecordEntry("fgs-refused", listOf("error" to e.javaClass.simpleName)))
  }

  /** Main looper. A throw here would end the process, so it costs a line instead (N1). */
  fun notify(wire: Map<String, Any?>) = recordOnly("notify") { notes.update(wire) }

  /**
   * Review C7 I-3: the service went foreground. True while the pairing still holds it; false when a Release
   * came first and could stop nothing, so the service stops itself, which can no longer crash. Main looper.
   */
  fun foregrounded(): Boolean {
    foreground = survivesBackground
    return foreground
  }

  /**
   * The notification the service goes foreground with: the pairing's, or, when that cannot be built, a plain
   * one (review C7 I-3). The service must call `startForeground` whatever failed before it.
   */
  fun notification(): Notification =
    try {
      notes.current()
    } catch (e: Exception) {
      line(RecordEntry("keeper-failed", listOf("action" to "notification", "error" to e.javaClass.simpleName)))
      recordOnly("channel") { notes.channel() } // the failure may have been the channel's
      notes.plain()
    }

  /** CD21: a grant or a refusal is the engine's to read; a request that could not be made ends the pairing. */
  private fun asking() {
    try {
      permissions.request { grant ->
        when (grant) {
          Grant.GRANTED -> answered(true)
          Grant.REFUSED -> answered(false)
          Grant.UNAVAILABLE -> askFailed(IllegalStateException("permission request unavailable"))
        }
      }
    } catch (e: Exception) {
      line(RecordEntry("keeper-failed", listOf("action" to "ask", "error" to e.javaClass.simpleName)))
      askFailed(e)
    }
  }

  @SuppressLint("WakelockTimeout") // CD10: held for the pairing, released at Release, never on a timer
  private fun lock() {
    wakeLock.acquire()
    line(RecordEntry("wake-lock", listOf("state" to "held")))
  }

  private fun startService() {
    try {
      ContextCompat.startForegroundService(context, Intent(context, CaptureForegroundService::class.java))
    } catch (e: IllegalStateException) { // ForegroundServiceStartNotAllowedException (API 31+)
      fgsRefused(e)
    } catch (e: SecurityException) {
      fgsRefused(e)
    }
  }

  /**
   * Review C7 M-1: each step has its own guard, so a stop that throws still releases the wake lock and deletes
   * the marker, which would otherwise read as a lost session at the next launch.
   */
  private fun finish() {
    // I-3: a service still starting stops itself once foreground (CaptureForegroundService.onStartCommand).
    // The flag clears after the stop: one that threw leaves the service marked, for the next Release to stop.
    recordOnly("stop-service") {
      if (foreground) {
        context.stopService(Intent(context, CaptureForegroundService::class.java))
        foreground = false
      }
    }
    recordOnly("wake-lock") {
      if (wakeLock.isHeld) {
        wakeLock.release()
        line(RecordEntry("wake-lock", listOf("state" to "released")))
      }
    }
    recordOnly("marker") { marker.delete() }
  }

  /** N1: the marker, the wake lock, the notification and the teardown cost a line when they fail, never the pairing. */
  private fun recordOnly(action: String, block: () -> Unit) {
    try {
      block()
    } catch (e: Exception) {
      line(RecordEntry("keeper-failed", listOf("action" to action, "error" to e.javaClass.simpleName)))
    }
  }

  companion object {
    const val MARKER = "session.marker"
  }
}

/**
 * The persistent notification (AGENTS §9 as A5 rewrites it): "Paired · waiting for Go live", then
 * STARTING with its not-ready line, then `LIVE · 3000k · 47 min`, in the pairing's language (P3), else
 * the phone's. `NotificationText.content` decides the words (Task 18); this holds no rule.
 */
class CaptureNotification(private val context: Context, private val language: () -> String?) {
  @Volatile private var text = ""

  @Volatile private var lang = "en"
  private var shownAtMs = 0L
  private var shownKind: Any? = null

  /** At most once every 5 s, or on a change of state word: notifications are rate-limited. Main looper. */
  @SuppressLint("MissingPermission") // posted only when areNotificationsEnabled (POST_NOTIFICATIONS on API 33+)
  fun update(wire: Map<String, Any?>) {
    lang = NotificationText.language(language().orEmpty(), Locale.getDefault().language)
    val kind = (wire["state"] as? Map<*, *>)?.get("kind")
    val now = SystemClock.elapsedRealtime()
    text = NotificationText.content(wire, System.currentTimeMillis(), lang)
    if (kind == shownKind && now - shownAtMs < RATE_MS) return
    shownKind = kind
    shownAtMs = now
    NotificationManagerCompat.from(context).takeIf { it.areNotificationsEnabled() }?.notify(ID, current())
  }

  /**
   * T18 m2: the line runs to about 60 characters (fr, STARTING with its not-ready reason), past one
   * collapsed row, so the expanded notification shows it whole.
   */
  fun current(): Notification {
    channel()
    val open = context.packageManager.getLaunchIntentForPackage(context.packageName)
    val tap = PendingIntent.getActivity(context, 0, open, PendingIntent.FLAG_IMMUTABLE)
    return NotificationCompat.Builder(context, CHANNEL_ID)
      .setSmallIcon(R.drawable.slate)
      .setContentText(text)
      .setStyle(NotificationCompat.BigTextStyle().bigText(text))
      .setOngoing(true)
      .setOnlyAlertOnce(true)
      .setContentIntent(tap)
      .build()
  }

  /** Review C7 I-3: what `startForeground` takes when [current] could not be built: no text and no tap. */
  fun plain(): Notification = NotificationCompat.Builder(context, CHANNEL_ID).setSmallIcon(R.drawable.slate).setOngoing(true).build()

  /**
   * M18, review C7 M-2: made again before every post, with the current language's name. Android keeps the
   * channel and its importance as first made and renames it, so the channel's name follows the language.
   */
  fun channel() {
    val name = NotificationText.CHANNEL[lang] ?: NotificationText.CHANNEL.getValue("en")
    context.getSystemService(NotificationManager::class.java)
      ?.createNotificationChannel(NotificationChannel(CHANNEL_ID, name, NotificationManager.IMPORTANCE_LOW))
  }

  companion object {
    const val ID = 7_301
    const val CHANNEL_ID = "capture"
    private const val RATE_MS = 5_000L
  }
}
