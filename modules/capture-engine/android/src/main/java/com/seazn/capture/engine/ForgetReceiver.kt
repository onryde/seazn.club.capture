package com.seazn.capture.engine

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

/**
 * R6, R7 of the D3 findings design: the notification's Forget, with no confirmation. It hands the tap to the core,
 * which decides: only a pairing that is waiting acts (`Pairings.forget`), and the service, the wake lock and the
 * marker all follow from the machine's commands, as every unpair's do (GlueRulesTest: one keeper release, in the
 * platform's Release branch). A tap that lands after the pairing moved on is ignored by the core, and recorded. Not
 * exported: only the notification's own PendingIntent reaches it.
 */
class ForgetReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    if (intent.action != ACTION) return
    EngineHost.core(context).forget()
  }

  companion object {
    const val ACTION = "com.seazn.capture.engine.FORGET"
  }
}
