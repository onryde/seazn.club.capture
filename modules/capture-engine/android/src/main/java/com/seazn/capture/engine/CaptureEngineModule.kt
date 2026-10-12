package com.seazn.capture.engine

import android.content.Context
import expo.modules.kotlin.Promise
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
    // R5, N27: the battery row's state, read at once (Allowed or Restricted); null when it cannot be read.
    Function("powerUnrestricted") { PowerState.unrestricted(app()) }
    // Spec §8: one of the two calls that answer (the other is scoringLink; AGENTS §2, recorded). It resolves "saved" or "failed", within native's bound.
    AsyncFunction("takePhoto") { promise: Promise -> EngineHost.capture(app()).takePhoto { word -> promise.resolve(word) } }
    // Spec §10, a tap: the other call that answers (AGENTS §2). The promise is resolved once, by the core, point to
    // point; no event carries the link, so no other listener can hear it. Its own bound is native's ANSWER_BACKSTOP_MS.
    AsyncFunction("scoringLink") { promise: Promise ->
      core.scoringLink { answer -> promise.resolve(answer) }
    }

    // Task 39: the native preview, the module's default view (JS `requireNativeView('CaptureEngine')`); it fills the camera box.
    View(CapturePreviewView::class) {}
  }
}
