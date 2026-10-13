package com.seazn.capture.engine.adapter

import com.seazn.capture.engine.core.Beats
import com.seazn.capture.engine.core.Clock
import com.seazn.capture.engine.core.Command
import com.seazn.capture.engine.core.CommandSink
import com.seazn.capture.engine.core.Engine
import com.seazn.capture.engine.core.Environment
import com.seazn.capture.engine.core.Input
import com.seazn.capture.engine.core.PairRequest
import com.seazn.capture.engine.core.PairingName
import com.seazn.capture.engine.core.Phase
import com.seazn.capture.engine.core.Pose
import com.seazn.capture.engine.core.Projection
import com.seazn.capture.engine.core.Readiness
import com.seazn.capture.engine.core.RecordEntry
import com.seazn.capture.engine.core.Scheduler
import com.seazn.capture.engine.core.SessionRecord
import com.seazn.capture.engine.core.Snapshot
import com.seazn.capture.engine.core.SnapshotSink
import com.seazn.capture.engine.core.UnpairReason
import com.seazn.capture.engine.core.Unpaired
import com.seazn.capture.engine.core.attemptInHand
import com.seazn.capture.engine.core.holdsBroadcast
import com.seazn.capture.engine.core.holdsService
import com.seazn.capture.engine.core.now
import com.seazn.capture.engine.core.pairing
import java.util.concurrent.atomic.AtomicBoolean
import kotlin.math.abs

/**
 * The engine host every platform uses (CD3). Intents in, commands out, snapshots and record lines
 * up. Every rule from Tasks 10–19 meets here, so the Android glue and the JVM host are both thin.
 * Every input is posted, so the poller, the machine and the notices see inputs in one order: the
 * pollers hear an input before the machine does, and see each command before the platform (review
 * 14, G2).
 */
class BridgeCore(
  private val clock: Clock,
  scheduler: Scheduler,
  private val platform: Platform,
  store: PrivateStore,
  private val appVersion: String,
  private val model: String,
  newId: () -> String = { java.util.UUID.randomUUID().toString() },
) {
  private val guarded = GuardedScheduler(scheduler, ::failed)
  /** Carry C4c-I3: inside the sink, the record's newest seq is the line's own. */
  private val record: SessionRecord = SessionRecord { line -> platform.recordLine(line, record.lastSeq) }
  private val sticky: StickyFailure = StickyFailure(CommandSink(::route), { engine.phase.attemptInHand }, ::report)
  private val pollers = AttemptPollers(guarded, ::frames, platform::link, ::report)
  private val ticks = TickLateness()
  private val gaps = FrameGaps()
  private val errors = ErrorLines()
  private val readinessLines = CappedLines("readiness")

  /** What the marker's read had to say, held until the engine exists to take the lines. */
  private val markerLines = mutableListOf<RecordEntry>()

  /** R6 of the D3 findings design: a Forget the last process wrote and JS may not have heard. */
  private val forgottenAtStart: PairingName? = PairingStore.readForgotten(store) { markerLines += it }

  /** R6: the engine starts Idle naming that Forget, so JS drops the saved code at a cold start too. */
  private val engine: Engine =
    Engine(clock, guarded, sticky, SnapshotSink(::published), record, initial = Phase.Idle(unpaired = forgottenAtStart?.let { Unpaired(UnpairReason.FORGOTTEN, it) }))
  private val pairings = PairingStore(store, newId) { engine.log(it) }

  init {
    markerLines.forEach(engine::log)
  }
  private val phone by lazy { pairings.phone(appVersion, model) }

  /** The pairing the last notice saw, by identity (P5): a re-scan of the same code is a new pairing. */
  private var noticed: PairRequest? = null

  /** CD37. Scheduler thread only, but for [viewfinder], which is volatile. */
  private var captureWanted = false

  /** The pairing the capture was last opened for, by identity: its failures report against it (P11). */
  private var capturedFor: PairRequest? = null

  @Volatile private var viewfinder = false

  /**
   * Final review round 2: between a Release and the next Hold no pose watch is the pairing's, so a pose report
   * then is one the watch posted before its Release unregistered it, and is dropped. False before the first
   * Hold: a report then is A11's replay into the first pair. Scheduler thread only.
   */
  private var poseReleased = false

  /** The platform's latest readiness, and the last one sent to the machine. Scheduler thread only. */
  private var readiness = Readiness.UNKNOWN
  private var sent: Readiness? = null

  /** Spec §4, pre-flight F4: when the open capture last delivered an audio buffer (D1). Cleared at the capture's close. */
  private var lastAudioAtMs: Long? = null

  /** The system's last word on our recording (F-P5-8, `MicSilenceWatch`), kept across the capture's close. */
  private var systemSilenced = false

  @Volatile private var checkedAtMs: Long? = null

  /** The last facts the platform read without throwing, and how many reads threw (review C4a I-2). Scheduler thread. */
  private var lastFacts = PlatformFacts()
  private var factsFailures = 0

  /** The phase the last snapshot was published in, by name (review C4a m-1). Scheduler thread. */
  private var publishedPhase: String? = null

  /** The last published snapshot's language (P3), for the glue's notification. */
  @Volatile private var language: String? = null

  /** Review Focus 2: an answer before the first tick, so a restarted JS never reads nothing; R6: a Forget's marker included. */
  @Volatile private var current: Map<String, Any?> = wire(Projection.snapshot(engine.phase, clock.now()), PlatformFacts())

  /** Carry 15: the tick starts on the scheduler thread. */
  fun start() {
    guarded.schedule(0) { engine.start() }
  }

  /**
   * An intent from JS, mapped on the scheduler thread (the phone id and the A17 record are read from
   * storage there). One that maps to nothing is recorded by its kind (review 11). With a `seq`, the ack
   * is posted after the input's own tasks and its notice, so it reaches JS after the snapshot and the
   * lines the input caused and before any later tick's snapshot (CD8); work the notice posts in turn,
   * such as a new pairing's readiness, lands after it (review C4a m-6). The ack is posted whatever the
   * mapping threw: the kit never waits on a timeout (review 11, gap 1).
   */
  fun send(intent: Map<String, Any?>) {
    guarded.schedule(0) {
      try {
        val input = IntentMapping.input(intent, phone) { name -> pairings.stopped(name, clock.wallMs()) }
        // R6: a pair is the start of a new pairing, so a Forget's marker has done its work.
        if (input is Input.Pair) stored("delete", PairingStore.FORGOTTEN) { pairings.clearForgotten() }
        if (input != null) report(input) else engine.log(RecordEntry("intent-unreadable", listOf("intent" to intent["kind"] as? String)))
      } finally {
        WireValues.int(intent["seq"])?.let { seq -> guarded.schedule(0) { platform.acked(seq) } }
      }
    }
  }

  /** From any thread. The notices run after the machine has run the input, never inside the snapshot sink (CD31). */
  fun report(input: Input) {
    guarded.schedule(0) { pollers.onInput(input) }
    if (input is Input.MicSilenced) guarded.schedule(0) { micSilenced(input.silenced) }
    engine.send(input)
    guarded.schedule(0) { notice() }
  }

  /**
   * Spec §10, from any thread, on a tap only: ask the server for this match's Remote scoring link with the
   * pairing's own bearer and the start's body, and hand [answer] the result once. It bypasses the machine on
   * purpose: it changes no state, and a repeat returns the same link (the server never revokes one). The
   * request is guarded by [ask]'s own backstop ([ANSWER_BACKSTOP_MS]), so [answer] runs at the latest then,
   * with the word `unavailable`, unless [answer] itself is dead: a callback that throws is never answered, its
   * throw is only noted (RP4), and the caller's own deadline is what ends its wait. With no pairing it is answered
   * at once, with no request. [answer] runs on the scheduler thread. The record learns the word and the status,
   * never the URL, whose secret is protected before [answer] is called.
   *
   * A link is one match's: an answer that arrives after the pairing changed (an unpair, a re-pair) is not handed
   * over. The old match's scoring URL is not the caller's to have; it is answered `unavailable`, and its secret is
   * protected all the same (it reached memory), so it never leaks.
   *
   * RP4: **off the machine's failure path.** Each stage is a guarded task whose body runs in [ScoringTap.apart], so a
   * throw from the transport, the reading or [answer] itself answers `unavailable` and is noted by its class; it never
   * reaches [failed], which would hold a `LinkageError` against the process and end the pairing.
   */
  fun scoringLink(answer: (Map<String, Any?>) -> Unit) {
    val tap =
      ScoringTap(answer) { failure ->
        engine.log(RecordEntry("scoring-link", listOf("result" to "failed", "error" to failure.javaClass.simpleName)))
      }
    guarded.schedule(0) { tap.apart { scoringAsk(tap) } }
  }

  private fun scoringAsk(tap: ScoringTap) {
    val pairing = engine.phase.pairing
    if (pairing == null) {
      tap.hand(ScoringLinks.wire(ScoringLinkAnswer.Refused("unavailable", null)))
      return
    }
    // The tap's pairing, held by identity: what the answer is compared with when it comes (a re-pair is a new request).
    val request = pairing.request
    ask({ HttpRequests.scoringLink("${request.codeUrl}/scoring-link", pairing.token, Beats.startBody(pairing.phone.phoneId)) }) { outcome ->
      guarded.schedule(0) { tap.apart { scoringAnswered(outcome, request, tap) } }
    }
  }

  private fun scoringAnswered(outcome: HttpOutcome, request: PairRequest, tap: ScoringTap) {
    // An Error out of the transport leaves ask before it can cancel its backstop; the backstop then answers into a tap
    // that was answered already, and must not write a second line for it.
    if (tap.spent) return
    val answered = outcome as? HttpOutcome.Answered
    val read =
      if (answered == null) ScoringLinkAnswer.Refused("unavailable", null)
      else Bodies.scoringLink(answered.status, answered.body, Bodies.retryAfter(answered.retryAfter), request.environment)
    if (read is ScoringLinkAnswer.Link) record.protectLink(ScoringLinks.secret(read.url))
    // The pairing the tap asked for is not the one held now: the link is the old match's, and nobody is handed it.
    if (engine.phase.pairing?.request !== request) {
      engine.log(RecordEntry("scoring-link", listOf("result" to "stale", "status" to answered?.status)))
      tap.hand(ScoringLinks.wire(ScoringLinkAnswer.Refused("unavailable", null)))
      return
    }
    engine.log(RecordEntry("scoring-link", listOf("result" to read.word, "status" to answered?.status)))
    tap.hand(ScoringLinks.wire(read))
  }

  /**
   * R6, R7 of the D3 findings design: the notification's Forget, from the glue's receiver, on any thread. The machine
   * decides whether it acts (`Pairings.forget`: only while paired and waiting).
   */
  fun forget() = report(Input.Forget)

  /** From any thread: a failure the glue caught on its own scope (CD9). */
  fun failure(t: Throwable) {
    guarded.schedule(0) { failed(t) }
  }

  /**
   * From any thread (P11): work the platform posted for [request]'s pairing failed, such as the
   * capture build. It ends that pairing fatal-error and named, sticky for the process when permanent
   * and for the pairing otherwise (CD11). A failure for a pairing no longer held, by identity, is only
   * recorded: it must never end a newer one.
   */
  fun pairFailed(request: PairRequest, t: Throwable) {
    guarded.schedule(0) {
      if (!holds(request)) {
        engine.log(RecordEntry("pair-step-late", listOf("error" to t.javaClass.simpleName)))
      } else {
        val scope = if (Failures.permanent(t)) Scope.PROCESS else Scope.PAIRING
        sticky.fail(Failures.describe(t), engine.phase.attemptInHand, scope)
      }
    }
  }

  /**
   * From any thread (I4, A11): the capture for [request] could not open because another app holds
   * the camera. That is not ready, camera, never an end: the pairing stays, the engine reads the
   * camera taken while paired or held (Task 7), and the release the platform sees opens it again
   * through `ReopenCamera`. Checked by identity like [pairFailed]; a late one is only recorded.
   */
  fun cameraBusy(request: PairRequest) {
    guarded.schedule(0) {
      if (!holds(request)) {
        engine.log(RecordEntry("pair-step-late", listOf("error" to "camera-busy")))
      } else {
        engine.log(RecordEntry("camera-busy"))
        report(Input.CameraContended)
      }
    }
  }

  /**
   * From any thread (CD21): the platform could not ask for the permissions at all (no activity, or a
   * request already in flight). The pairing still asking ends fatal-error and named, so the operator
   * taps to pair again. It is never read as a refusal, whose panel would tell the operator to change
   * a setting they never saw. With no pairing asking, it is only recorded.
   */
  fun askFailed(t: Throwable) {
    guarded.schedule(0) {
      if (engine.phase !is Phase.Pairing) {
        engine.log(RecordEntry("pair-step-late", listOf("error" to t.javaClass.simpleName)))
      } else {
        sticky.fail(Failures.describe(t), engine.phase.attemptInHand, Scope.PAIRING)
      }
    }
  }

  /** P3: the notification's language, the pairing's until `setLanguage` replaces it; null with no pairing. Any thread. */
  fun language(): String? = language

  /**
   * From any thread (A11): the platform's facts; null leaves a fact as it was. Sent only when a check
   * changes. Sound is the mic's availability, never its level (spec §4): any finite [audioPeak] is an
   * audio buffer, so a silent room is sound at its first reading, and a null is no buffer since the
   * last call (pre-flight F4), which refreshes nothing. No buffer for [NO_AUDIO_MS] is not sound. The
   * pose comes held already, from the glue's [PoseTracker].
   */
  fun readiness(cameraFrames: Boolean? = null, audioPeak: Double? = null, pose: Pose? = null) {
    val atMs = clock.monotonicMs()
    guarded.schedule(0) {
      val ours = pose?.takeUnless { poseReleased }
      if (audioPeak != null && audioPeak.isFinite()) lastAudioAtMs = atMs // a null is no buffer (F4)
      readiness = readiness.copy(cameraFrames = cameraFrames ?: readiness.cameraFrames, micAvailable = micAvailable(), pose = ours ?: readiness.pose)
      val last = sent
      if (last == null || last.cameraFrames != readiness.cameraFrames || last.sound != readiness.sound || last.pose != readiness.pose) sendReadiness()
    }
  }

  /** From any thread (CD37): the glue's preview view attached to a window, or detached. */
  fun viewfinder(shown: Boolean) {
    viewfinder = shown
    guarded.schedule(0) { noticeCapture() }
  }

  /**
   * Carry 12: a JS line, posted. A whole JS number prints as `3`, not `3.0`; a fraction is kept and
   * written to tenths like every native number. A level outside the logger's four is `info` (C1 M3):
   * the record would mask it.
   */
  fun log(level: String, kind: String, fields: Map<String, Any?>) {
    val kept = if (level in SessionRecord.LEVELS) level else "info"
    engine.log(RecordEntry(kind, fields.map { (key, value) -> key to whole(value) }, kept))
  }

  fun current(): Map<String, Any?> = current

  /**
   * The record's last lines, oldest first, each with its seq (carry C4c-I3), as the bridge carries them:
   * `{seq, line}`, the seq a Double like every number JS reads. The platform hands each new line on with
   * the same seq, so JS drops an arriving line the tail already holds by number, never by its text.
   */
  fun tail(): List<Map<String, Any?>> {
    val held = record.numberedTail()
    return held.lines.mapIndexed { index, line -> mapOf("seq" to (held.firstSeq + index).toDouble(), "line" to line) }
  }

  /** [request] is the pairing held, by identity, and the pairing is not over. */
  private fun holds(request: PairRequest): Boolean = engine.phase.pairing?.request === request && engine.phase !is Phase.Ended

  private fun notice() {
    noticePair()
    noticeCapture()
  }

  /** A new pairing: its PAIRING-scope failures may be healed (CD11), and it hears the platform's readiness at once. */
  private fun noticePair() {
    val request = (engine.phase as? Phase.Pairing)?.pairing?.request ?: return
    if (request === noticed) return
    noticed = request
    sticky.pairAccepted()
    sendReadiness()
  }

  /**
   * Each change is a record line too: the post-match record shows when the phone was ready (AGENTS
   * §11), at most [CappedLines.MAX_LINES] a minute (review C4a I-1). The machine hears every change.
   */
  private fun sendReadiness() {
    sent = readiness
    readinessLines.line(clock.monotonicMs(), readinessFields(readiness))?.let(engine::log)
    engine.send(Input.ReadinessChanged(readiness))
  }

  private fun readinessFields(of: Readiness): List<Pair<String, Any?>> =
    listOf("camera" to of.cameraFrames, "sound" to of.sound, "held" to of.held, "side" to of.side)

  /**
   * CD37: on a change of [captureWanted], or of the pairing it is wanted for. PV20: a re-pair over a
   * shown viewfinder holds it through the new pairing's Pairing, opened for the new request; a first
   * pair waits for Paired, as the permissions are not granted before it.
   */
  private fun noticeCapture() {
    val phase = engine.phase
    val held = phase is Phase.Paired || (phase is Phase.Pairing && captureWanted)
    val wanted = phase.holdsBroadcast || (viewfinder && held)
    val request = if (wanted) phase.pairing?.request else null
    if (wanted == captureWanted && request === capturedFor) return
    captureWanted = wanted
    capturedFor = request
    platform.capture(wanted, phase.pairing?.request)
    if (!wanted) silenced()
  }

  /**
   * C4a carry (Task 33), under spec §4: the capture closed, so audio capture is unavailable and sound is
   * off at once, with no reading after it: the chip would otherwise show sound while nothing records. The
   * next opening's first buffer, silent or not, is sound again.
   */
  private fun silenced() {
    lastAudioAtMs = null
    turnMic()
  }

  /**
   * Spec §4: the system silenced our recording (F-P5-8, a call), the machine's fact as ever, and sound is
   * not ready at once; restored, sound is ready again at once, while the capture's last buffer is recent.
   */
  private fun micSilenced(silenced: Boolean) {
    systemSilenced = silenced
    turnMic()
  }

  /** D15: judged at each call; the glue calls every 500 ms while the capture is open, buffer or not. */
  private fun micAvailable(): Boolean {
    val heard = lastAudioAtMs ?: return false
    return clock.monotonicMs() - heard < NO_AUDIO_MS && !systemSilenced
  }

  /** Sends readiness when the mic's availability changed since the last one sent; nothing before the first. */
  private fun turnMic() {
    readiness = readiness.copy(micAvailable = micAvailable())
    val last = sent ?: return
    if (last.sound != readiness.sound) sendReadiness()
  }

  /**
   * Final review I-1: the pose is the pairing's. The glue's pose watch stops at Release and starts at the next Hold
   * with a tracker that reports only changes, so the core forgets the last pose at Release: the next pairing hears
   * not held when it begins (`noticePair`), until its own tracker reports. Not at Hold: readiness reported before a
   * pair is replayed into it (A11), and the machine is told nothing here, as no pairing holds after a Release.
   */
  private fun forgetPose() {
    readiness = readiness.copy(pose = Pose.NotHeld)
  }

  private fun route(command: Command) {
    pollers.onCommand(command)
    when (command) {
      is Command.FetchPlaylist ->
        ask({ HttpRequests.playlist(command) }) { outcome ->
          checkedAtMs = clock.wallMs()
          report(HttpAnswers.playlist(command.requestId, outcome))
        }
      is Command.PostHeartbeat -> beat(command)
      is Command.FetchCode ->
        ask({ HttpRequests.code(command) }) { report(HttpAnswers.code(command.requestId, it, command.environment)) }
      is Command.PostStart -> ask({ HttpRequests.start(command) }) { report(HttpAnswers.start(command.requestId, it)) }
      is Command.WriteStopped -> stored("write", PairingStore.STOPPED) { pairings.write(command.record) }
      is Command.DeleteStopped -> stored("delete", PairingStore.STOPPED) { pairings.delete(command.code, command.slot) }
      is Command.WriteForgotten -> stored("write", PairingStore.FORGOTTEN) { pairings.writeForgotten(command.name) }
      Command.Hold -> {
        poseReleased = false
        executed(command)
      }
      Command.Release -> {
        forgetPose()
        poseReleased = true
        executed(command)
      }
      else -> executed(command)
    }
  }

  /** The environment is read here, on the scheduler thread, for the answer that comes back on any thread. */
  private fun beat(command: Command.PostHeartbeat) {
    val env = engine.phase.pairing?.request?.environment ?: Environment.STAGING
    ask({ HttpRequests.heartbeat(command) }) { report(HttpAnswers.heartbeat(command.beatId, it, env)) }
  }

  /**
   * C0b: every request is answered exactly once. A throw from the platform's send is its answer, and
   * so is no answer at all by [ANSWER_BACKSTOP_MS]; whichever comes first wins and the rest are
   * dropped. Without it, one lost `POST start` answer would hold every later Go live of the pairing.
   * The request is built inside the guard too, so one that cannot be built is answered, as a failure
   * (review C4a m-2). Internal for that test; the scheduler thread only.
   */
  internal fun ask(build: () -> HttpRequest, answer: (HttpOutcome) -> Unit) {
    val answered = AtomicBoolean(false)
    lateinit var backstop: com.seazn.capture.engine.core.Cancellable
    val once = { outcome: HttpOutcome ->
      if (answered.compareAndSet(false, true)) {
        backstop.cancel()
        answer(outcome)
      }
    }
    backstop = guarded.schedule(ANSWER_BACKSTOP_MS) { once(HttpOutcome.Failed(NO_ANSWER)) }
    try {
      platform.http(build(), once)
    } catch (failure: Exception) {
      once(HttpOutcome.failed(failure))
    }
  }

  /**
   * A refused write is a record line, never silent (AGENTS §13, class 3), and never stops the `End` behind it. The
   * line names the file it was for (pre-flight N5: not always the stopped records).
   */
  private fun stored(op: String, key: String, write: () -> Unit) {
    try {
      write()
    } catch (failure: Exception) {
      engine.log(RecordEntry("store-failed", listOf("op" to op, "key" to key, "error" to failure.javaClass.simpleName)))
    }
  }

  /** CD11: a permanent failure is sticky, never retried; anything else is plan B's `command-failed`. */
  private fun executed(command: Command) {
    try {
      platform.execute(command)
    } catch (failure: Throwable) {
      if (!Failures.permanent(failure)) throw failure
      sticky.fail(Failures.describe(failure), engine.phase.attemptInHand, Scope.PROCESS)
    }
  }

  private fun published(snapshot: Snapshot) {
    // PV22: Phase.holdsService is Paired or a broadcast held, the wake lock's span: one definition.
    ticks.observe(clock.monotonicMs(), wakeHeld = engine.phase.holdsService)?.let(engine::log)
    val wire = wire(snapshot, read().copy(deliveryCheckedAtMs = checkedAtMs))
    language = snapshot.language
    current = wire
    // Review C4a m-1: a tick can move the phase with no input behind it, such as an outage hold that ran
    // out; the capture follows the phase. Posted, never run inside the snapshot sink (CD31).
    val phase = engine.phase.name
    if (phase != publishedPhase) {
      publishedPhase = phase
      guarded.schedule(0) { noticeCapture() }
    }
    // Review C4a N-1 (ruling C4a-N1): a minute that held lines back ends with the state the machine
    // heard, written by the first publish after it runs out, so a state that then stays is on the record.
    sent?.let { heard -> readinessLines.flush(clock.monotonicMs()) { readinessFields(heard) } }?.let(engine::log)
    platform.snapshot(wire)
  }

  /**
   * Review C4a I-2: facts that throw never stop the snapshots. The last good facts stand in, the
   * snapshot is counted as not whole, and the failure is an `engine-error` line, at most one a minute
   * ([ErrorLines]). An `Error` is not caught here: it reaches the task boundary (carry 15).
   */
  private fun read(): PlatformFacts =
    try {
      platform.facts().also { lastFacts = it }
    } catch (failure: Exception) {
      factsFailures += 1
      errors.line(clock.monotonicMs(), "facts: ${Failures.describe(failure)}")?.let(engine::log)
      lastFacts
    }

  /** The record's counters, the scheduler guard's (review 13, I3), and the engine's and the bridge's (review C4a I-2, m-8), for Diagnostics. */
  private fun wire(snapshot: Snapshot, facts: PlatformFacts): Map<String, Any?> =
    SnapshotWire.of(
      snapshot,
      facts,
      RecordCounters(
        record.sinkFailures,
        record.reentrantDropped,
        guarded.caught,
        guarded.reporterFailures,
        snapshotFailures = engine.snapshotFailures + factsFailures,
        commandFailures = engine.commandFailures,
        stickyFailure = sticky.failed,
      ),
    )

  /** The Frames poller's read, with CD33's gap line. Scheduler thread. */
  private fun frames(attemptId: Int): FrameCount? {
    val count = platform.frames(attemptId) ?: return null
    gaps.read(attemptId, count.video, clock.monotonicMs(), engine.phase is Phase.OnAir)?.let(engine::log)
    return count
  }

  /**
   * Whatever reached the task boundary (carry 15): sticky when permanent (CD11), then recorded. The
   * line is appended here, on the scheduler thread that is the record's one writer, never posted: a
   * line that fails the same way would come back here for ever (review 13, I2). [ErrorLines] bounds a
   * reader that throws on every read (review 14, G3).
   */
  private fun failed(t: Throwable) {
    if (Failures.permanent(t)) sticky.fail(Failures.describe(t), engine.phase.attemptInHand, Scope.PROCESS)
    errors.line(clock.monotonicMs(), Failures.describe(t))?.let { record.append(clock.wallMs(), it) }
  }

  private fun whole(value: Any?): Any? = if (value is Double && value % 1.0 == 0.0 && abs(value) <= MAX_EXACT) value.toLong() else value

  companion object {
    /**
     * C0b's backstop: twice the client's own timeout ([HttpRequests.TIMEOUT_MS]), so past it and past
     * every give-up of the core's (10 s): a real answer, or the core's own, always comes first.
     */
    const val ANSWER_BACKSTOP_MS = 2 * HttpRequests.TIMEOUT_MS

    /** The backstop's reason, a word: [HttpOutcome.Failed] carries a reason, never a value. */
    const val NO_ANSWER = "no-answer"

    /** Spec §4, pre-flight F4: no audio buffer for this long is "audio capture unavailable". */
    const val NO_AUDIO_MS = 2_000L

    /** 2^53: every whole Double up to it is exact. */
    private const val MAX_EXACT = 9_007_199_254_740_992.0

    @Volatile private var instance: BridgeCore? = null

    /** One engine per process (carry 18). A JS reload makes a new module over this same core (CD32). */
    fun shared(factory: () -> BridgeCore): BridgeCore = instance ?: synchronized(this) { instance ?: factory().also { instance = it } }

    /** Tests only: the next [shared] builds afresh. */
    internal fun resetShared() {
      synchronized(this) { instance = null }
    }
  }
}

/**
 * Review 14, G3: one `engine-error` line per distinct failure a minute, at most [MAX_DISTINCT]
 * distinct ones. A reader that throws on every read would otherwise write three lines a second, about
 * 32 000 in a three-hour match. Each line carries how many it held back since the last one written;
 * the scheduler guard's `caught` still counts every failure, for Diagnostics. Scheduler thread only.
 */
internal class ErrorLines {
  private var windowStartMs: Long? = null
  private val seen = mutableSetOf<String>()
  private var suppressed = 0

  fun line(monoMs: Long, message: String): RecordEntry? {
    val start = windowStartMs
    if (start == null || monoMs - start >= WINDOW_MS) {
      windowStartMs = monoMs
      seen.clear()
    }
    if (message in seen || seen.size >= MAX_DISTINCT) {
      suppressed += 1
      return null
    }
    seen += message
    val held = suppressed
    suppressed = 0
    return RecordEntry("engine-error", listOf("message" to message, "suppressed" to held))
  }

  companion object {
    const val WINDOW_MS = 60_000L
    const val MAX_DISTINCT = 16
  }
}

/**
 * Review C4a I-1: at most [MAX_LINES] lines of one [kind] a minute; `readiness` first, the second of its guards (the first is
 * [PoseTracker], owner 2026-10-05; sound needs none, as no level turns it, spec §4). A pairing settles in about four (the pair's, then
 * camera, sound and held), so six leave room; a check that keeps turning is held to six a minute, where it wiped the
 * record's tail before. The first line of a minute carries how many were held back since the last one
 * written, and every line the state it was written in. Only the line is held back: the machine hears
 * every change. A minute that held lines back is closed by [flush] (review C4a N-1), so the record's
 * last line is the machine's state within a minute of the last change, even when nothing changes
 * after it. Session 7, F-S7-3: `frames-gap` too ([FrameGaps]). Scheduler thread only.
 */
internal class CappedLines(private val kind: String) {
  private var windowStartMs: Long? = null
  private var written = 0
  private var suppressed = 0

  fun line(monoMs: Long, fields: List<Pair<String, Any?>>): RecordEntry? {
    val start = windowStartMs
    if (start == null || monoMs - start >= WINDOW_MS) {
      windowStartMs = monoMs
      written = 0
    }
    if (written >= MAX_LINES) {
      suppressed += 1
      return null
    }
    written += 1
    val held = suppressed
    suppressed = 0
    return RecordEntry(kind, fields + ("suppressed" to held))
  }

  /**
   * Review C4a N-1: once the window has run out with lines held back, the state now, as the first line
   * of the next window, carrying the count; null otherwise, so a state that stays with nothing held
   * back writes nothing. [fields] is read only when a line is written.
   */
  fun flush(monoMs: Long, fields: () -> List<Pair<String, Any?>>): RecordEntry? {
    val start = windowStartMs ?: return null
    if (suppressed == 0 || monoMs - start < WINDOW_MS) return null
    return line(monoMs, fields())
  }

  companion object {
    const val WINDOW_MS = 60_000L
    const val MAX_LINES = 6
  }
}
