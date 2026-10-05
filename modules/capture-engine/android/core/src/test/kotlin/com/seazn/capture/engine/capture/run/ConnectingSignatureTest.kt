package com.seazn.capture.engine.capture.run

import com.seazn.capture.engine.adapter.AttemptSignals
import com.seazn.capture.engine.adapter.CameraAvailability
import com.seazn.capture.engine.core.BeatCadence
import com.seazn.capture.engine.core.BeatReply
import com.seazn.capture.engine.core.Command
import com.seazn.capture.engine.core.Configs
import com.seazn.capture.engine.core.ConnectFailure
import com.seazn.capture.engine.core.Engine
import com.seazn.capture.engine.core.FakeClock
import com.seazn.capture.engine.core.FakeScheduler
import com.seazn.capture.engine.core.FallbackPolicy
import com.seazn.capture.engine.core.HeartbeatResponse
import com.seazn.capture.engine.core.Input
import com.seazn.capture.engine.core.RtmpsTarget
import com.seazn.capture.engine.core.SessionMachine
import com.seazn.capture.engine.core.SessionRecord
import com.seazn.capture.engine.core.Side
import com.seazn.capture.engine.core.SrtTarget
import java.net.ConnectException
import java.net.UnknownHostException
import java.util.concurrent.ConcurrentLinkedQueue
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.asCoroutineDispatcher
import kotlinx.coroutines.cancel
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.advanceTimeBy
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import org.json.JSONObject
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/**
 * Fix round 2, item 4: staging session a094a232 sat in `connecting` over SRT for more than 60 s, then sent no
 * beat for about 112 s, then came back `paired` with `stopped`. The real machine, the real capture queue
 * ([CaptureRun], [CaptureSerial]) and the real [AttemptSignals], with only StreamPack faked, on both clocks.
 *
 * What these show, whichever way the capture fails:
 * - The beat runs on the machine's scheduler and never waits on the capture: a start that hangs, on a
 *   coroutine or on a thread no cancel reaches, leaves the beat cadence as it was.
 * - The start bound (C6 I-1) and the connect timeout bound one attempt each, never the session: a session
 *   whose every attempt fails retries every [SessionMachine.RETRY_MS]. Only a counted failure moves it to
 *   RTMPS, so a session in `connecting` on SRT past three attempts is one whose failures did not count.
 * - A Stop while never live ends the pairing with no final beat (A8), and Ended beats nothing, so the
 *   server hears nothing until the next pairing's first beat carries the stopped sid (A17).
 */
@OptIn(ExperimentalCoroutinesApi::class) // advanceTimeBy and runCurrent
class ConnectingSignatureTest {
  /** One beat as the server would have read it. */
  private data class Beat(val atMs: Long, val state: String, val transport: String?, val sid: String?, val stopped: String?, val notReady: String?)

  private class Rig(private val scope: TestScope) {
    val clock = FakeClock()
    val scheduler = FakeScheduler(clock)
    val lines = mutableListOf<String>()
    val executed = mutableListOf<Command>()
    val parts = FakeParts()
    val told = Told()
    val beats = mutableListOf<Beat>()

    /** Each capture report, with the capture's own clock when it was made. */
    val reported = mutableListOf<Pair<Input, Long>>()

    /** When each attempt's start began, on the capture's clock. */
    val startedAt = mutableMapOf<Int, Long>()

    /** Beats are answered 2xx from the second on; the first is the pairing's, answered by [Configs.pairInputs]. */
    var answering = false
    lateinit var run: CaptureRun
    val engine =
      Engine(
        clock,
        scheduler,
        commands = { command ->
          executed += command
          if (command is Command.PostHeartbeat) heard(command)
          run.execute(command)
        },
        snapshots = {},
        record = SessionRecord { lines += it },
      )

    init {
      val calls =
        told.calls(
          report = {
            told.reports += it
            reported += it to scope.testScheduler.currentTime
            engine.send(it)
          },
          cameraBusy = { told.busy += it; engine.send(Input.CameraContended) },
        )
      parts.starting = { id -> startedAt[id] = scope.testScheduler.currentTime }
      run = CaptureRun(parts, AttemptSignals(), CameraAvailability(), calls, { Side.LEFT }, scope.queueScope())
      engine.start()
      run.open(Configs.pairRequest())
    }

    private fun heard(beat: Command.PostHeartbeat) {
      val body = JSONObject(beat.body)
      fun text(key: String) = if (body.isNull(key)) null else body.getString(key)
      beats += Beat(clock.mono, body.getString("state"), text("transport"), text("sid"), text("stopped"), text("notReady"))
      if (answering) engine.send(Input.HeartbeatAnswered(beat.beatId, ANSWER))
    }

    fun kinds(kind: String): List<JSONObject> = lines.map(::JSONObject).filter { it.getString("kind") == kind }

    /** Every attempt the machine asked for: a connect, or a rebuild's or a new session's next one. */
    val connects: List<Command.Connect>
      get() = executed.mapNotNull { (it as? Command.Connect) ?: (it as? Command.Rebuild)?.next ?: (it as? Command.StartNewSession)?.next }
  }

  /** Pair, go live and arm, as staging's session did; beats are answered from here on. */
  private fun TestScope.armed(rig: Rig) {
    Configs.pairInputs().forEach(rig.engine::send)
    rig.scheduler.advanceBy(0)
    runCurrent()
    rig.answering = true
  }

  /** Both clocks forward together, the capture's first, in steps of [STEP_MS]; [each] runs after every step. */
  private fun TestScope.both(rig: Rig, ms: Long, each: () -> Unit = {}) {
    var done = 0L
    while (done < ms) {
      advanceTimeBy(STEP_MS)
      runCurrent()
      rig.scheduler.advanceBy(STEP_MS)
      runCurrent()
      each()
      done += STEP_MS
    }
  }

  /** The beat cadence over [beats]: every gap the held cadence, give or take a tick. Returns how many gaps it checked. */
  private fun cadence(beats: List<Beat>, label: String): Int {
    val gaps = beats.zipWithNext { a, b -> b.atMs - a.atMs }
    for (gap in gaps) assertTrue(gap in BeatCadence.HELD_MAX_MS..BeatCadence.HELD_MAX_MS + Engine.TICK_MS, "$label: a beat gap of $gap ms in ${beats.map { it.atMs }}")
    return gaps.size
  }

  /** How the capture fails each attempt, and whether that moves the session to RTMPS (C1, F-P5-1, F-P5-2, F-P5-6). */
  private enum class Failing(val fallsBack: Boolean) {
    /** The start never returns: the start bound fails it TIMEOUT, counted. */
    HANGS(fallsBack = true),

    /** The ingest rejects the handshake: REFUSED, counted. */
    REFUSED(fallsBack = true),

    /** It connects, and the far end closes it at once: a short attempt's drop, counted. */
    CLOSED_BY_FAR_END(fallsBack = true),

    /** It connects, and no encoded frame reaches the endpoint: the stall watchdog rebuilds it, never counted. */
    NO_FIRST_FRAME(fallsBack = false),

    /** The start never returns, and the network is not validated: nothing counts (C1). */
    HANGS_UNVALIDATED(fallsBack = false),

    /** The ingest host does not resolve: UNRESOLVED, never counted (F-P5-1). */
    UNRESOLVED(fallsBack = false),
  }

  private fun Rig.fail(how: Failing) {
    val ids = 1..MAX_ATTEMPTS
    when (how) {
      Failing.HANGS, Failing.HANGS_UNVALIDATED -> ids.forEach { parts.gates[it] = CompletableDeferred() }
      Failing.REFUSED -> ids.forEach { parts.failing[it] = ConnectException("Connection setup failure: connection rejected") }
      Failing.UNRESOLVED -> ids.forEach { parts.failing[it] = UnknownHostException("live.stg.seazn.club") }
      Failing.CLOSED_BY_FAR_END, Failing.NO_FIRST_FRAME -> Unit
    }
  }

  /**
   * Item 4's sweep: six ways a start fails, each for [WINDOW_MS] on both clocks. In all five the beat keeps its
   * cadence. The three counted ones are on RTMPS by the fourth attempt, which the beats then name; the three that
   * never count stay `connecting` on SRT the whole window, as staging's did. A hung start fails TIMEOUT at
   * exactly [CaptureRun.START_BOUND_MS] after it began.
   */
  @Test
  fun `final r2 item 4 whatever the start does the beat keeps its cadence, and only uncounted failures stay connecting on SRT`() =
    runTest {
      var beatGaps = 0
      var bounded = 0
      val checked = mutableListOf<Failing>()
      for (how in Failing.entries) {
        val rig = Rig(this)
        rig.fail(how)
        armed(rig)
        if (how == Failing.HANGS_UNVALIDATED) {
          rig.engine.send(Input.Network(false))
          rig.scheduler.advanceBy(0)
        }
        both(rig, WINDOW_MS) { if (how == Failing.CLOSED_BY_FAR_END) rig.parts.publishing?.let { rig.parts.farEndCloses() } }
        val label = "$how"
        val held = rig.beats.filter { it.sid != null }
        assertTrue(held.size >= (WINDOW_MS / (BeatCadence.HELD_MAX_MS + Engine.TICK_MS)).toInt() - 1, "$label: ${held.size} held beats in $WINDOW_MS ms")
        beatGaps += cadence(rig.beats, label)
        assertEquals(setOf("connecting"), held.drop(1).map { it.state }.toSet(), "$label: ${held.map { it.state }}")

        val srt = rig.connects.takeWhile { it.target is SrtTarget }
        if (how.fallsBack) {
          assertEquals(FallbackPolicy.FAILURES_TO_FALL_BACK, srt.size, "$label: SRT attempts before the fallback: ${rig.connects.map { it.target }}")
          assertTrue(rig.connects.drop(srt.size).isNotEmpty() && rig.connects.drop(srt.size).all { it.target is RtmpsTarget }, "$label: then RTMPS")
          assertEquals(1, rig.kinds("fell-back").size, label)
          assertTrue(held.any { it.transport == "rtmps" }, "$label: the beats name RTMPS: ${held.map { it.transport }}")
        } else {
          assertTrue(rig.connects.size > FallbackPolicy.FAILURES_TO_FALL_BACK, "$label: ${rig.connects.size} attempts, past the fallback's count")
          assertTrue(rig.connects.all { it.target is SrtTarget }, "$label: never off SRT")
          assertEquals(emptyList(), rig.kinds("fell-back"), label)
          assertEquals(setOf("srt"), held.drop(1).map { it.transport }.toSet(), "$label: ${held.map { it.transport }}")
          val connecting = held.drop(1)
          assertTrue(connecting.last().atMs - connecting.first().atMs >= STAGING_CONNECTING_MS, "$label: connecting on SRT for ${connecting.last().atMs - connecting.first().atMs} ms")
        }
        if (how == Failing.HANGS || how == Failing.HANGS_UNVALIDATED) {
          val timeouts = rig.reported.filter { (input, _) -> input is Input.ConnectFailed && input.failure == ConnectFailure.TIMEOUT }
          assertTrue(timeouts.size >= FallbackPolicy.FAILURES_TO_FALL_BACK, "$label: ${timeouts.size} timeouts")
          for ((input, at) in timeouts) {
            val id = (input as Input.ConnectFailed).attemptId
            assertEquals(CaptureRun.START_BOUND_MS, at - rig.startedAt.getValue(id), "$label: attempt $id's start bound")
            bounded += 1
          }
        }
        if (how == Failing.HANGS_UNVALIDATED) assertEquals(setOf("network"), held.drop(1).map { it.notReady }.toSet(), "$label: the beats say why")
        if (how == Failing.NO_FIRST_FRAME) assertTrue(rig.kinds("video-stalled").all { it.getString("cause") == "no-first-frame" } && rig.kinds("video-stalled").isNotEmpty(), label)
        checked += how
      }
      assertEquals(Failing.entries.toList(), checked, "the sweep's own count")
      assertTrue(beatGaps > 0 && bounded > 0, "$beatGaps beat gaps and $bounded start bounds checked")
    }

  /**
   * Item 4, the silence: a Stop while connecting, never live, ends the pairing with A17's record and no final beat
   * (A8), and Ended beats nothing (`Phase.beating`). The server hears nothing until the next pairing, whose first
   * beat goes at once, `paired`, holding no sid, carrying the stopped one: staging's 13:43:03 to 13:44:55.
   */
  @Test
  fun `final r2 item 4 a Stop while never live is silent until the next pairing's first beat carries the stopped sid`() =
    runTest {
      val rig = Rig(this)
      rig.fail(Failing.NO_FIRST_FRAME)
      armed(rig)
      both(rig, WINDOW_MS)
      val before = rig.beats.size
      val sent = rig.executed.size
      rig.engine.send(Input.Stop)
      rig.scheduler.advanceBy(0)
      runCurrent()
      val atStop = rig.executed.drop(sent)
      val stored = atStop.filterIsInstance<Command.WriteStopped>().single().record
      assertEquals("sess_42", stored.sid)
      assertTrue(Command.Release in atStop, "the service is let go: $atStop")
      assertEquals(emptyList(), atStop.filterIsInstance<Command.PostHeartbeat>(), "never live: no final beat")
      assertEquals(false, rig.kinds("ended").single().getBoolean("wasLive"))

      both(rig, SILENT_MS)
      assertEquals(before, rig.beats.size, "Ended beats nothing: ${rig.beats.drop(before)}")

      rig.engine.send(Input.Reset)
      rig.engine.send(Input.Pair(Configs.pairRequest(), Configs.PHONE, stopped = stored))
      rig.engine.send(Input.PermissionsAnswered(granted = true))
      val pairedAt = rig.clock.mono
      rig.scheduler.advanceBy(0)
      val first = rig.beats.drop(before).single()
      assertEquals(Beat(pairedAt, "paired", null, null, "sess_42", first.notReady), first)
    }

  /**
   * Item 4, a start that blocks its thread where no cancel reaches it (a vendor call that ignores interrupts), on
   * real threads as `Dispatchers.Default` runs the capture. The machine never waits on it: every command it hands
   * the capture returns at once, the beat keeps its cadence, the machine's own connect timeout fails each attempt
   * queued behind the stuck one, and the third counted failure moves the session to RTMPS. So a stuck capture
   * thread alone cannot keep a session on SRT, or stop its beats.
   */
  @Test
  fun `final r2 item 4 a start blocked on its thread holds nothing the machine waits for`() {
    val pool = Executors.newSingleThreadExecutor()
    val scope = CoroutineScope(pool.asCoroutineDispatcher() + SupervisorJob())
    val blocked = CountDownLatch(1)
    val release = CountDownLatch(1)
    try {
      val clock = FakeClock()
      val scheduler = FakeScheduler(clock)
      val lines = mutableListOf<String>()
      val executed = mutableListOf<Command>()
      val beats = mutableListOf<Beat>()
      val fromCapture = ConcurrentLinkedQueue<Input>()
      val failures = ConcurrentLinkedQueue<Throwable>()
      val parts = FakeParts()
      parts.starting = { id ->
        if (id == 1) {
          blocked.countDown()
          while (true) {
            try {
              release.await()
              break
            } catch (_: InterruptedException) {
              // a vendor call that ignores interrupts: keep holding the thread
            }
          }
        }
      }
      val calls =
        CoreCalls(
          report = { fromCapture += it },
          failure = { failures += it },
          pairFailed = { _, t -> failures += t },
          cameraBusy = {},
          readiness = { _, _ -> },
          line = {},
        )
      val run = CaptureRun(parts, AttemptSignals(), CameraAvailability(), calls, { Side.LEFT }, scope)
      var slowest = 0L
      lateinit var engine: Engine
      engine =
        Engine(
          clock,
          scheduler,
          commands = { command ->
            executed += command
            if (command is Command.PostHeartbeat) {
              val body = JSONObject(command.body)
              beats += Beat(clock.mono, body.getString("state"), body.optString("transport"), body.optString("sid"), null, null)
              engine.send(Input.HeartbeatAnswered(command.beatId, ANSWER))
            }
            val began = System.nanoTime()
            run.execute(command)
            slowest = maxOf(slowest, System.nanoTime() - began)
          },
          snapshots = {},
          record = SessionRecord { lines += it },
        )
      engine.start()
      run.open(Configs.pairRequest())
      Configs.pairInputs().forEach(engine::send)
      scheduler.advanceBy(0)
      assertTrue(blocked.await(5, TimeUnit.SECONDS), "attempt 1's start is holding the capture's thread")
      var stepped = 0L
      while (stepped < WINDOW_MS) {
        while (true) engine.send(fromCapture.poll() ?: break)
        scheduler.advanceBy(STEP_MS)
        stepped += STEP_MS
      }
      assertTrue(slowest < TimeUnit.MILLISECONDS.toNanos(MAX_CALL_MS), "a command took ${slowest / 1_000_000} ms to hand to the capture")
      assertEquals(listOf("start 1"), parts.log.filter { it.startsWith("start") }, "the capture is still inside attempt 1's start")
      val gaps = cadence(beats, "blocked")
      assertTrue(gaps >= (WINDOW_MS / (BeatCadence.HELD_MAX_MS + Engine.TICK_MS)).toInt() - 1, "$gaps beat gaps")
      val failed = lines.map(::JSONObject).filter { it.getString("kind") == "connect-failed" }
      assertEquals(List(FallbackPolicy.FAILURES_TO_FALL_BACK) { "timeout" }, failed.take(FallbackPolicy.FAILURES_TO_FALL_BACK).map { it.getString("failure") })
      assertTrue(failed.take(FallbackPolicy.FAILURES_TO_FALL_BACK).all { it.getBoolean("counted") }, "$failed")
      val connects = executed.filterIsInstance<Command.Connect>()
      assertTrue(connects.drop(FallbackPolicy.FAILURES_TO_FALL_BACK).firstOrNull()?.target is RtmpsTarget, "fell back: ${connects.map { it.target }}")
      assertTrue(beats.any { it.transport == "rtmps" }, "the beats name RTMPS: ${beats.map { it.transport }}")
      assertEquals(emptyList(), failures.toList(), "the capture's queue took every command")
    } finally {
      release.countDown()
      scope.cancel()
      pool.shutdownNow()
    }
  }

  private companion object {
    const val STEP_MS = 100L

    /** Two minutes, as staging's session was in `connecting` from 13:41:11.8 to its last beat at 13:43:03.1. */
    const val WINDOW_MS = 120_000L

    /** Staging's: still `connecting` on SRT more than 60 s after its first connecting beat. */
    const val STAGING_CONNECTING_MS = 60_000L

    /** Staging's silence, 13:43:03.1 to 13:44:55.3, rounded down. */
    const val SILENT_MS = 112_000L

    /** More attempts than any window here makes. */
    const val MAX_ATTEMPTS = 100

    /** Handing a command to the capture is a queue's send: far under this, even on a loaded machine. */
    const val MAX_CALL_MS = 1_000L

    /** Staging's answer while a session warms: go-live, naming it, with its waiting fields. */
    val ANSWER = HeartbeatResponse.Answered(200, BeatReply("go-live", "sess_42", "organiser", null, Configs.waiting()))
  }
}
