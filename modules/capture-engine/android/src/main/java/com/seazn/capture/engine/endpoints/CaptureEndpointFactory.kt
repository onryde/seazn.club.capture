package com.seazn.capture.engine.endpoints

import android.content.Context
import com.seazn.capture.engine.adapter.FrameTally
import com.seazn.capture.engine.adapter.RtmpsMetrics
import com.seazn.capture.engine.srt.SeaznSrtSink
import io.github.thibaultbee.streampack.core.elements.endpoints.IEndpoint
import io.github.thibaultbee.streampack.core.elements.endpoints.IEndpointInternal
import io.github.thibaultbee.streampack.core.elements.endpoints.composites.CompositeEndpoint
import io.github.thibaultbee.streampack.core.elements.endpoints.composites.muxers.ts.TsMuxer
import io.github.thibaultbee.streampack.core.elements.endpoints.composites.muxers.ts.data.TSServiceInfo
import io.github.thibaultbee.streampack.core.pipelines.IDispatcherProvider
import io.github.thibaultbee.streampack.core.utils.InternalStreamPackApi
import io.github.thibaultbee.streampack.ext.rtmp.elements.endpoints.RtmpEndpoint
import io.github.thibaultbee.streampack.ext.rtmp.elements.endpoints.RtmpEndpointFactory
import kotlinx.coroutines.CoroutineDispatcher

/**
 * CD14 and CD15: SRT through TsMuxer and our sink, RTMPS through StreamPack's endpoint on our IO threads; both counted.
 *
 * Session 7, F-S7-1: 3.2.1's `TsMuxer.addStreams(configs)` adds to its first service (javap), so a muxer with none
 * fails every SRT start with `IndexOutOfBoundsException`. StreamPack's `SrtEndpointFactory` adds the service at
 * creation, as this does; `CompositeEndpoint` never releases the muxer, so the service holds for every attempt.
 */
@OptIn(InternalStreamPackApi::class) // 3.2.1: `IEndpoint.Factory` is opt-in to implement (javap), as `IEndpointInternal` is
class CaptureEndpointFactory(
  private val tally: FrameTally,
  private val sink: SeaznSrtSink,
  private val rtmpIo: CoroutineDispatcher,
  private val clock: CaptureClockLine,
  private val service: TSServiceInfo,
) : IEndpoint.Factory { // StreamPack 3.2.1 (javap): `IEndpointInternal.Factory` became `IEndpoint.Factory`, same `create`
  /** The RTMP endpoint of the streamer built last: its counters are RTMPS's link reading (session 7, item 2). */
  @Volatile private var rtmp: RtmpEndpoint? = null

  override fun create(context: Context, dispatcherProvider: IDispatcherProvider): IEndpointInternal {
    val srt = CompositeEndpoint(TsMuxer().apply { addService(service) }, sink)
    val rtmpEndpoint = RtmpEndpointFactory().create(context, RtmpDispatcherProvider(dispatcherProvider, rtmpIo))
    rtmp = rtmpEndpoint as? RtmpEndpoint
    return CountingEndpoint(RoutingEndpoint(srt, rtmpEndpoint), tally, clock)
  }

  /** 3.2.1 (javap): `RtmpEndpoint.getMetrics()` reads komuxer's counters synchronously, zero with no client. */
  fun rtmpMetrics(): RtmpsMetrics? =
    rtmp?.metrics?.let { RtmpsMetrics(it.bytesWritten, it.packetsWritten, it.packetsWriteDropped, it.packetsWriteLost) }
}
