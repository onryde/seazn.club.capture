package com.seazn.capture.engine

import android.content.Context
import com.seazn.capture.engine.core.RecordEntry
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.views.ExpoView
import io.github.thibaultbee.streampack.ui.views.PreviewView
import kotlinx.coroutines.CoroutineExceptionHandler
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch

/**
 * The full-bleed native preview (AGENTS §6, carry 9). Frames never cross the bridge. FIT, so the
 * operator frames exactly what is encoded (#288). No pinch-zoom or tap-to-focus: a tap on a tripod
 * is a mis-tap. It follows the pairing's streamer while attached, and only then, and says so to the
 * engine (CD37): attached is the viewfinder shown. A screen pushed over the viewfinder may detach it
 * and attach it again; while a broadcast is held the capture stays open whatever the view does.
 *
 * I5: nothing here may crash the app. A native crash is beyond the JS boundary's reach, so every
 * failure is one `preview-failed` line, with the throwable's class name, and goes no further.
 */
class CapturePreviewView(context: Context, appContext: AppContext) : ExpoView(context, appContext) {
  override val shouldUseAndroidLayout = true

  private val failed = CoroutineExceptionHandler { _, t -> failed("follow", t) }
  private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main + failed)
  private var following: Job? = null
  private val preview =
    PreviewView(context).apply {
      scaleMode = PreviewView.ScaleMode.FIT
      enableZoomOnPinch = false
      enableTapToFocus = false
    }

  init {
    addView(preview, LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.MATCH_PARENT))
  }

  override fun onAttachedToWindow() {
    super.onAttachedToWindow()
    guarded("attach") { EngineHost.core(context).viewfinder(true) } // CD37: the capture is wanted on the viewfinder while Paired
    following?.cancel()
    // A null streamer unbinds: `setVideoSourceProvider(null)` (StreamPack 3.2.1, as 3.2.0, a suspend function).
    following = scope.launch { EngineHost.capture(context).streamer.collect { streamer -> preview.setVideoSourceProvider(streamer) } }
  }

  override fun onDetachedFromWindow() {
    following?.cancel()
    following = null
    guarded("detach") { EngineHost.core(context).viewfinder(false) }
    super.onDetachedFromWindow()
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
