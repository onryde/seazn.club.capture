package com.seazn.capture.engine.capture.run

import com.seazn.capture.engine.core.Command
import com.seazn.capture.engine.core.Input
import com.seazn.capture.engine.core.PairRequest
import com.seazn.capture.engine.core.RecordEntry
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.TestScope

/**
 * StreamPack's parts as a log: each call is written when it starts and, for a suspending one, again when
 * it ends ("release" … "release done"), [STEP_MS] of virtual time later, so two calls that overlap show
 * in the log. One endpoint, held for at most one attempt, as a `SingleStreamer` has.
 */
class FakeParts : CaptureParts {
  val log = mutableListOf<String>()

  /** What each build answers, in turn; [Built.Ready] once these run out. */
  val builds = ArrayDeque<Built>()

  /** The attempt whose endpoint is open and publishing. */
  var publishing: Int? = null
    private set

  /** Each attempt whose endpoint was closed, in order. */
  val closed = mutableListOf<Int>()

  /** An attempt whose start waits here until the test answers it: a late open. */
  val gates = mutableMapOf<Int, CompletableDeferred<Boolean>>()

  /** An attempt whose start throws this: its connect failed. */
  val failing = mutableMapOf<Int, Exception>()

  /** A start failure that is Camera2 saying the camera is busy, with the camera's id: the adapter's reading of it. */
  val busyFailures = mutableMapOf<Throwable, String>()

  var micKnown = true

  /** Runs on the drop watch's own thread once it has seen the endpoint close, before the run reads why. */
  var afterClose: (() -> Unit)? = null

  /** Runs once a stop or a release has closed the endpoint. */
  var stopped: (() -> Unit)? = null

  /** Runs as a start begins, with its attempt. */
  var starting: ((Int) -> Unit)? = null

  /** Whether a stop or a release shows as the endpoint's close. False: a vendor close that failed quietly, which no watch sees. */
  var closeShows = true
  var reopens = true
  private var closing = CompletableDeferred<Unit>()

  override var held = false
    private set

  override suspend fun build(rotation: Int): Built {
    log += "build $rotation"
    delay(STEP_MS)
    log += "build done"
    val built = builds.removeFirstOrNull() ?: Built.Ready
    held = built == Built.Ready
    return built
  }

  override suspend fun release() {
    log += "release"
    delay(STEP_MS)
    close()
    held = false
    log += "release done"
    stopped?.invoke()
  }

  override fun beforeConnect(attemptId: Int, startBitrateBps: Int) {
    log += "before $attemptId"
  }

  override suspend fun start(connect: Command.Connect): Boolean {
    val id = connect.attemptId
    log += "start $id"
    starting?.invoke(id)
    val opened = gates[id]?.await() ?: true
    failing[id]?.let { throw it }
    delay(STEP_MS)
    if (!opened) return false
    publishing = id
    closing = CompletableDeferred()
    log += "start done"
    return true
  }

  override suspend fun stop() {
    log += "stop ${publishing ?: "-"}"
    delay(STEP_MS)
    close()
    log += "stop done"
    stopped?.invoke()
  }

  /** The far end closed the endpoint: a drop nobody asked for. */
  fun farEndCloses() = close(shows = true)

  private fun close(shows: Boolean = closeShows) {
    publishing?.let { closed += it }
    publishing = null
    if (shows) closing.complete(Unit)
  }

  override suspend fun endpointClosed() {
    closing.await()
    afterClose?.invoke()
  }

  override suspend fun afterBroadcast() {
    log += "after"
  }

  override fun bitrate(bps: Int) {
    log += "bitrate $bps"
  }

  override fun maxBw(attemptId: Int, bytesPerSecond: Long) {
    log += "maxbw $attemptId $bytesPerSecond"
  }

  override suspend fun switchCamera() {
    log += "switch"
  }

  override suspend fun reopenCamera(): Boolean {
    log += "reopen"
    return reopens
  }

  override suspend fun slate(on: Boolean) {
    log += "slate $on"
  }

  override fun micSessionKnown() = micKnown

  /** Through the cause chain, as the adapter reads: coroutines' stack-trace recovery may hand the run a copy that wraps the throw. */
  override fun busyCamera(failure: Throwable): String? = generateSequence(failure) { it.cause }.take(8).firstNotNullOfOrNull { busyFailures[it] }

  companion object {
    const val STEP_MS = 10L
  }
}

/**
 * The capture's scope, on the test's virtual clock. Not `backgroundScope`: `advanceUntilIdle` leaves
 * background work unrun. Not the test's own scope either: the queue's consumer never completes, and
 * `runTest` would wait for it.
 */
fun TestScope.queueScope(): CoroutineScope = CoroutineScope(StandardTestDispatcher(testScheduler) + SupervisorJob())

/** What the capture told BridgeCore, in order. */
class Told {
  val reports = mutableListOf<Input>()
  val failures = mutableListOf<Throwable>()
  val pairFailed = mutableListOf<Pair<PairRequest, Throwable>>()
  val busy = mutableListOf<PairRequest>()
  val lines = mutableListOf<RecordEntry>()

  fun calls(report: (Input) -> Unit = { reports += it }, cameraBusy: (PairRequest) -> Unit = { busy += it }) =
    CoreCalls(
      report = report,
      failure = { failures += it },
      pairFailed = { request, t -> pairFailed += request to t },
      cameraBusy = cameraBusy,
      readiness = { _, _ -> },
      line = { lines += it },
    )
}
