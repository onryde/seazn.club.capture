package com.seazn.capture.engine.capture

import com.seazn.capture.engine.adapter.PcmPeak
import io.github.thibaultbee.streampack.core.elements.data.RawFrame
import io.github.thibaultbee.streampack.core.elements.processing.audio.IConsumerAudioEffect

/** The permanent meter's source once a broadcast publishes (AGENTS §6): each raw 16-bit frame's peak, before the encoder. */
class AudioLevelEffect(private val offer: (Double) -> Unit) : IConsumerAudioEffect {
  override fun consume(isMuted: Boolean, data: RawFrame) = offer(if (isMuted) 0.0 else PcmPeak.of(data.rawBuffer))

  override fun close() = Unit
}
