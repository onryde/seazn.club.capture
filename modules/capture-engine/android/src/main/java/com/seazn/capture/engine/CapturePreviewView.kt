package com.seazn.capture.engine

import android.content.Context
import com.seazn.capture.engine.core.Encode
import com.seazn.capture.engine.core.RecordEntry
import com.seazn.capture.engine.preview.PreviewFit
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.views.ExpoView
import io.github.thibaultbee.streampack.ui.views.PreviewView
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineExceptionHandler
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch

/**
 * The native preview, filling the camera box it is mounted in (AGENTS §6; design follow-up §1).
 * Frames never cross the bridge. The box shows exactly what viewers get (#288): StreamPack 3.2.1's
 * PreviewView takes its preview stream's size from its own view's AREA, in any shape, and not from the
 * encode's config (javap, see [PreviewFit]), so the PreviewView is laid out at the encode's own size
 * ([Encode]) and scaled to fit the box by [PreviewFit], and its stream is the encode's 1280 x 720. FIT
 * stays, so a box that is not quite 16:9 leaves bars and crops nothing. No
 * pinch-zoom or tap-to-focus: a tap on a tripod is a mis-tap. It follows the pairing's streamer
 * while attached, and only then. It tells the engine
 * whether the viewfinder is shown (CD37): attached to a window that is visible. A screen pushed over the
 * viewfinder may detach it and attach it again; a lock or Background keeps it attached and turns only its
 * window invisible (review C7 I-1), as StreamPack 3.2.1's own PreviewView reads it (javap: it stops its
 * preview in `onWindowVisibilityChanged` on anything but VISIBLE). While a broadcast is held the capture
 * stays open whatever the view does.
 *
 * I5: nothing here may crash the app. A native crash is beyond the JS boundary's reach, so every
 * failure is one `preview-failed` line, with the throwable's class name, and goes no further.
 */
class CapturePreviewView(context: Context, appContext: AppContext) : ExpoView(context, appContext) {
  override val shouldUseAndroidLayout = true

  private val failed = CoroutineExceptionHandler { _, t -> failed("follow", t) }
  private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main + failed)
  private var following: Job? = null

  /** Between our attach and detach. `isAttachedToWindow` still reads true inside `onDetachedFromWindow`. */
  private var attached = false
  private val preview =
    PreviewView(context).apply {
      scaleMode = PreviewView.ScaleMode.FIT
      enableZoomOnPinch = false
      enableTapToFocus = false
      // Review C7 I-2: StreamPack opens the camera lazily, here at the preview's start, and 3.2.1's PreviewView
      // catches that open's failure and hands it to its listener (javap): the capture hears it.
      listener =
        object : PreviewView.PreviewListener {
          override fun onPreviewFailed(t: Throwable) {
            failed("open", t)
            guarded("open") { EngineHost.capture(context).previewFailed(t) }
          }
        }
    }

  init {
    // The placement's left and top assume the preview is laid out from the box's left, in any locale.
    layoutDirection = LAYOUT_DIRECTION_LTR
    // The size is the preview stream's size (see the class note). Scaling about the corner puts the picture where
    // PreviewFit says; onSizeChanged hands it each size the box takes.
    preview.pivotX = 0f
    preview.pivotY = 0f
    addView(preview, LayoutParams(Encode.WIDTH, Encode.HEIGHT))
  }

  override fun onSizeChanged(w: Int, h: Int, oldw: Int, oldh: Int) {
    super.onSizeChanged(w, h, oldw, oldh)
    place(w, h)
  }

  /** The encode-sized preview, scaled uniformly into the box and centred: the whole box is the encode's picture. */
  private fun place(boxWidth: Int, boxHeight: Int) {
    val at = PreviewFit.place(boxWidth, boxHeight)
    preview.scaleX = at.scale
    preview.scaleY = at.scale
    preview.translationX = at.left
    preview.translationY = at.top
  }

  override fun onAttachedToWindow() {
    super.onAttachedToWindow()
    attached = true
    report("attach") // CD37: the capture is wanted on the viewfinder while Paired
    following?.cancel()
    // A null streamer unbinds: `setVideoSourceProvider(null)` (StreamPack 3.2.1, as 3.2.0, a suspend function).
    following =
      scope.launch {
        EngineHost.capture(context).streamer.collect { streamer ->
          try {
            preview.setVideoSourceProvider(streamer)
          } catch (e: CancellationException) {
            throw e
          } catch (e: Exception) {
            failed("follow", e) // review C7 M-7: one streamer's bind failed; the follow carries on to the next
          }
        }
      }
  }

  /** I-1: a lock or Background turns the window invisible and leaves the view attached. */
  override fun onWindowVisibilityChanged(visibility: Int) {
    super.onWindowVisibilityChanged(visibility)
    report("visibility", visibility)
  }

  override fun onDetachedFromWindow() {
    following?.cancel()
    following = null
    attached = false
    report("detach")
    super.onDetachedFromWindow()
  }

  /** The viewfinder is shown while attached to a visible window; the engine hears each change of either. */
  private fun report(action: String, visibility: Int = windowVisibility) {
    guarded(action) { EngineHost.core(context).viewfinder(attached && visibility == VISIBLE) }
  }

  private fun guarded(action: String, block: () -> Unit) {
    try {
      block()
    } catch (e: Exception) {
      failed(action, e)
    }
  }

  private fun failed(action: String, t: Throwable) {
    EngineHost.line(RecordEntry("preview-failed", listOf("action" to action, "error" to t.javaClass.simpleName)))
  }
}
