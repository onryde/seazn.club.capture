package com.seazn.capture.engine.capture.run

import com.seazn.capture.engine.adapter.CameraAvailability
import com.seazn.capture.engine.adapter.CameraFailures
import com.seazn.capture.engine.core.Command
import com.seazn.capture.engine.core.Input
import com.seazn.capture.engine.core.PairRequest
import com.seazn.capture.engine.core.RecordEntry
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.TestScope

/**
 * StreamPack's parts as a log: each call is written when it starts and, for a suspending one, again when
 * it ends ("release" … "release done"), [STEP_MS] of virtual time later, so two calls that overlap show
 * in the log. One endpoint, held for at most one attempt, as a `SingleStreamer` has.
 */
class FakeParts : CaptureParts {
  val log = mutableListOf<String>()

  /** What each build answers, in turn; a build of camera "0" once these run out. */
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

  /** N45 I2: the run's [CameraAvailability], told of each open the adapter asks for, as `StreamerAdapter` tells it. */
  var cameras: CameraAvailability? = null

  /** N45 I2: where a [StaleOpen.AFTER] report is sent from, later; the test's own scope. */
  var later: CoroutineScope? = null

  /**
   * N45 I2: reopens that land on a camera another app still holds, in turn, as StreamPack 3.2.1 makes them (javap:
   * `CameraController.addTarget` logs the busy error and swallows it, then `CameraSource.startStream` reports the
   * source streaming). The busy word, then the open report, in the order each one names.
   */
  val busyReopens = ArrayDeque<StaleOpen>()
  private var closing = CompletableDeferred<Unit>()

  override var held = false
    private set

  /** The held build's camera, as the adapter keeps its `cameraId`. */
  private var camera: String? = null

  override suspend fun build(rotation: Int): Built {
    log += "build $rotation"
    delay(STEP_MS)
    log += "build done"
    val built = builds.removeFirstOrNull() ?: Built.Ready("0")
    held = built is Built.Ready
    camera = (built as? Built.Ready)?.cameraId
    return built
  }

  override suspend fun release() {
    log += "release"
    delay(STEP_MS)
    close()
    held = false
    onSlate = false
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
    onSlate = false // the adapter's slate(false)
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
    val id = camera
    if (reopens && id != null) {
      onSlate = false
      cameras?.opening(id) // the adapter's I-2 call, before the source
      busyReopens.removeFirstOrNull()?.let { order -> stale(id, order) }
      if (losesOnReopen) lose(id)
    }
    return reopens
  }

  /** N45 I1 (review, probe D): a camera that is lost at every open, StreamPack's device error 4. */
  var losesOnReopen = false

  /** N45 I1: what each probe of our camera finds, in turn; [probeAnswer] once these run out. Null: nothing probed. */
  val probes = ArrayDeque<Probe>()
  var probeAnswer: Probe? = null

  /** N45 I1: a probe that throws this. */
  var probeFailure: Exception? = null

  /** N45 I1: the probes made. */
  var probeCount = 0
    private set

  /** Whether the slate is the source, as the adapter reads `sourceFlow`: a probe is made only then. */
  private var onSlate = false

  override suspend fun probeCamera(): Probe? {
    if (!onSlate) return null // the adapter's: never beside a camera source of StreamPack's
    probeCount += 1
    probeFailure?.let { throw it }
    return probes.removeFirstOrNull() ?: probeAnswer
  }

  private fun stale(id: String, order: StaleOpen) {
    when (order) {
      StaleOpen.BEFORE -> {
        opened(id)
        busyOpen(id)
      }
      StaleOpen.AFTER -> {
        busyOpen(id)
        checkNotNull(later) { "a report after the word needs a scope" }.launch {
          delay(STALE_MS)
          opened(id)
        }
      }
      StaleOpen.AT_ONCE -> {
        busyOpen(id)
        opened(id)
      }
    }
  }

  override suspend fun slate(on: Boolean) {
    log += "slate $on"
    onSlate = on
  }

  override fun micSessionKnown() = micKnown

  /** I-2: StreamPack's open of each camera source, as the test says it happened. Unwatched, an open is nothing. */
  private val opens = MutableSharedFlow<String>(extraBufferCapacity = 8)

  /** How many watch the opens now. */
  val watching: Int
    get() = opens.subscriptionCount.value

  /** I-2: StreamPack reports camera [id]'s source open, previewing or streaming. */
  fun opened(id: String) {
    check(opens.tryEmit(id)) { "an open with no room" }
  }

  override fun cameraOpens(): Flow<String> = opens

  /** F-S4-1: StreamPack's word that a camera was lost, as the test says it came. Unwatched, a loss is nothing. */
  private val losses = MutableSharedFlow<String>(extraBufferCapacity = 8)

  /** How many watch the losses now. */
  val watchingLosses: Int
    get() = losses.subscriptionCount.value

  /** F-S4-1: StreamPack logs camera [id] disconnected, or in a device error. */
  fun lose(id: String) {
    check(losses.tryEmit(id)) { "a loss with no room" }
  }

  override fun cameraLosses(): Flow<String> = losses

  /** N45: StreamPack's word that an open of a camera failed busy, as the test says it came. Unwatched, it is nothing. */
  private val busies = MutableSharedFlow<String>(extraBufferCapacity = 8)

  /** How many watch the busy opens now. */
  val watchingBusy: Int
    get() = busies.subscriptionCount.value

  /** N45: StreamPack logs camera [id] in a busy error (1 or 2): an open of it failed on another app's hold. */
  fun busyOpen(id: String) {
    check(busies.tryEmit(id)) { "a busy open with no room" }
  }

  override fun busyOpens(): Flow<String> = busies

  /** F-S4-1: the held camera when the failure is the camera's, by the core's own reading of it, as the adapter reads it. */
  override fun cameraFailed(failure: Throwable): String? = camera?.takeIf { CameraFailures.camera(failure) }

  /** Through the cause chain, as the adapter reads: coroutines' stack-trace recovery may hand the run a copy that wraps the throw. */
  override fun busyCamera(failure: Throwable): String? = generateSequence(failure) { it.cause }.take(8).firstNotNullOfOrNull { busyFailures[it] }

  companion object {
    const val STEP_MS = 10L

    /** N45 I2: how long after the busy word a [StaleOpen.AFTER] report comes: after the run's queue has had the word. */
    const val STALE_MS = 50L
  }
}

/**
 * N45 I2: when StreamPack's "streaming" report of a reopen that failed busy is read, against its busy word: the two
 * come on two flows, so either can be read first (review, probes A and A2).
 */
enum class StaleOpen {
  /** The report read first, before the run has the word. */
  BEFORE,

  /** The word read first, its take told, and the report after it. */
  AFTER,

  /**
   * StreamPack's own order: the word, then the report at once, both inside the reopen's `setVideoSource`, so both
   * are heard before the run's queue has the word.
   */
  AT_ONCE,
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
