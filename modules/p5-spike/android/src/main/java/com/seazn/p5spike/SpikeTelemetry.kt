package com.seazn.p5spike

import android.content.Context
import kotlinx.coroutines.CoroutineScope

object SpikeTelemetry {
  fun start(context: Context, scope: CoroutineScope, onSample: (Map<String, Any?>) -> Unit) = Unit
}
