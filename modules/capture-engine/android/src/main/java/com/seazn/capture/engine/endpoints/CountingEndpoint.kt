package com.seazn.capture.engine.endpoints

import android.media.MediaFormat
import com.seazn.capture.engine.adapter.FrameTally
import io.github.thibaultbee.streampack.core.elements.data.Frame
import io.github.thibaultbee.streampack.core.elements.endpoints.IEndpointInternal

/** F-P5-4: counts the encoded frames that reached the endpoint, video apart from audio, then writes them. */
class CountingEndpoint(
  private val inner: IEndpointInternal,
  private val tally: FrameTally,
  private val clock: CaptureClockLine,
) : IEndpointInternal by inner {
  override suspend fun write(frame: Frame, streamPid: Int) {
    val mime = frame.format.getString(MediaFormat.KEY_MIME)
    tally.counted(mime, frame.rawBuffer.remaining())
    if (mime?.startsWith("video/") == true) clock.videoFrame(frame.ptsInUs)
    inner.write(frame, streamPid)
  }
}
