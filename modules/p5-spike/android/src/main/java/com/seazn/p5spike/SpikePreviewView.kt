package com.seazn.p5spike

import android.content.Context
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.views.ExpoView
import io.github.thibaultbee.streampack.ui.views.PreviewView
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.flow.filterNotNull
import kotlinx.coroutines.launch

/** Frames never touch JS (AGENTS.md §2): the preview is a native view. */
class SpikePreviewView(context: Context, appContext: AppContext) : ExpoView(context, appContext) {
  // RN does not lay out plain Android children; a SurfaceView left unmeasured stays black.
  override val shouldUseAndroidLayout = true

  private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main)
  private val preview = PreviewView(context).apply {
    layoutParams = LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.MATCH_PARENT)
  }

  init {
    addView(preview)
    scope.launch {
      SpikeSession.streamerFlow.filterNotNull().collect { preview.setVideoSourceProvider(it) }
    }
  }

  override fun onDetachedFromWindow() {
    super.onDetachedFromWindow()
    scope.cancel()
  }
}
