package com.seazn.capture.engine

import android.content.Context
import android.hardware.camera2.CameraCharacteristics
import android.hardware.camera2.CameraManager
import android.util.Size
import com.seazn.capture.engine.preview.OneFor
import com.seazn.capture.engine.preview.PreviewSizes
import com.seazn.capture.engine.preview.ScopedOneFor
import io.github.thibaultbee.streampack.core.elements.sources.video.IVideoSource
import io.github.thibaultbee.streampack.core.elements.sources.video.camera.ICameraSource
import io.github.thibaultbee.streampack.core.interfaces.IWithVideoSource
import io.github.thibaultbee.streampack.core.pipelines.inputs.IVideoInput
import io.github.thibaultbee.streampack.core.utils.InternalStreamPackApi
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.stateIn

/** The sizes a camera lists for the class a preview asks about, as (width, height). */
typealias ListedSizes = (cameraId: String, targetClass: Class<*>) -> List<Pair<Int, Int>>

/** The sizes [cameraId] lists for [targetClass], read as StreamerAdapter.reportPreviewSizes reads them; throws as the read does. */
fun listedSizes(context: Context, cameraId: String, targetClass: Class<*>): List<Pair<Int, Int>> {
  val manager = context.getSystemService(CameraManager::class.java)
  val map = manager.getCameraCharacteristics(cameraId).get(CameraCharacteristics.SCALER_STREAM_CONFIGURATION_MAP)
  return map?.getOutputSizes(targetClass).orEmpty().map { it.width to it.height }
}

/**
 * N30 (D3 findings design §4): StreamPack 3.2.1's PreviewView takes its viewfinder's size from the camera source's
 * `getPreviewSize`, which picks by area alone, so a 960 x 960 square ties 1280 x 720 and can win. This is the camera
 * with that one answer given by [PreviewSizes.answer] (the 16:9 rule, StreamPack's own answer when no 16:9 size is
 * listed); every other member is the real source's, by delegation (spike notes,
 * `docs/specs/2026-10-12-s1-a1-preview-spike.md`). The answer sizes the viewfinder's surface, which the camera session
 * takes as the preview's output (spike §4).
 */
@OptIn(InternalStreamPackApi::class) // 3.2.1: ICameraSource and IPreviewableSource are opt-in to implement (javap), as IEndpointInternal is
class SixteenNineCamera(private val real: ICameraSource, private val sizes: ListedSizes) : ICameraSource by real {
  override fun <T> getPreviewSize(targetSize: Size, targetClass: Class<T>): Size {
    val (width, height) = PreviewSizes.answer(sizes(real.cameraId, targetClass)) { real.getPreviewSize(targetSize, targetClass).let { it.width to it.height } }
    return Size(width, height)
  }
}

/**
 * What the PreviewView binds to: the streamer with its video input's source seen through [SixteenNineCamera]. The
 * streamer's own input is never wrapped or set, so attaching or detaching the preview never reaches the encode (P2).
 * One decorator per real camera ([OneFor]), so the PreviewView, which compares each source with the one before it,
 * sees a camera that has not changed as unchanged (spike §6). The mirror collects the real flow only while the
 * PreviewView collects it, and its sharing coroutine lives in [scope], which [SixteenNineBinding] gives this provider
 * alone and cancels when the streamer is replaced or unbound (review I1).
 */
class SixteenNineProvider(private val real: IWithVideoSource, scope: CoroutineScope, private val sizes: ListedSizes) : IWithVideoSource by real {
  private val cameras = OneFor<ICameraSource, SixteenNineCamera>({ SixteenNineCamera(it, sizes) }) {}

  private fun through(source: IVideoSource?): IVideoSource? = if (source is ICameraSource) cameras.of(source) else source

  override val videoInput: IVideoInput =
    object : IVideoInput by real.videoInput {
      override val sourceFlow: StateFlow<IVideoSource?> =
        real.videoInput.sourceFlow.map(::through).stateIn(scope, SharingStarted.WhileSubscribed(), through(real.videoInput.sourceFlow.value))
    }
}

/**
 * One provider per real streamer ([ScopedOneFor]), so the PreviewView, which keeps a streamer equal to the one it holds
 * ("Streamer already set"), keeps it across a re-attach, and its flow keeps following a camera switch. A new streamer
 * gets a new provider; null unbinds and forgets, so a streamer bound again gets a new one whose first value is its
 * camera now. Each provider's mirror runs in a child of [scope] of its own, cancelled when its streamer is replaced or
 * unbound, never at detach: the view's scope is never cancelled, so a released streamer is held by nothing (review I1).
 */
class SixteenNineBinding(scope: CoroutineScope, sizes: ListedSizes) {
  private val providers = ScopedOneFor<IWithVideoSource, SixteenNineProvider>(scope) { streamer, own -> SixteenNineProvider(streamer, own, sizes) }

  fun of(streamer: IWithVideoSource?): SixteenNineProvider? = providers.of(streamer)
}
