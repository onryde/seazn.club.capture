package com.seazn.p5spike

import android.content.Context
import android.media.AudioManager
import android.media.AudioRecord
import android.media.AudioRecordingConfiguration
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import androidx.annotation.RequiresApi

/**
 * F-P5-8: an answered phone call made Android silence the app's record track for the whole call.
 * Audio frames kept counting at ~47/s, so no frame counter could see it, and the broadcast carried
 * 13 s of silence. AGENTS.md §9: every audio-session interruption is a visible state.
 *
 * The platform's own signal is `AudioRecordingConfiguration.isClientSilenced()` (API 29), delivered
 * through `AudioManager.AudioRecordingCallback` (API 24). What a non-privileged app is given (AOSP
 * `RecordingActivityMonitor`, android14-release): every active recording on the device, each an
 * `anonymizedCopy` with uid -1 and an empty package name, but with the client's audio session ID
 * and its silenced flag intact. So "ours" cannot be told by package; it is told by session ID,
 * matched against our own `AudioRecord` ([ownSessionId]). Another app's silenced capture (an
 * assistant's hotword, say, which Android silences while we record) must not read as ours.
 *
 * When our session ID cannot be read, every silenced configuration is taken as ours, and each row
 * says which basis was used (`tie=session` or `tie=any`).
 *
 * Below API 29 there is no silenced flag to read: nothing is watched, [silenced] stays
 * false, and one `mic-silence-unwatched` row says so.
 */
class MicSilence(
  private val ownSessionId: () -> Int?,
  private val onEvent: (String, Array<Pair<String, Any?>>) -> Unit,
) {
  /** For the ~1 Hz snapshot, read from the sampler's thread. */
  @Volatile var silenced = false
    private set

  /** When the open silence began; touched only on the main looper, where the callback runs. */
  private var silencedSinceMs: Long? = null

  /** Once, for the session's lifetime: the session is a process singleton and is never torn down. */
  fun register(context: Context) {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) {
      onEvent("mic-silence-unwatched", arrayOf("sdk" to Build.VERSION.SDK_INT))
      return
    }
    val audio = context.getSystemService(AudioManager::class.java) ?: return
    val main = Handler(Looper.getMainLooper())
    audio.registerAudioRecordingCallback(callback(), main)
    // The callback only reports changes; judge what is active now, on the callback's thread.
    main.post { judge(audio.activeRecordingConfigurations) }
  }

  @RequiresApi(Build.VERSION_CODES.Q)
  private fun callback() = object : AudioManager.AudioRecordingCallback() {
    override fun onRecordingConfigChanged(configs: MutableList<AudioRecordingConfiguration>) = judge(configs)
  }

  @RequiresApi(Build.VERSION_CODES.Q)
  private fun judge(configs: List<AudioRecordingConfiguration>) {
    val own = ownSessionId()
    val tie = if (own != null) "session" else "any"
    val ours = if (own != null) configs.filter { it.clientAudioSessionId == own } else configs
    // Evidence of what a non-privileged app sees: session:source:silenced for every config.
    onEvent("recording-configs", arrayOf("ownSessionId" to own, "configs" to describe(configs)))
    val now = ours.any { it.isClientSilenced }
    val since = silencedSinceMs
    when {
      now && since == null -> {
        silencedSinceMs = SystemClock.elapsedRealtime()
        silenced = true
        onEvent("mic-silenced", arrayOf("ownSessionId" to own, "tie" to tie))
      }
      !now && since != null -> {
        silencedSinceMs = null
        silenced = false
        onEvent("mic-restored", arrayOf("msSilenced" to SystemClock.elapsedRealtime() - since, "tie" to tie))
      }
    }
  }

  @RequiresApi(Build.VERSION_CODES.Q)
  private fun describe(configs: List<AudioRecordingConfiguration>): String =
    configs.joinToString(" ") { config ->
      val state = if (config.isClientSilenced) "silenced" else "live"
      "${config.clientAudioSessionId}:${config.clientAudioSource}:$state"
    }.ifEmpty { "none" }

  companion object {
    /**
     * StreamPack 3.2.0 keeps its `AudioRecord` in a private field of the internal
     * `AudioRecordSource`, and exposes no session ID. Found by type rather than by name, walking the
     * class hierarchy, so a renamed field still resolves. Null when there is none, which makes the
     * callers fall back to `tie=any`. Read at every callback: StreamPack builds a new AudioRecord,
     * with a new session, whenever the source is reconfigured.
     */
    fun audioSessionIdOf(source: Any): Int? {
      var type: Class<*>? = source.javaClass
      while (type != null) {
        val field = type.declaredFields.firstOrNull { AudioRecord::class.java.isAssignableFrom(it.type) }
        if (field != null) {
          field.isAccessible = true
          return (field.get(source) as? AudioRecord)?.audioSessionId
        }
        type = type.superclass
      }
      return null
    }
  }
}
