package com.seazn.p5spike

import android.media.MediaFormat
import io.github.thibaultbee.streampack.core.configuration.mediadescriptor.MediaDescriptor
import io.github.thibaultbee.streampack.core.elements.data.Extra
import io.github.thibaultbee.streampack.core.elements.data.Frame
import io.github.thibaultbee.streampack.core.elements.encoders.CodecConfig
import io.github.thibaultbee.streampack.core.elements.endpoints.IEndpoint
import io.github.thibaultbee.streampack.core.elements.endpoints.IEndpointInternal
import io.github.thibaultbee.streampack.core.elements.metrics.EmptyEndpointMetrics
import io.github.thibaultbee.streampack.core.elements.metrics.EndpointMetrics
import io.github.thibaultbee.streampack.core.elements.metrics.WithEndpointMetrics
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertSame
import org.junit.Assert.assertTrue
import org.junit.Test
import java.nio.ByteBuffer

class CountingEndpointTest {
  @Test
  fun `counts video and audio by MIME prefix, and nothing else`() {
    val counts = FrameCounts()
    listOf("video/avc", "video/hevc", "audio/mp4a-latm", "text/plain", null).forEach(counts::count)
    assertEquals(2L, counts.videoFrames)
    assertEquals(1L, counts.audioFrames)
  }

  @Test
  fun `counts a frame before the inner endpoint closes it, and hands it on unchanged`() = runBlocking<Unit> {
    val inner = FakeEndpoint()
    val endpoint = CountingEndpoint(inner, mime = { (it as FakeFrame).mimeWhileOpen() })
    val video = FakeFrame("video/avc")
    val audio = FakeFrame("audio/mp4a-latm")

    endpoint.write(video, 1)
    endpoint.write(audio, 2)

    assertEquals(1L, endpoint.counts.videoFrames)
    assertEquals(1L, endpoint.counts.audioFrames)
    assertEquals(listOf<Pair<Frame, Int>>(video to 1, audio to 2), inner.written)
  }

  @Test
  fun `a frame whose format cannot be read is still written, just not counted`() = runBlocking<Unit> {
    val inner = FakeEndpoint()
    // The default reader: FakeFrame.format throws, as a MediaFormat on a closed frame might.
    val endpoint = CountingEndpoint(inner)

    endpoint.write(FakeFrame("video/avc"), 1)

    assertEquals(1, inner.written.size)
    assertEquals(0L, endpoint.counts.videoFrames)
  }

  /** The brief's condition on the wrapper: the egress column must keep flowing through it. */
  @Test
  fun `egress reads through the wrapper by SpikeTelemetry's own expression`() {
    val inner = FakeEndpoint()
    val endpoint: IEndpoint = CountingEndpoint(inner)

    assertEquals(1_234L, (endpoint as? WithEndpointMetrics<*>)?.metrics?.bytesWritten)
    assertSame(inner.metrics, (endpoint as WithEndpointMetrics<*>).metrics)
  }

  /**
   * DynamicEndpoint's release also cancels its own coroutine scope, which the interface's default
   * (stopStream, then close) would not. `by inner` forwards it — an explicit override was removed
   * and this stayed green — so this pins the forwarding rather than any code in the wrapper.
   */
  @Test
  fun `release reaches the inner endpoint's own release`() = runBlocking<Unit> {
    val inner = FakeEndpoint()
    CountingEndpoint(inner).release()
    assertTrue(inner.released)
  }

  private class FakeFrame(private val mime: String) : Frame {
    private var closed = false

    fun mimeWhileOpen(): String {
      check(!closed) { "read after close" }
      return mime
    }

    override val rawBuffer: ByteBuffer = ByteBuffer.allocate(0)
    override val ptsInUs = 0L
    override val dtsInUs: Long? = null
    override val isKeyFrame = false
    override val extra: Extra? = null
    override val format: MediaFormat
      get() = throw IllegalStateException("no MediaFormat on the JVM")

    override fun close() {
      closed = true
    }
  }

  private class FakeEndpoint : IEndpointInternal, WithEndpointMetrics<Any> {
    val written = mutableListOf<Pair<Frame, Int>>()
    var released = false

    override val metrics: EndpointMetrics<Any> = object : EndpointMetrics<Any> by EmptyEndpointMetrics {
      override val bytesWritten = 1_234L
    }
    override val throwableFlow: StateFlow<Throwable?> = MutableStateFlow<Throwable?>(null)
    override val isOpenFlow: StateFlow<Boolean> = MutableStateFlow(true)
    override val info: IEndpoint.IEndpointInfo
      get() = throw NotImplementedError()

    override fun getInfo(type: MediaDescriptor.Type): IEndpoint.IEndpointInfo = throw NotImplementedError()
    override suspend fun open(descriptor: MediaDescriptor) = Unit

    // Closes the frame as a real endpoint does, so a count taken after this would throw.
    override suspend fun write(frame: Frame, streamPid: Int) {
      frame.close()
      written += frame to streamPid
    }

    override suspend fun addStreams(streamConfigs: List<CodecConfig>): Map<CodecConfig, Int> = emptyMap()
    override suspend fun addStream(streamConfig: CodecConfig): Int = 0
    override suspend fun startStream() = Unit
    override suspend fun stopStream() = Unit
    override suspend fun close() = Unit
    override suspend fun release() {
      released = true
    }
  }
}
