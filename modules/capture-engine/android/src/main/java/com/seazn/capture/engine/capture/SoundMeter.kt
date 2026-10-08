package com.seazn.capture.engine.capture

import android.annotation.SuppressLint
import android.media.AudioFormat
import android.media.AudioRecord
import android.media.MediaRecorder
import com.seazn.capture.engine.adapter.PcmPeak
import com.seazn.capture.engine.core.RecordEntry
import java.nio.ByteBuffer
import java.nio.ByteOrder

/**
 * A11's sound check before a broadcast publishes (CD42): our own AudioRecord, for the meter only, on
 * its own thread. Stopped before every connect, so StreamPack's recording is the only one on air.
 * Before air it is our one recording, so MicWatch watches its session (review I-1, spec §4).
 */
class SoundMeter(private val offer: (Double) -> Unit, private val line: (RecordEntry) -> Unit) {
  private var record: AudioRecord? = null

  /** The recording's session while it runs, else null; read on the main looper by MicWatch, so never under the lock. */
  @Volatile private var session: Int? = null

  fun sessionId(): Int? = session

  @SuppressLint("MissingPermission") // CD37: the capture opens only after RECORD_AUDIO is granted
  @Synchronized
  fun start() {
    if (record != null) return
    val size = maxOf(AudioRecord.getMinBufferSize(RATE, MONO, PCM16), MIN_BYTES)
    val made =
      try {
        AudioRecord(MediaRecorder.AudioSource.MIC, RATE, MONO, PCM16, size).also {
          try {
            session = it.audioSessionId // before it records: MicWatch's callback for this very start reads it
            it.startRecording()
          } catch (e: Exception) {
            it.release() // built but would not start: it still holds the microphone
            throw e
          }
        }
      } catch (e: Exception) { // IllegalStateException, IllegalArgumentException, SecurityException
        session = null
        return line(RecordEntry("watch-failed", listOf("action" to "sound", "error" to e.javaClass.simpleName)))
      }
    record = made
    Thread({ pump(made, size) }, "capture-sound").start()
  }

  @Synchronized
  fun stop() {
    val held = record ?: return
    record = null
    session = null
    held.stop()
    held.release()
  }

  /** Ends when the record is stopped: `read` then returns an error code, never blocks. */
  private fun pump(source: AudioRecord, size: Int) {
    val buffer = ByteBuffer.allocateDirect(size).order(ByteOrder.LITTLE_ENDIAN)
    while (true) {
      buffer.clear()
      val read = source.read(buffer, size)
      if (read <= 0) return
      buffer.limit(read)
      offer(PcmPeak.of(buffer))
    }
  }

  private companion object {
    const val RATE = 48_000
    const val MONO = AudioFormat.CHANNEL_IN_MONO
    const val PCM16 = AudioFormat.ENCODING_PCM_16BIT
    const val MIN_BYTES = 3_840 // 40 ms at 48 kHz mono, 16-bit
  }
}
