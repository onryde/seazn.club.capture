package com.seazn.capture.engine

import com.seazn.capture.engine.adapter.PrivateStore
import java.io.File
import java.io.IOException

/**
 * `PrivateStore` on `noBackupFilesDir`: app-private and never in a backup, so a restored phone never
 * claims as another install (the phone id) or re-sends a stale stop (A17). Scheduler thread only, but for the
 * Forget marker's one read as the core is built (`PrivateStore`'s KDoc says why that is safe); a write is durable
 * before it returns (written to a temporary file, then renamed over the old one), and a delete the file system did
 * not do throws, as a refused write does (Batch 4 review M7: a Forget marker left behind would act at the next start).
 */
class AndroidStore(private val dir: File) : PrivateStore {
  override fun read(name: String): String? = File(dir, name).takeIf { it.exists() }?.readText()

  override fun write(name: String, text: String) {
    dir.mkdirs()
    val next = File(dir, "$name.next")
    next.outputStream().use { out ->
      out.write(text.toByteArray())
      out.fd.sync()
    }
    if (!next.renameTo(File(dir, name))) throw IOException("rename failed: $name")
  }

  override fun delete(name: String) {
    val file = File(dir, name)
    if (!file.delete() && file.exists()) throw IOException("delete failed: $name")
  }
}
