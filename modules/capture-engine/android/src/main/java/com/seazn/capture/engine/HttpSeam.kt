package com.seazn.capture.engine

import android.content.Context
import com.seazn.capture.engine.http.HttpPort

/**
 * The one way to replace the HTTP path, set before the engine is first built (Task 34). Main never
 * names what sets it: a debug-only component does, and in a release build nothing does.
 */
object HttpSeam {
  @Volatile var override: ((Context) -> HttpPort)? = null
}
