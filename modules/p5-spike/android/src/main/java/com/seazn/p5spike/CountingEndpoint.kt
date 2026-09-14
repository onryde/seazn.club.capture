package com.seazn.p5spike

import android.content.Context
import android.media.MediaFormat
import io.github.thibaultbee.streampack.core.elements.data.Frame
import io.github.thibaultbee.streampack.core.elements.endpoints.DynamicEndpointFactory
import io.github.thibaultbee.streampack.core.elements.endpoints.IEndpointInternal
import io.github.thibaultbee.streampack.core.elements.metrics.EmptyEndpointMetrics
import io.github.thibaultbee.streampack.core.elements.metrics.EndpointMetrics
import io.github.thibaultbee.streampack.core.elements.metrics.WithEndpointMetrics
import io.github.thibaultbee.streampack.core.pipelines.IDispatcherProvider
import java.util.concurrent.atomic.AtomicLong

/**
 * Encoded frames handed to the endpoint, by kind. F-P5-4: a recording fell to 3–9 fps while
 * egress read 3–4 Mbps and Cloudflare said connected, and nothing we logged could say whether
 * frames stopped reaching the endpoint (a hot handset starving capture or encode) or reached it
 * and were lost in transport. This is the witness for the first; SRT's counters are the second.
 *
 * Cumulative, never reset on read. The endpoint lives as long as the streamer, so the counts span
 * reconnects. Rates are taken offline over real elapsed time, and a counter that reset on every
 * sample would silently lose the frames of any row that failed to write. Written from the
 * encoders' coroutines and read by the sampler, hence atomics.
 */
class FrameCounts {
  private val video = AtomicLong()
  private val audio = AtomicLong()

  val videoFrames: Long get() = video.get()
  val audioFrames: Long get() = audio.get()

  /** By the encoded format's MIME prefix. Anything else, or no MIME at all, is not counted. */
  fun count(mime: String?) {
    when {
      mime == null -> Unit
      mime.startsWith("video/") -> video.incrementAndGet()
      mime.startsWith("audio/") -> audio.incrementAndGet()
    }
  }
}

/**
 * An endpoint with a frame counter in front of it; everything else is the inner endpoint's.
 *
 * Its metrics above all. `SpikeTelemetry` reads egress and SRT's counters through
 * `WithEndpointMetrics`, and so does StreamPack's own `IntervalBitrateRegulatorController`, which
 * casts the endpoint to it. A wrapper that implemented only `IEndpointInternal` would hide them,
 * and the egress column would read blank from then on with nothing failing.
 *
 * [mime] exists for the JVM tests, which have no working `MediaFormat`. [discardVideo] is F-P5-6's
 * on-device proof hook ([StallSimulation]); it is false unless the hook file is present.
 */
class CountingEndpoint(
  private val inner: IEndpointInternal,
  private val mime: (Frame) -> String? = ::encodedMime,
  private val discardVideo: () -> Boolean = { false },
) : IEndpointInternal by inner, WithEndpointMetrics<Any> {
  val counts = FrameCounts()

  override val metrics: EndpointMetrics<Any>
    get() = (inner as? WithEndpointMetrics<*>)?.metrics ?: EmptyEndpointMetrics

  override suspend fun write(frame: Frame, streamPid: Int) {
    // Before delegating: the endpoint closes the frame, and a closed frame is back in a pool,
    // where the next encoder output may already have overwritten it.
    val kind = readMime(frame)
    if (kind?.startsWith("video/") == true && discardVideo()) {
      // Neither counted nor written, so the counter goes flat exactly as F-P5-6's did. Closed
      // here because the endpoint that would have closed it never sees it.
      frame.close()
      return
    }
    counts.count(kind)
    inner.write(frame, streamPid)
  }

  /** A counter must never cost a frame: an unreadable format is simply not counted. */
  private fun readMime(frame: Frame): String? = try {
    mime(frame)
  } catch (unreadable: Exception) {
    null
  }
}

private fun encodedMime(frame: Frame): String? = frame.format.getString(MediaFormat.KEY_MIME)

/** [inner] is StreamPack's default unless told otherwise, so only the counting is new. */
class CountingEndpointFactory(
  private val inner: IEndpointInternal.Factory = DynamicEndpointFactory(),
  private val discardVideo: () -> Boolean = { false },
) : IEndpointInternal.Factory {
  override fun create(context: Context, dispatcherProvider: IDispatcherProvider): IEndpointInternal =
    CountingEndpoint(inner.create(context, dispatcherProvider), discardVideo = discardVideo)
}
