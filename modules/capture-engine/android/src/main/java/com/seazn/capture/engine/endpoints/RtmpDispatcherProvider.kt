package com.seazn.capture.engine.endpoints

import io.github.thibaultbee.streampack.core.pipelines.IDispatcherProvider
import kotlinx.coroutines.CoroutineDispatcher

/** StreamPack's provider with `io` replaced; `RtmpEndpointFactory` reads `default` and `io` only. */
class RtmpDispatcherProvider(base: IDispatcherProvider, override val io: CoroutineDispatcher) : IDispatcherProvider by base
