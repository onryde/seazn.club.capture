package com.seazn.capture.engine.capture

import io.github.thibaultbee.streampack.core.elements.sources.audio.IAudioSource

/**
 * Task 37's MicWatch needs our AudioRecord's session id. StreamPack keeps the AudioRecord in a private
 * field, `audioRecord`, of its internal `AudioRecordSource` (3.2.0 `AudioRecordSource.kt:44`), which
 * `MicrophoneSource` extends. A failure is null: MicWatch then reports nothing, and the capture records it
 * once per opening as `watch-failed {action: "mic-session"}` (N8).
 */
object AudioSessionIds {
  fun of(source: IAudioSource): Int? =
    try {
      val field =
        generateSequence(source.javaClass as Class<*>) { it.superclass }.firstNotNullOfOrNull { type ->
          type.declaredFields.firstOrNull { it.name == "audioRecord" }
        } ?: return null
      field.isAccessible = true
      (field.get(source) as? android.media.AudioRecord)?.audioSessionId
    } catch (e: ReflectiveOperationException) {
      null
    } catch (e: SecurityException) {
      null
    }
}
