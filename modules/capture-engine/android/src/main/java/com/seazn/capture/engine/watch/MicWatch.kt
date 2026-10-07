package com.seazn.capture.engine.watch

import android.content.Context
import android.media.AudioManager
import android.media.AudioRecordingConfiguration
import android.os.Handler
import android.os.Looper
import com.seazn.capture.engine.adapter.MicSilenceWatch
import com.seazn.capture.engine.adapter.RecordingConfig
import com.seazn.capture.engine.core.Input
import com.seazn.capture.engine.core.RecordEntry

/**
 * F-P5-8: a call silencing our recording, matched by our AudioRecord's session id. `isClientSilenced`
 * is API 29; minSdk is 31 (CD34). [sessionId] is the capture's (`StreamerAdapter.audioSessionId`): the
 * meter's recording before air, StreamPack's on air (review I-1). When it is null the rule reads
 * nothing, and the capture records StreamPack's once per opening (N8). Holds no session state of its own.
 */
class MicWatch(
  private val context: Context,
  private val sessionId: () -> Int?,
  private val rule: MicSilenceWatch,
  private val report: (Input) -> Unit,
  private val line: (RecordEntry) -> Unit,
) {
  fun start() {
    val audio = context.getSystemService(AudioManager::class.java) ?: return
    audio.registerAudioRecordingCallback(Callback(), Handler(Looper.getMainLooper()))
  }

  /** On the main looper alone, the rule's one thread (Task 18). */
  private inner class Callback : AudioManager.AudioRecordingCallback() {
    override fun onRecordingConfigChanged(configs: List<AudioRecordingConfiguration>) {
      try {
        val read = configs.map { RecordingConfig(it.clientAudioSessionId, it.isClientSilenced) }
        rule.update(sessionId(), read)?.let { report(Input.MicSilenced(it)) }
      } catch (e: Exception) {
        line(RecordEntry("watch-failed", listOf("action" to "mic", "error" to e.javaClass.simpleName)))
      }
    }
  }
}
