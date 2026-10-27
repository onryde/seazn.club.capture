package com.seazn.capture.engine.debug

import android.content.BroadcastReceiver
import android.content.ContentProvider
import android.content.ContentValues
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.net.Uri
import android.os.Build
import android.util.Log
import android.view.SurfaceView
import android.view.View
import android.view.ViewGroup
import com.seazn.capture.engine.PreviewSeam

/**
 * Debug builds only, N42's device check: fills [PreviewSeam] so that, while a preview is attached,
 *
 *     adb shell am broadcast -a com.seazn.capture.debug.LOSE_SURFACE -p com.seazn.capture
 *
 * lays the preview's SurfaceView out at 0 x 0 and asks nothing of its parents: the stuck state of 2026-10-26, a
 * SurfaceView with no size and no layout on its way. CapturePreviewView's relayout should mend it within two checks and
 * write `preview-relaid {reason: empty}`. It tests the mend, not the race that left the view unlaid. The receiver is
 * exported so the shell can reach it; a release build has neither it nor this provider.
 */
class LoseSurfaceInstaller : ContentProvider() {
  override fun onCreate(): Boolean {
    PreviewSeam.onAttach = ::listen
    return true
  }

  private fun listen(preview: View): () -> Unit {
    val receiver =
      object : BroadcastReceiver() {
        override fun onReceive(context: Context, intent: Intent) {
          preview.post { lose(preview) }
        }
      }
    val app = preview.context.applicationContext
    val filter = IntentFilter(ACTION)
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) app.registerReceiver(receiver, filter, Context.RECEIVER_EXPORTED) else app.registerReceiver(receiver, filter)
    return { app.unregisterReceiver(receiver) }
  }

  private fun lose(view: View) {
    val surface = surfaceIn(view)
    Log.i(TAG, "lose-surface: ${surface?.let { "${it.width}x${it.height} -> 0x0" } ?: "no SurfaceView"}")
    surface?.layout(0, 0, 0, 0)
  }

  private fun surfaceIn(view: View): SurfaceView? =
    view as? SurfaceView ?: (view as? ViewGroup)?.let { group -> (0 until group.childCount).firstNotNullOfOrNull { surfaceIn(group.getChildAt(it)) } }

  override fun query(uri: Uri, projection: Array<String>?, selection: String?, args: Array<String>?, sort: String?) = null

  override fun getType(uri: Uri): String? = null

  override fun insert(uri: Uri, values: ContentValues?): Uri? = null

  override fun delete(uri: Uri, selection: String?, args: Array<String>?) = 0

  override fun update(uri: Uri, values: ContentValues?, selection: String?, args: Array<String>?) = 0

  private companion object {
    const val ACTION = "com.seazn.capture.debug.LOSE_SURFACE"
    const val TAG = "SeaznN42"
  }
}
