package com.seazn.capture.engine.capture.run

import com.seazn.capture.engine.adapter.AttemptSignals
import com.seazn.capture.engine.adapter.CameraAvailability
import com.seazn.capture.engine.adapter.EncoderKeys
import com.seazn.capture.engine.adapter.PermanentPlatformFailure
import com.seazn.capture.engine.adapter.StartEnd
import com.seazn.capture.engine.core.Command
import com.seazn.capture.engine.core.ConnectFailure
import com.seazn.capture.engine.core.Input
import com.seazn.capture.engine.core.PairRequest
import com.seazn.capture.engine.core.RecordEntry
import com.seazn.capture.engine.core.SessionMachine
import com.seazn.capture.engine.core.Side
import java.io.IOException
import java.util.concurrent.TimeoutException
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withTimeoutOrNull

/**
 * The capture's rules (Task 36, CD37, CD42), apart from StreamPack so core's tests run them: which call
 * comes when, which attempt the endpoint holds, and what is reported. [CaptureParts] makes the calls.
 * Everything runs on [CaptureSerial]'s one consumer, so `open`, `close` and `execute` return at once.
 *
 * One streamer at a time (N2), and one endpoint, held for one attempt. `Disconnect(n)` closes attempt
 * n's endpoint only while the streamer holds it (C6, CRITICAL): the machine also answers a late open of
 * an attempt it gave up on with `Disconnect(n)`, by which time a newer attempt may be on air.
 */
class CaptureRun(
  private val parts: CaptureParts,
  private val signals: AttemptSignals,
  private val cameras: CameraAvailability,
  private val calls: CoreCalls,
  private val side: () -> Side,
  private val scope: CoroutineScope,
) {
  private val serial = CaptureSerial(scope, calls.failure)

  /** The pairing the capture serves. Null while closed (ledger advisory): a later reopen serves no ended pairing. */
  @Volatile
  var request: PairRequest? = null
    private set

  /** The rotation the held streamer encodes at (CD42); null while none is held. */
  private var rotation: Int? = null

  /** The attempt whose endpoint the streamer holds, if any: the only one a `Disconnect` may close. */
  @Volatile private var attempt: Int? = null

  /**
   * Every attempt up to this one had its stop asked for, so its endpoint's close is no drop. A mark that
   * only grows, never reset by the next connect: a drop watch can be past its endpoint's close on another
   * thread when that attempt is stopped, and read the mark only after a newer attempt began. Attempt ids
   * start at 1 and only grow (Task 19).
   */
  @Volatile private var stoppedThrough = 0

  private var micNoted = false
  private var closeWatch: Job? = null

  /** I-2: the opening's watch of StreamPack's camera opens, and of its losses (F-S4-1), from the build to the release. */
  private var openWatch: Job? = null

  /** Re-review 3 m2: the spacing after a loss rebuild ([rebuildLost]), and whether a loss inside it is owed one. */
  private var lossSpacing: Job? = null
  private var lossOwed = false

  fun open(asked: PairRequest) = serial.submit { opened(asked) }

  fun close() = serial.submit { closed() }

  fun execute(command: Command) = serial.submit { run(command) }

  /** N2: never two streamers. One already held serves the new pairing, which its failures now name. */
  private suspend fun opened(asked: PairRequest) {
    request = asked
    if (parts.held) return
    build(asked, EncoderKeys.surfaceRotation(side()))
  }

  private suspend fun build(asked: PairRequest, wanted: Int) {
    when (val built = parts.build(wanted)) {
      is Built.Ready -> {
        rotation = wanted
        micNoted = false
        watchOpens(built.cameraId)
      }
      is Built.Failed -> failed(asked, built)
    }
  }

  /**
   * Review C7 I-2: StreamPack (3.2.0 and 3.2.1) opens the camera lazily, at the first preview or the start,
   * so the build holds nothing yet: a take heard before it stands, and the opening tells it. The camera is
   * ours, and the take told over, once StreamPack reports its source open. The watch starts after
   * [CameraAvailability.opening]: the sources' flows keep their state, so an open that came first is seen.
   * Every build follows a release, or none, so no watch is running here; [closed] ends this one. F-S4-1: the
   * same watch hears StreamPack's word that the camera was lost, and hands it to the queue ([lostByDevice]).
   */
  private fun watchOpens(camera: String) {
    cameras.opening(camera)
    cameras.sessionStarted()?.let(calls.report)
    openWatch =
      scope.launch {
        launch { parts.cameraOpens().collect { id -> cameras.opened(id)?.let(calls.report) } }
        parts.cameraLosses().collect { id -> serial.submit { lostByDevice(id) } }
      }
  }

  /**
   * Device session 4, F-S4-1: StreamPack lost our camera (Camera2 disconnected it, or put it in a device error). It
   * reads not ready ([CameraAvailability.lost]), so the Armed gate holds the go-live, and, with nothing on air, it is
   * built afresh. With an attempt held the loss is marked only: the attempt's own paths decide (StreamPack opens
   * the camera again at a start, and a start the camera fails builds it afresh), so the capture never cuts a
   * broadcast on its own guess. Another camera's loss, or one after the release, is nothing.
   */
  private suspend fun lostByDevice(camera: String) {
    if (!cameras.lost(camera)) return
    calls.line(RecordEntry("camera-lost", listOf("from" to "device", "attempt" to attempt)))
    if (attempt == null) rebuildLost()
  }

  /**
   * Re-review 3 m2: a camera that fails as it opens is lost again as soon as its rebuild opens it, so loss rebuilds
   * are spaced by the machine's own retry rhythm ([SessionMachine.RETRY_MS], which retries a start forever before
   * live): the first at once, and a loss inside the spacing is owed, however many come, and built when it ends if
   * the camera still reads lost and nothing is on air. Spaced, not stopped: a camera service that restarts comes
   * back, where waiting for an open that never comes would leave it not ready with nothing to retry it.
   */
  private suspend fun rebuildLost() {
    if (lossSpacing?.isActive == true) {
      lossOwed = true
      return
    }
    rebuild("camera")
    lossSpacing =
      scope.launch {
        delay(SessionMachine.RETRY_MS)
        serial.submit {
          // Re-review 4: this block can run while its own job is still active (a dispatcher that resumes at
          // once), and read that as "inside the spacing", owing the rebuild to itself. The spacing is over here.
          lossSpacing = null
          if (lossOwed) {
            lossOwed = false
            if (attempt == null && !cameras.ready(camera = true)) rebuildLost()
          }
        }
      }
  }

  /**
   * F-S4-1: the camera built afresh, at the rotation held (CD42), a real open: StreamPack 3.2.1's
   * `VideoInput.setSource` skips a camera source of the same id (its sources), so a reopen of the same camera
   * opens nothing, and only a new build opens it again. The release closes the attempt held, as a stop asked for.
   * [action] names why: `camera` for a loss, `reopen` for a release with nothing on air ([reopen]).
   */
  private suspend fun rebuild(action: String) {
    val asked = request ?: return
    val wanted = rotation ?: EncoderKeys.surfaceRotation(side())
    calls.line(RecordEntry("capture-rebuilt", listOf("action" to action)))
    closed()
    request = asked
    build(asked, wanted)
  }

  /**
   * P11, P12, I4: reported against [asked], never thrown. Another app holding the camera is no failure:
   * Camera2's reason says so, or, since StreamPack (3.2.0 and 3.2.1) keeps no code from `onError`, the device's own
   * availability does (C6); the pairing waits for the release. The camera's own failure passes as it
   * is, so only `Failures.permanent` makes it permanent; the encoder's configuration failure is (CD11).
   */
  private fun failed(asked: PairRequest, built: Built.Failed) {
    when {
      CameraAvailability.busy(built.reason) || cameras.contended(built.cameraId) -> {
        cameras.waiting(built.cameraId)
        calls.cameraBusy(asked)
      }
      built.encoder -> calls.pairFailed(asked, PermanentPlatformFailure("encoder: ${built.error.javaClass.simpleName}", built.error))
      else -> calls.pairFailed(asked, built.error)
    }
  }

  private suspend fun closed() {
    request = null
    attempt?.let(::asked)
    closeWatch?.cancel() // cleanup: the mark, not the cancel, decides the drop
    closeWatch = null
    openWatch?.cancel()
    openWatch = null
    attempt = null
    rotation = null
    parts.release()
  }

  private suspend fun run(command: Command) {
    if (!parts.held) return unheld(command)
    when (command) {
      is Command.Orient -> orient(command.side)
      is Command.Connect -> connect(command)
      is Command.Disconnect -> disconnect(command.attemptId)
      is Command.Rebuild -> reconnect(command.previousAttemptId, command.next)
      is Command.StartNewSession -> reconnect(command.previousAttemptId, command.next)
      is Command.SetBitrate -> parts.bitrate(command.bps)
      is Command.SetMaxBw -> parts.maxBw(command.attemptId, command.bytesPerSecond)
      Command.SwitchCamera -> parts.switchCamera()
      Command.ReopenCamera -> reopen()
      is Command.Slate -> parts.slate(command.on)
      Command.StopBroadcast, is Command.End -> stopBroadcast()
      else -> Unit // HTTP, the store, permissions, the service and record lines are BridgeCore's or the keeper's
    }
  }

  /**
   * Nothing open: nothing to carry out, except the reopen a busy camera's release asked for (I4, [reopen]). A
   * connect, a Rebuild's or a new session's next one too, is answered at once with a line (C6 m-3): the
   * machine would otherwise wait out its connect timeout on an attempt nothing can open, with no word why.
   */
  private suspend fun unheld(command: Command) {
    when (command) {
      is Command.Connect -> nothingHeld(command)
      is Command.Rebuild -> nothingHeld(command.next)
      is Command.StartNewSession -> nothingHeld(command.next)
      Command.ReopenCamera -> reopen()
      else -> Unit
    }
  }

  /**
   * The camera opened again for real once its holder let it go. Nothing held: the busy build's release (I4) builds
   * the pairing's request. An attempt held: the slate is up (I2, it goes up only while sending), and the swap back
   * to our camera is a real open, since the slate is no camera source. Otherwise (device fix round, item (c)) no
   * slate is up and the source held is our camera, which StreamPack 3.2.1's `VideoInput.setSource` skips as the
   * same source (`CameraSourceFactory.isSourceEquals`, javap): a swap opens nothing, so the camera is built afresh.
   * The reopen is claimed only once something holds it; a build that finds it taken again is the busy build's.
   */
  private suspend fun reopen() {
    val asked = request ?: return calls.report(Input.CameraReopened(false))
    when {
      !parts.held -> build(asked, EncoderKeys.surfaceRotation(side()))
      attempt != null -> return calls.report(Input.CameraReopened(parts.reopenCamera()))
      else -> rebuild("reopen")
    }
    if (parts.held) calls.report(Input.CameraReopened(true))
  }

  private fun nothingHeld(connect: Command.Connect) {
    calls.line(RecordEntry("capture-unheld", listOf("action" to "connect", "attempt" to connect.attemptId)))
    calls.report(Input.ConnectFailed(connect.attemptId, ConnectFailure.UNHELD, "no capture held")) // C6 I-3: never counted, never an ask
  }

  /** CD42: the build's rotation is the broadcast's; another side rebuilds before the connect, never setTargetRotation. */
  private suspend fun orient(turned: Side) {
    val wanted = EncoderKeys.surfaceRotation(turned)
    val asked = request ?: return
    if (wanted == rotation) return
    calls.line(RecordEntry("capture-rebuilt", listOf("action" to "orient")))
    closed()
    request = asked
    build(asked, wanted)
  }

  /**
   * One endpoint: a connect replaces whatever attempt it still holds, as a stop asked for. The start is
   * bounded by [START_BOUND_MS] (C6 I-1): every later command waits behind it on the one queue, and
   * komuxer's connect has no timeout of its own, so a hung start would hold an unpair's release, and the
   * camera, for as long as it hung.
   */
  private suspend fun connect(command: Command.Connect) {
    val id = command.attemptId
    attempt?.let { if (it != id) stopHeld(it) }
    parts.beforeConnect(id, command.startBitrateBps)
    attempt = id
    signals.starting(id) // M-3: a drop while the start is in flight waits for its end
    val started =
      try {
        withTimeoutOrNull(START_BOUND_MS) { parts.start(command) }
      } catch (e: CancellationException) {
        signals.startEnded(id, StartEnd.RETURNED)?.let(calls.report)
        throw e
      } catch (e: Exception) {
        calls.line(startFailed(id, e))
        val busy = parts.busyCamera(e)
        val lost = if (busy == null) parts.cameraFailed(e) else null
        signals.startEnded(id, if (busy != null || lost != null) StartEnd.CAMERA else StartEnd.FAILED)?.let(calls.report)
        if (busy != null) return busyAtStart(id, busy, e)
        if (lost != null) return cameraAtStart(id, lost, e)
        signals.connectFailed(id, e)?.let(calls.report)
        return
      }
    signals.startEnded(id, if (started == null) StartEnd.FAILED else StartEnd.RETURNED)?.let(calls.report)
    if (started == null) return timedOut(id)
    if (!started) return calls.report(Input.ConnectFailed(id, ConnectFailure.OTHER, "srt url does not parse"))
    signals.connected(id)?.let(calls.report)
    noteMicSession()
    watchClose(id)
  }

  /**
   * F-S4-1: which call failed a start, by class only (CD30): the throwable's class, where the first throw of its cause
   * chain was made (`Type.method`, the type's simple name without its inner parts), and that throw's class when one of
   * another class wraps it. Never a message: a vendor's can quote the SRT URL. StreamPack logs nothing on that path,
   * so this line is what names it (device session 4 could not).
   */
  private fun startFailed(id: Int, failure: Throwable): RecordEntry {
    val root = generateSequence(failure) { it.cause }.take(MAX_CAUSES).last()
    val fields = mutableListOf<Pair<String, Any?>>("attempt" to id, "error" to failure.javaClass.simpleName, "site" to site(root))
    // Coroutines' stack-trace recovery may hand the run a copy that wraps the throw: the same class is no second name.
    if (root.javaClass != failure.javaClass) fields += "rootError" to root.javaClass.simpleName
    return RecordEntry("capture-start-failed", fields)
  }

  /** Where [thrown] was made, as `Type.method`: names only, each cut at its first `$` so a lambda's stays a plain word. */
  private fun site(thrown: Throwable): String? =
    thrown.stackTrace.firstOrNull()?.let { frame ->
      val type = frame.className.substringAfterLast('.').substringBefore('$')
      "$type.${frame.methodName.substringBefore('$')}".take(SITE_MAX)
    }

  /**
   * C6 I-1: the start did not end within its bound, a TIMEOUT (the text is what `SrtOptions.failure`
   * reads). The cancelled start may have left the endpoint half open: it is closed as a stop asked for.
   */
  private suspend fun timedOut(id: Int) {
    signals.connectFailed(id, TimeoutException("start timed out after $START_BOUND_MS ms"))?.let(calls.report)
    stopHeld(id)
  }

  /**
   * C7 carry: another app holds our camera, found at the start (StreamPack 3.2.1, as 3.2.0, opens it lazily). It
   * reads as a busy build does (I4): the camera is taken and its release is waited for, never an end.
   * The attempt is UNHELD (C6 I-3), never counted towards the fallback and never an ask, even when its
   * endpoint's drop came first, while the start was in flight (review C7 M-3); the signals still end it,
   * so a late drop of it is no second report (R3).
   */
  private fun busyAtStart(id: Int, camera: String, failure: Exception) {
    cameras.waiting(camera)
    request?.let(calls.cameraBusy)
    if (signals.connectFailed(id, failure) != null) calls.report(Input.ConnectFailed(id, ConnectFailure.UNHELD, "camera busy"))
  }

  /**
   * Device session 4, F-S4-1: the camera failed the start ([CaptureParts.cameraFailed]). The attempt is CAMERA,
   * never counted towards the fallback, which could not help, and never an ask, even when its endpoint's drop came
   * first, while the start was in flight (the cleanup's close, review C7 M-3); the signals still end it (R3). The
   * camera reads not ready, and is built afresh, so the next attempt has a camera that can stream.
   */
  private suspend fun cameraAtStart(id: Int, camera: String, failure: Exception) {
    if (signals.connectFailed(id, failure) != null) {
      calls.report(Input.ConnectFailed(id, ConnectFailure.CAMERA, "camera: ${failure.javaClass.simpleName}"))
    }
    cameras.lost(camera)
    calls.line(RecordEntry("camera-lost", listOf("from" to "start", "attempt" to id)))
    rebuild("camera")
  }

  /** N8: checked once per opening, at its first connect, when StreamPack's AudioRecord is recording. */
  private fun noteMicSession() {
    if (micNoted) return
    micNoted = true
    if (!parts.micSessionKnown()) calls.line(RecordEntry("watch-failed", listOf("action" to "mic-session")))
  }

  /** An endpoint that closes without our asking is a drop (R3: the sink's completion may say so first). */
  private fun watchClose(id: Int) {
    closeWatch?.cancel()
    closeWatch =
      scope.launch {
        parts.endpointClosed()
        if (id > stoppedThrough) signals.dropped(id, IOException("endpoint closed"))?.let(calls.report)
      }
  }

  /**
   * C6 CRITICAL: closes attempt [id]'s endpoint, and only while the streamer holds it. The machine answers
   * a late open of an attempt it gave up on with `Disconnect(n)` (AttemptSignals passes the open through,
   * Task 19 I1); by then that endpoint was replaced, and the one held is a newer attempt's, on air.
   */
  private suspend fun disconnect(id: Int) {
    if (attempt != id) return
    stopHeld(id)
  }

  private suspend fun stopHeld(id: Int) {
    asked(id)
    closeWatch?.cancel() // cleanup: the mark, not the cancel, decides the drop
    closeWatch = null
    attempt = null
    parts.stop()
  }

  private fun asked(id: Int) {
    stoppedThrough = maxOf(stoppedThrough, id)
  }

  private suspend fun reconnect(previous: Int, next: Command.Connect) {
    disconnect(previous)
    connect(next)
  }

  /** The broadcast ends; the pairing, the camera and the viewfinder stay (amendment, _States_). */
  private suspend fun stopBroadcast() {
    attempt?.let { stopHeld(it) }
    parts.afterBroadcast()
  }

  companion object {
    /**
     * A second under the machine's own connect timeout ([SessionMachine.CONNECT_TIMEOUT_MS]): the capture
     * names the failure while the machine still waits for that attempt, and the queue is free before the
     * machine gives up on it. SRT's own connect gives up at `SrtOptions`' CONNTIMEO, well inside it.
     */
    const val START_BOUND_MS = SessionMachine.CONNECT_TIMEOUT_MS - 1_000

    /** The cause chain read for a start's failure, as `SrtOptions` and the adapter read it. */
    private const val MAX_CAUSES = 8

    /** The record's plain word is at most 64 characters (CD6): a longer site is cut, never masked whole. */
    private const val SITE_MAX = 64
  }
}
