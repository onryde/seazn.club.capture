package com.seazn.p5spike

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class P5SpikeModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("P5Spike")

    Events("onSample", "onEvent")

    OnCreate {
      val context = appContext.reactContext ?: return@OnCreate
      SpikeSession.attach(context.applicationContext) { name, body -> sendEvent(name, body) }
    }

    // Intents, not RPC: every function returns immediately (AGENTS.md §2).
    Function("arm") { SpikeSession.arm() }
    Function("start") { transport: String -> SpikeSession.start(transport) }
    Function("stop") { SpikeSession.stop() }
    Function("mark") { label: String -> SpikeSession.mark(label) }
    Function("logPath") { SpikeSession.logPath() }

    View(SpikePreviewView::class) {}
  }
}
