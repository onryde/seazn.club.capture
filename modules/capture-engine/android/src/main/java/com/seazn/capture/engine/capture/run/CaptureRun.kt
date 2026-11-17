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
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.channels.Channel
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
  /** N45 I1: the monotonic clock in ms, which spaces the probe's record lines; the test's virtual clock in core's tests. */
  private val monoMs: () -> Long = { System.nanoTime() / 1_000_000 },
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

  /** Re-review 4 cap: loss rebuilds since an open was last seen, and whether they stopped at [MAX_LOSS_REBUILDS]. */
  private var lossRebuilds = 0
  private var lossGaveUp = false

  /** N45 I1: the take's probe ([probeWhileSlated]), from the slate's rise to its fall. */
  private var probing: Job? = null

  /** N45 I1: a word that the camera may be free now ([mayBeFree]): the next probe goes at once. */
  private val nudges = Channel<Unit>(Channel.CONFLATED)

  /** N45 I1: refused probes since the last that opened, and when the last line of them was written. */
  private var probeFails = 0
  private var probeLineAt: Long? = null

  /** N45 I1, review M1: when a probe last told a take over, and how many takes came back within [RETAKE_MS] of one. */
  private var probeReleasedAt: Long? = null
  private var quickRetakes = 0

  fun open(asked: PairRequest) = serial.submit { opened(asked) }

  fun close() = serial.submit { closed() }

  fun execute(command: Command) = serial.submit { run(command) }

  /**
   * Re-review 4 cap: the app came back to the foreground, which re-arms the camera's loss rebuilds ([rearm]). N45 I1:
   * and the camera may be free: the operator's return is the likeliest moment its holder let it go.
   */
  fun foreground() {
    serial.submit { rearm() }
    mayBeFree()
  }

  /**
   * N45 I1: a word that our camera may be free now (Camera2's available for a camera, its access priorities' change,
   * the app's return): while a take holds the slate up, the next probe goes at once. Any thread; nothing otherwise.
   */
  fun mayBeFree() {
    nudges.trySend(Unit)
  }

  /** N2: never two streamers. One already held serves the new pairing, which its failures now name. */
  private suspend fun opened(asked: PairRequest) {
    request = asked
    rearm() // re-review 4 cap: a re-pair re-arms
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
   * same watch hears StreamPack's word that the camera was lost, and hands it to the queue ([lostByDevice]); N45:
   * and its word that an open of it failed busy ([busyByDevice]).
   */
  private fun watchOpens(camera: String) {
    cameras.opening(camera)
    cameras.sessionStarted()?.let(calls.report)
    openWatch =
      scope.launch {
        launch {
          parts.cameraOpens().collect { id ->
            cameras.opened(id)?.let(calls.report)
            serial.submit(::openSeen)
          }
        }
        // N45 I2: the busy word is marked as it is heard, before its take is queued: StreamPack's "streaming" report
        // of the same failed open comes on the opens' flow, and is no open once marked. Review R1-I2: on air only,
        // where StreamPack streams; off air the preview's failed open throws to its listener and reports nothing, so
        // its open reports are real opens, and its own reopen heals a take the holder let go (C7 I-2).
        launch {
          parts.busyOpens().collect { id ->
            if (attempt != null) cameras.busyOpen(id)
            serial.submit { busyByDevice(id) }
          }
        }
        parts.cameraLosses().collect { id -> serial.submit { lostByDevice(id) } }
      }
  }

  /**
   * Device session 4, F-S4-1: StreamPack lost our camera (Camera2 disconnected it, or put it in a device error). It
   * reads not ready ([CameraAvailability.lost]), so the Armed gate holds the go-live, and, with nothing on air, it is
   * built afresh. Another camera's loss, or one after the release, is nothing.
   *
   * N45 (device check 2026-11-17): with an attempt held it is another app's take. An app that opens OUR camera evicts
   * us, and Camera2 says so only as this disconnect, so the availability watch never told it; the machine kept the
   * camera ours and its stall watchdog reconnected the uplink every few seconds, which no reconnect could cure. Told
   * as a take, the machine puts the slate up in the camera's place and holds the watchdog (F-P5-10, decision 7), and
   * the holder's release reopens it. Never a rebuild: the capture never cuts a broadcast on its own guess. A camera
   * service that restarts reads the same, and its cameras' return is the release.
   */
  private suspend fun lostByDevice(camera: String) {
    if (!cameras.lost(camera)) return
    calls.line(RecordEntry("camera-lost", listOf("from" to "device", "attempt" to attempt)))
    if (attempt == null) return rebuildLost()
    tellTaken(camera)
  }

  /**
   * N45: StreamPack's open of our camera failed busy while an attempt is held: a start's or a reopen's, which 3.2.1
   * logs and carries on from ("Error to add target stream"), so nothing else says so. Another app holds it: a take,
   * as [lostByDevice]'s. The device check's reconnects each met it (15:19:40 and 15:19:46Z), and a reopen told by our
   * own eviction's "available" can meet it too. With nothing on air it is the open's own failure, which the build,
   * the preview and the start read where it fails (I4, I-2), so nothing is done here.
   */
  private fun busyByDevice(camera: String) {
    if (attempt == null || !cameras.lost(camera)) return
    calls.line(RecordEntry("camera-lost", listOf("from" to "busy", "attempt" to attempt)))
    tellTaken(camera)
  }

  /**
   * N45: the take told once. Review M1: one that comes back within [RETAKE_MS] of a probe telling the last one over is
   * a camera that fails as it opens, not a holder; after [QUICK_RETAKES] such, the probe waits [PROBE_SLOW_MS].
   */
  private fun tellTaken(camera: String) {
    val told = cameras.taken(camera) ?: return
    val released = probeReleasedAt
    quickRetakes = if (released != null && monoMs() - released < RETAKE_MS) quickRetakes + 1 else 0
    probeReleasedAt = null
    calls.report(told)
  }

  /**
   * N45 I1 (review, probe B): a take's only release was an available for the camera the other app held, which may never
   * come: a holder on an id hidden from our watch (the device check's error 2), or ours made available once, by our
   * own eviction. So while the slate is up the capture asks Camera2 itself whether our camera opens
   * ([CaptureParts.probeCamera]): every [PROBE_EVERY_MS], and at once on a word that it may be free ([mayBeFree]). A
   * probe that opens it tells the take over and the machine reopens it; a refused one keeps the slate. Never the
   * transport: nothing here rebuilds, reconnects or stops. It ends itself once no take is told or there is nothing to
   * probe (StreamPack holds a camera source again, or nothing is held), so a release or a stop needs no cancel.
   */
  private fun probeWhileSlated() {
    probeFails = 0
    probeLineAt = null
    nudges.tryReceive() // review R1-I1: a word from before this slate is no news of its take
    probing =
      scope.launch {
        do {
          delay(PROBE_GAP_MS)
          // Review R1-I1: backed off, the wait is a floor no word shortens. Camera2 announces our camera available at
          // every close of it, each loss's and each probe's, and those words brought a camera that fails at every
          // open back about once a second.
          if (backedOff()) delay(PROBE_SLOW_MS - PROBE_GAP_MS) else withTimeoutOrNull(PROBE_EVERY_MS - PROBE_GAP_MS) { nudges.receive() }
          val going = CompletableDeferred<Boolean>()
          serial.submit {
            var more = false
            try {
              more = probeTake()
            } finally {
              going.complete(more)
            }
          }
        } while (going.await())
      }
  }

  private fun backedOff(): Boolean = quickRetakes >= QUICK_RETAKES

  /** The slate's: each slate starts its probing afresh, never on the last one's count and 30 s (see [slate]). */
  private fun stopProbing() {
    probing?.cancel()
    probing = null
  }

  /** N45 I1: one probe, on the queue, so never beside a reopen or a build of ours. False ends the probing. */
  private suspend fun probeTake(): Boolean {
    if (!cameras.oursTaken()) return false
    val found =
      try {
        parts.probeCamera() ?: return false
      } catch (e: CancellationException) {
        throw e
      } catch (e: Exception) {
        Probe.Refused(e.javaClass.simpleName) // a probe's throw is a refusal, never the session's failure
      }
    return when (found) {
      is Probe.Refused -> refused(found.error)
      is Probe.Opened -> opened(found.cameraId)
    }
  }

  /** N45 I1: a refused probe keeps the slate. One line at the first, then one each [PROBE_LINE_MS], with the count. */
  private fun refused(error: String): Boolean {
    probeFails += 1
    val now = monoMs()
    if (probeLineAt?.let { now - it < PROBE_LINE_MS } != true) {
      probeLineAt = now
      calls.line(RecordEntry("camera-probe", listOf("ok" to false, "error" to error, "failures" to probeFails)))
    }
    return true
  }

  /** N45 I1: the probe opened our camera: the take is told over, and the machine reopens it under the slate. */
  private fun opened(camera: String): Boolean {
    calls.line(RecordEntry("camera-probe", listOf("ok" to true, "failures" to probeFails)))
    cameras.probed(camera)?.let { released ->
      probeReleasedAt = monoMs()
      calls.report(released)
    }
    return false
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
    if (lossRebuilds >= MAX_LOSS_REBUILDS) return giveUp()
    lossRebuilds += 1
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
   * Re-review 4 cap: [MAX_LOSS_REBUILDS] loss rebuilds with no open seen between them stop. The camera stays not
   * ready (the chip says so; no new copy), and one line says so, once, until [rearm].
   */
  private fun giveUp() {
    if (lossGaveUp) return
    lossGaveUp = true
    calls.line(RecordEntry("camera-gave-up", listOf("rebuilds" to lossRebuilds)))
  }

  /** Re-review 4 cap: an open StreamPack reported proves the camera opens; the count of loss rebuilds starts again. */
  private fun openSeen() {
    lossRebuilds = 0
    lossGaveUp = false
  }

  /**
   * Re-review 4 cap: the next foreground or a re-pair re-arms the loss rebuilds. A camera given up on, still lost
   * with nothing on air, is built at once, and the count starts again; otherwise only the count does.
   */
  private suspend fun rearm() {
    val stuck = lossGaveUp
    openSeen()
    if (stuck && attempt == null && !cameras.ready(camera = true)) rebuildLost()
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
      is Command.Slate -> slate(command.on)
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

  /**
   * N45 I1: the slate, and the probe of the take it stands for while it is up. Each slate ends the last one's
   * probing, which may still wait for its next step (a take told over by an available or an open seen), so the
   * next take's first refusal is written with its own count.
   */
  private suspend fun slate(on: Boolean) {
    parts.slate(on)
    stopProbing()
    if (on) probeWhileSlated()
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
   * chain was made (`Type.method`, the type's simple name without its inner parts; F-S7-1, the first frame outside the
   * Java and Kotlin runtimes, whose bounds checks name no caller), and that throw's class when one of another class
   * wraps it. Never a message: a vendor's can quote the SRT URL. StreamPack logs nothing on that path,
   * so this line is what names it (device session 4 could not).
   */
  private fun startFailed(id: Int, failure: Throwable): RecordEntry {
    val root = generateSequence(failure) { it.cause }.take(MAX_CAUSES).last()
    val fields = mutableListOf<Pair<String, Any?>>("attempt" to id, "error" to failure.javaClass.simpleName, "site" to site(root))
    // Coroutines' stack-trace recovery may hand the run a copy that wraps the throw: the same class is no second name.
    if (root.javaClass != failure.javaClass) fields += "rootError" to root.javaClass.simpleName
    return RecordEntry("capture-start-failed", fields)
  }

  /**
   * Where [thrown] was made, as `Type.method`: names only, each cut at its first `$` so a lambda's stays a plain word.
   * The first frame outside [RUNTIME]; a stack of runtime frames alone keeps its first.
   */
  private fun site(thrown: Throwable): String? =
    (thrown.stackTrace.firstOrNull { frame -> RUNTIME.none(frame.className::startsWith) } ?: thrown.stackTrace.firstOrNull())?.let { frame ->
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
    cameras.offAir()
    parts.afterBroadcast()
  }

  companion object {
    /**
     * A second under the machine's own connect timeout ([SessionMachine.CONNECT_TIMEOUT_MS]): the capture
     * names the failure while the machine still waits for that attempt, and the queue is free before the
     * machine gives up on it. SRT's own connect gives up at `SrtOptions`' CONNTIMEO, well inside it.
     */
    const val START_BOUND_MS = SessionMachine.CONNECT_TIMEOUT_MS - 1_000

    /**
     * Re-review 4, controller ruling 2026-10-05 (progress.md): consecutive camera-loss rebuilds with no open seen
     * between them stop at this many. Unbounded, a camera that fails every open (disabled by policy, say) churned a
     * rebuild and two lines every RETRY_MS while Paired, draining battery and record space.
     */
    const val MAX_LOSS_REBUILDS = 5

    /** N45 I1 (controller's ruling, fix round 1): a take is probed every 5 s while the slate is up. */
    const val PROBE_EVERY_MS = 5_000L

    /** N45 I1: the least time between two probes, a word's included, so a burst of words is one probe a second. */
    const val PROBE_GAP_MS = 1_000L

    /** N45 I1: a refused probe's line, at the first and then at most one in this long (the ruling: first + every 30 s). */
    const val PROBE_LINE_MS = 30_000L

    /** Review M1: a take told this soon after a probe told the last one over is a retake: the camera failed as it opened. */
    const val RETAKE_MS = 10_000L

    /** Review M1: after this many retakes in a row, the probe waits [PROBE_SLOW_MS]; a word that the camera may be free still probes at once. */
    const val QUICK_RETAKES = 3
    const val PROBE_SLOW_MS = 30_000L

    /** The cause chain read for a start's failure, as `SrtOptions` and the adapter read it. */
    private const val MAX_CAUSES = 8

    /** The record's plain word is at most 64 characters (CD6): a longer site is cut, never masked whole. */
    private const val SITE_MAX = 64

    /** F-S7-1: the Java and Kotlin runtimes' packages, whose frames (a bounds check, a `first()`) name no caller. */
    private val RUNTIME = listOf("java.", "javax.", "jdk.", "sun.", "kotlin.")
  }
}
