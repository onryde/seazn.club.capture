package com.seazn.capture.engine

import android.content.Context
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/** The Expo bridge (spec §3 _Bridge_): intents in, snapshots, record lines and acks out. Holds no rule. */
class CaptureEngineModule : Module() {
  private fun app(): Context = appContext.reactContext?.applicationContext ?: error("no React context")

  private val core get() = EngineHost.core(app())

  override fun definition() = ModuleDefinition {
    Name("CaptureEngine")
    Events("onSnapshot", "onRecord", "onAck")

    // CD32: this instance takes both slots; a later instance's take replaces it, and only the owner's release clears.
    OnCreate {
      EngineHost.listener.take(this@CaptureEngineModule) { event, body -> sendEvent(event, body) }
      EngineHost.appContext.take(this@CaptureEngineModule, appContext)
    }
    OnDestroy {
      EngineHost.listener.release(this@CaptureEngineModule)
      EngineHost.appContext.release(this@CaptureEngineModule)
    }
    // Re-review 4 cap: the app's return re-arms the capture's camera rebuilds; nothing is built for it.
    OnActivityEntersForeground { EngineHost.foreground() }

    // Intents, not RPC (AGENTS §2): every one returns nothing.
    Function("send") { intent: Map<String, Any?> -> core.send(intent) }
    Function("log") { level: String, kind: String, fields: Map<String, Any?> -> core.log(level, kind, fields) }
    Function("current") { core.current() }
    // Carry C4c-I3: each line with its seq, `{seq, line}`, so JS drops a repeat by number.
    Function("tail") { core.tail() }

    // Task 39: the full-bleed preview, the module's default view (JS `requireNativeView('CaptureEngine')`).
    View(CapturePreviewView::class) {}
  }
}
