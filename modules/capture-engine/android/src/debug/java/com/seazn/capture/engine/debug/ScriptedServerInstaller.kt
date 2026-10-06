package com.seazn.capture.engine.debug

import android.content.ContentProvider
import android.content.ContentValues
import android.net.Uri
import com.seazn.capture.engine.EngineHost
import com.seazn.capture.engine.HttpSeam
import com.seazn.capture.engine.http.HttpAdapter
import java.io.File

/**
 * Debug builds only: fills [HttpSeam] before the engine is built (a provider's onCreate runs before
 * Application.onCreate). Answers no query; it exists for its onCreate.
 */
class ScriptedServerInstaller : ContentProvider() {
  override fun onCreate(): Boolean {
    HttpSeam.override = { app -> ScriptedCodeServer(File(app.filesDir, ScriptedCodeServer.FILE), HttpAdapter(), EngineHost::line) }
    return true
  }

  override fun query(uri: Uri, projection: Array<String>?, selection: String?, args: Array<String>?, sort: String?) = null

  override fun getType(uri: Uri): String? = null

  override fun insert(uri: Uri, values: ContentValues?): Uri? = null

  override fun delete(uri: Uri, selection: String?, args: Array<String>?) = 0

  override fun update(uri: Uri, values: ContentValues?, selection: String?, args: Array<String>?) = 0
}
