package com.seazn.capture.engine

import android.view.View

/**
 * N42's device check: the one way to reach the attached preview from outside, set before a preview attaches. Each
 * attach hands it the preview and keeps what it returns, to call at detach. Main never names what sets it: a debug-only
 * component does (it forces the preview's SurfaceView to 0 x 0, the stuck state, so the mend can be seen to fire), and
 * in a release build nothing does, as with [HttpSeam].
 */
object PreviewSeam {
  @Volatile var onAttach: ((View) -> () -> Unit)? = null
}
