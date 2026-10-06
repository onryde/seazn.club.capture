package com.seazn.capture.engine.endpoints

import io.github.thibaultbee.streampack.core.configuration.mediadescriptor.MediaDescriptor
import io.github.thibaultbee.streampack.core.elements.data.Frame
import io.github.thibaultbee.streampack.core.elements.encoders.CodecConfig
import io.github.thibaultbee.streampack.core.elements.endpoints.IEndpointInternal
import io.github.thibaultbee.streampack.core.elements.endpoints.MediaSinkType
import io.github.thibaultbee.streampack.core.utils.InternalStreamPackApi
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

/**
 * SRT or RTMPS, chosen at each open by the descriptor's sink type. The open state is copied
 * synchronously after open and close, so StreamPack never reads a stale value, and mirrored after.
 * Implements StreamPack 3.2.1's opt-in `IEndpointInternal` on purpose, as [CountingEndpoint] does.
 */
@OptIn(InternalStreamPackApi::class)
class RoutingEndpoint(private val srt: IEndpointInternal, private val rtmp: IEndpointInternal) : IEndpointInternal {
  @Volatile private var chosen: IEndpointInternal = srt
  private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
  private var mirror: Job? = null
  private val open = MutableStateFlow(false)
  private val thrown = MutableStateFlow<Throwable?>(null)

  override val isOpenFlow = open.asStateFlow()
  override val throwableFlow = thrown.asStateFlow()
  override val info get() = chosen.info

  override fun getInfo(type: MediaDescriptor.Type) = pick(type.sinkType).getInfo(type)

  override suspend fun open(descriptor: MediaDescriptor) {
    chosen = pick(descriptor.type.sinkType)
    chosen.open(descriptor)
    open.value = chosen.isOpenFlow.value
    mirror?.cancel()
    mirror =
      scope.launch {
        launch { chosen.isOpenFlow.collect { open.value = it } }
        launch { chosen.throwableFlow.collect { thrown.value = it } }
      }
  }

  override suspend fun close() {
    mirror?.cancel()
    chosen.close()
    open.value = false
  }

  override suspend fun write(frame: Frame, streamPid: Int) = chosen.write(frame, streamPid)

  override suspend fun addStreams(streamConfigs: List<CodecConfig>) = chosen.addStreams(streamConfigs)

  override suspend fun addStream(streamConfig: CodecConfig) = chosen.addStream(streamConfig)

  override suspend fun startStream() = chosen.startStream()

  override suspend fun stopStream() = chosen.stopStream()

  override suspend fun release() {
    srt.release()
    rtmp.release()
    scope.cancel()
  }

  private fun pick(type: MediaSinkType) = if (type == MediaSinkType.SRT) srt else rtmp
}
