package com.seazn.capture.engine.endpoints

import android.content.Context
import com.seazn.capture.engine.adapter.FrameTally
import com.seazn.capture.engine.srt.SeaznSrtSink
import io.github.thibaultbee.streampack.core.elements.endpoints.IEndpointInternal
import io.github.thibaultbee.streampack.core.elements.endpoints.composites.CompositeEndpoint
import io.github.thibaultbee.streampack.core.elements.endpoints.composites.muxers.ts.TsMuxer
import io.github.thibaultbee.streampack.core.pipelines.IDispatcherProvider
import io.github.thibaultbee.streampack.ext.rtmp.elements.endpoints.RtmpEndpointFactory
import kotlinx.coroutines.CoroutineDispatcher

/** CD14 and CD15: SRT through TsMuxer and our sink, RTMPS through StreamPack's endpoint on our IO threads; both counted. */
class CaptureEndpointFactory(
  private val tally: FrameTally,
  private val sink: SeaznSrtSink,
  private val rtmpIo: CoroutineDispatcher,
  private val clock: CaptureClockLine,
) : IEndpointInternal.Factory {
  override fun create(context: Context, dispatcherProvider: IDispatcherProvider): IEndpointInternal {
    val srt = CompositeEndpoint(TsMuxer(), sink)
    val rtmp = RtmpEndpointFactory().create(context, RtmpDispatcherProvider(dispatcherProvider, rtmpIo))
    return CountingEndpoint(RoutingEndpoint(srt, rtmp), tally, clock)
  }
}
