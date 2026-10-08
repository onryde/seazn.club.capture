package com.seazn.capture.engine.capture.run

import com.seazn.capture.engine.core.Input
import com.seazn.capture.engine.core.PairRequest
import com.seazn.capture.engine.core.RecordEntry

/** What the capture reports to, every one of them BridgeCore's (Task 20). Each is safe from any thread. */
class CoreCalls(
  val report: (Input) -> Unit,
  val failure: (Throwable) -> Unit,
  val pairFailed: (PairRequest, Throwable) -> Unit,
  val cameraBusy: (PairRequest) -> Unit,
  val readiness: (cameraFrames: Boolean, audioPeak: Double?) -> Unit,
  val line: (RecordEntry) -> Unit,
)
