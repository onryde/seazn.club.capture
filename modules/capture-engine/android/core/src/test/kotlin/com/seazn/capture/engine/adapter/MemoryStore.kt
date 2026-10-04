package com.seazn.capture.engine.adapter

/**
 * App-private storage in memory. [refuseWrites] makes every write throw, as a full disk would;
 * [readFailure], when set, is thrown by every read, an unreadable file or a storage `Error`.
 */
class MemoryStore : PrivateStore {
  val files = mutableMapOf<String, String>()
  var refuseWrites = false
  var readFailure: Throwable? = null
  var writes = 0

  override fun read(name: String): String? {
    readFailure?.let { throw it }
    return files[name]
  }

  override fun write(name: String, text: String) {
    if (refuseWrites) throw java.io.IOException("disk full")
    writes += 1
    files[name] = text
  }

  override fun delete(name: String) {
    if (refuseWrites) throw java.io.IOException("disk full")
    files.remove(name)
  }
}
