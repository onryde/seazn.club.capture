package com.seazn.capture.engine.capture.run

import com.seazn.capture.engine.adapter.AttemptSignals
import com.seazn.capture.engine.adapter.CameraAvailability
import com.seazn.capture.engine.adapter.EncoderKeys
import com.seazn.capture.engine.adapter.Failures
import com.seazn.capture.engine.adapter.PermanentPlatformFailure
import com.seazn.capture.engine.core.Command
import com.seazn.capture.engine.core.Configs
import com.seazn.capture.engine.core.ConnectFailure
import com.seazn.capture.engine.core.DropReason
import com.seazn.capture.engine.core.EndReason
import com.seazn.capture.engine.core.Input
import com.seazn.capture.engine.core.SessionMachine
import com.seazn.capture.engine.core.SessionRecord
import com.seazn.capture.engine.core.Shared
import com.seazn.capture.engine.core.Side
import java.io.IOException
import java.net.ConnectException
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.cancel
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.advanceTimeBy
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertIs
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertSame
import kotlin.test.assertTrue

/**
 * The capture's rules (Task 36) against a fake of StreamPack's parts. Single-mode: the capture has no
 * sport; the side held is its one mode, and the Orient cases take both.
 */
@OptIn(ExperimentalCoroutinesApi::class) // advanceUntilIdle and runCurrent
class CaptureRunTest {
  private val request = Configs.pairRequest()
  private val left = EncoderKeys.surfaceRotation(Side.LEFT)

  // Camera2's reasons, read with javap from android-36's android.jar (CameraAccessException).
  private val cameraInUse = 4
  private val maxCamerasInUse = 5
  private val cameraDisconnected = 2

  // StreamPack 3.2.1's packages (its sources): where the throws the device may name are made.
  private val pipelineOutput = "io.github.thibaultbee.streampack.core.pipelines.outputs.encoding.EncodingPipelineOutput"
  private val cameraSources = "io.github.thibaultbee.streampack.core.elements.sources.video.camera"

  private fun connect(id: Int) = Command.Connect(id, Configs.srt, startBitrateBps = 3_000_000, maxBwBytesPerSecond = 1_000_000)

  private class Scene(val parts: FakeParts, val told: Told, val cameras: CameraAvailability, val run: CaptureRun)

  private fun TestScope.scene(
    cameras: CameraAvailability = CameraAvailability(),
    side: () -> Side = { Side.LEFT },
    signals: AttemptSignals = AttemptSignals(),
  ): Scene {
    val parts = FakeParts()
    val told = Told()
    return Scene(parts, told, cameras, CaptureRun(parts, signals, cameras, told.calls(), side, queueScope()))
  }

  private fun TestScope.opened(): Scene =
    scene().also {
      it.run.open(request)
      advanceUntilIdle()
      it.parts.log.clear()
    }

  private fun TestScope.does(scene: Scene, vararg commands: Command) {
    commands.forEach(scene.run::execute)
    advanceUntilIdle()
  }

  // --- Review C7 I-2: StreamPack opens the camera lazily, so the build holds nothing until the open is seen ---

  @Test
  fun `I-2 a camera taken before the build is told at it, and stays taken until StreamPack reports our open`() =
    runTest {
      val cameras = CameraAvailability().apply { unavailable("0", 1_000) } // CameraWatch heard it before the build
      val s = scene(cameras)
      s.run.open(request)
      advanceUntilIdle()
      assertEquals(listOf<Input>(Input.CameraContended), s.told.reports, "the build holds nothing yet: the take stands")
      assertTrue(cameras.contended("0"))
      s.parts.opened("1")
      advanceUntilIdle()
      assertEquals(listOf<Input>(Input.CameraContended), s.told.reports, "another camera's open is not ours")
      s.parts.opened("0")
      advanceUntilIdle()
      assertEquals(listOf(Input.CameraContended, Input.CameraReleased), s.told.reports, "ours once open, and told over")
      assertFalse(cameras.contended("0"))
    }

  @Test
  fun `I-2 a build with nothing taken tells nothing, and its open tells nothing either`() =
    runTest {
      val s = opened()
      s.parts.opened("0")
      advanceUntilIdle()
      assertEquals(emptyList(), s.told.reports)
      assertTrue(s.cameras.ready(camera = true))
    }

  @Test
  fun `I-2 each opening watches its own camera's opens, the release ends the watch, and a rebuild keeps one`() =
    runTest {
      val s = scene()
      assertEquals(0, s.parts.watching, "nothing built, nothing watched")
      s.run.open(request)
      advanceUntilIdle()
      assertEquals(1, s.parts.watching)
      s.parts.log.clear()
      does(s, Command.Orient(Side.RIGHT)) // CD42: another side rebuilds
      assertEquals(listOf("release", "release done", "build ${EncoderKeys.surfaceRotation(Side.RIGHT)}", "build done"), s.parts.log.filter { it.startsWith("build") || it.startsWith("release") })
      assertEquals(1, s.parts.watching, "the old opening's watch ended with its release")
      s.run.close()
      advanceUntilIdle()
      assertEquals(0, s.parts.watching, "the release ends the watch")
      s.run.open(request)
      advanceUntilIdle()
      assertEquals(1, s.parts.watching, "the next opening watches again")
    }

  @Test
  fun `I-2 a busy build's release then the reopen's build is told nothing taken, and its open nothing more`() =
    runTest {
      val cameras = CameraAvailability()
      val s = scene(cameras)
      s.parts.builds += Built.Failed("0", cameraInUse, encoder = false, error = RuntimeException("Camera already in use"))
      s.run.open(request)
      advanceUntilIdle()
      assertEquals(listOf(request), s.told.busy)
      assertEquals(Input.CameraReleased, cameras.available("0", 3_000), "CameraWatch: the holder let go")
      does(s, Command.ReopenCamera)
      assertEquals(listOf<Input>(Input.CameraReopened(true)), s.told.reports, "nothing taken at the reopen's build")
      s.parts.opened("0")
      advanceUntilIdle()
      assertEquals(listOf<Input>(Input.CameraReopened(true)), s.told.reports)
    }

  // --- C6 CRITICAL: Disconnect(n) closes attempt n's endpoint only ---

  @Test
  fun `C6 CRITICAL Disconnect of an attempt the endpoint no longer holds leaves the newer attempt publishing`() =
    runTest {
      val s = opened()
      does(s, connect(1), connect(2))
      assertEquals(listOf(1), s.parts.closed, "attempt 2's connect closed attempt 1's endpoint")
      assertEquals(2, s.parts.publishing)
      s.parts.log.clear()
      does(s, Command.Disconnect(1))
      assertEquals(2, s.parts.publishing, "attempt 2 keeps publishing")
      assertEquals(emptyList(), s.parts.log, "nothing was stopped")
      // The positive pair: the attempt held is the one a Disconnect closes.
      does(s, Command.Disconnect(2))
      assertNull(s.parts.publishing)
      assertEquals(listOf(1, 2), s.parts.closed)
      assertEquals(emptyList(), s.told.reports.filterIsInstance<Input.Dropped>(), "both closes were asked for: no drop")
    }

  @Test
  fun `C6 a Disconnect with nothing held, or after the broadcast stopped, stops nothing`() =
    runTest {
      val s = opened()
      does(s, Command.Disconnect(1))
      assertEquals(emptyList(), s.parts.log)
      does(s, connect(1), Command.StopBroadcast)
      s.parts.log.clear()
      does(s, Command.Disconnect(1))
      assertEquals(emptyList(), s.parts.log, "the stop already closed it")
    }

  @Test
  fun `Rebuild and StartNewSession close the attempt held, then connect the next`() =
    runTest {
      val s = opened()
      does(s, connect(1))
      s.parts.log.clear()
      does(s, Command.Rebuild(1, connect(2)))
      assertEquals(listOf("stop 1", "stop done", "before 2", "start 2", "start done"), s.parts.log)
      s.parts.log.clear()
      does(s, Command.StartNewSession(2, connect(3)))
      assertEquals(listOf("stop 2", "stop done", "before 3", "start 3", "start done"), s.parts.log)
      assertEquals(listOf(1, 2), s.parts.closed)
      assertEquals(listOf(1, 2, 3), s.told.reports.filterIsInstance<Input.Connected>().map { it.attemptId })
      assertEquals(emptyList(), s.told.reports.filterIsInstance<Input.Dropped>(), "each close was asked for: no drop")
    }

  // --- AttemptSignals: every open reaches the machine; one drop per attempt ---

  @Test
  fun `every open reaches the machine, once, and an endpoint closing unasked is that attempt's one drop`() =
    runTest {
      val s = opened()
      does(s, connect(1))
      assertEquals(listOf<Input>(Input.Connected(1)), s.told.reports)
      s.parts.farEndCloses()
      advanceUntilIdle()
      val dropped = s.told.reports.filterIsInstance<Input.Dropped>()
      assertEquals(listOf(1), dropped.map { it.attemptId })
      assertEquals(DropReason.ENDPOINT_CLOSED, dropped.single().reason)
      // The machine's retry after the drop: the dead endpoint is closed first, as a stop asked for.
      does(s, connect(2))
      assertEquals(listOf("stop -", "stop done", "before 2", "start 2", "start done"), s.parts.log.takeLast(5))
      assertEquals(1, s.told.reports.count { it is Input.Dropped }, "still one drop")
    }

  @Test
  fun `a failed connect is reported through the signals, classified, and a target that does not plan is OTHER`() =
    runTest {
      val s = opened()
      s.parts.failing[1] = ConnectException("Connection setup failure: connection timed out")
      does(s, connect(1))
      val failed = s.told.reports.single()
      assertIs<Input.ConnectFailed>(failed)
      assertEquals(1, failed.attemptId)
      assertEquals(ConnectFailure.TIMEOUT, failed.failure)
      s.parts.gates[2] = CompletableDeferred(false) // already answered: the target does not plan
      does(s, connect(2))
      assertEquals(Input.ConnectFailed(2, ConnectFailure.OTHER, "srt url does not parse"), s.told.reports.last())
      assertEquals(emptyList(), s.told.reports.filterIsInstance<Input.Connected>())
    }

  // --- C7 carry: StreamPack opens the camera lazily, so another app's hold can surface first at the start ---

  @Test
  fun `C7 a camera found busy at the start is taken and the attempt UNHELD, and a transport's failure classifies as before`() =
    runTest {
      val s = opened()
      val busy = RuntimeException("Camera already in use")
      s.parts.failing[1] = busy
      s.parts.busyFailures[busy] = "0"
      does(s, connect(1))
      assertEquals(listOf(request), s.told.busy, "the camera is taken: the pairing waits for it")
      assertEquals(listOf<Input>(Input.ConnectFailed(1, ConnectFailure.UNHELD, "camera busy")), s.told.reports, "one report, never counted")
      assertTrue(s.cameras.contended("0"), "its release is waited for")
      assertEquals(emptyList(), s.told.pairFailed, "never an end")
      // The pair: the next attempt's transport failure is the signals' word, and no camera.
      s.parts.failing[2] = ConnectException("Connection setup failure: connection timed out")
      does(s, connect(2))
      val failed = s.told.reports.last()
      assertIs<Input.ConnectFailed>(failed)
      assertEquals(2 to ConnectFailure.TIMEOUT, failed.attemptId to failed.failure)
      assertEquals(listOf(request), s.told.busy, "a transport's failure is no busy camera")
    }

  @Test
  fun `C7 after a busy start the release reopens the camera, and the next attempt closes the first's endpoint and connects`() =
    runTest {
      val s = opened()
      val busy = RuntimeException("Max cameras in use")
      s.parts.failing[1] = busy
      s.parts.busyFailures[busy] = "0"
      does(s, connect(1))
      s.parts.log.clear()
      assertEquals(Input.CameraReleased, s.cameras.available("0", 5_000), "the device's release is told")
      does(s, Command.ReopenCamera, connect(2))
      assertEquals(listOf("reopen", "stop -", "stop done", "before 2", "start 2", "start done"), s.parts.log)
      assertEquals(listOf<Input>(Input.CameraReopened(true), Input.Connected(2)), s.told.reports.drop(1))
      assertEquals(2, s.parts.publishing)
    }

  /** R3: the sink's completion can end the attempt first; the busy start is then no second report, and still the camera's. */
  @Test
  fun `C7 M-3 a busy start whose attempt dropped while it started is UNHELD, never a drop, and takes the camera`() =
    runTest {
      val signals = AttemptSignals()
      val s = scene(signals = signals)
      s.run.open(request)
      advanceUntilIdle()
      val busy = RuntimeException("Camera already in use")
      s.parts.failing[1] = busy
      s.parts.busyFailures[busy] = "0"
      s.parts.starting = { id -> signals.dropped(id, IOException("endpoint closed"))?.let { s.told.reports += it } }
      does(s, connect(1))
      assertEquals(listOf<Input>(Input.ConnectFailed(1, ConnectFailure.UNHELD, "camera busy")), s.told.reports, "the drop was the busy start's own")
      assertEquals(listOf(request), s.told.busy)
      assertTrue(s.cameras.contended("0"))
    }

  @Test
  fun `M-3 a drop while a start is in flight passes at its end when the camera was not busy, as before`() =
    runTest {
      var checked = 0
      for ((label, fails) in listOf("a transport failure" to true, "an open" to false)) {
        val signals = AttemptSignals()
        val s = scene(signals = signals)
        s.run.open(request)
        advanceUntilIdle()
        if (fails) s.parts.failing[1] = ConnectException("refused")
        s.parts.starting = { id -> signals.dropped(id, IOException("endpoint closed"))?.let { s.told.reports += it } }
        does(s, connect(1))
        val expected = listOf<Input>(Input.Dropped(1, DropReason.ENDPOINT_CLOSED, "IOException: endpoint closed")) + if (fails) emptyList() else listOf(Input.Connected(1))
        assertEquals(expected, s.told.reports, label)
        checked += 1
      }
      assertEquals(2, checked, "the sweep's own count")
    }

  @Test
  fun `M-3 a drop held while a start is in flight passes when the start times out or is cancelled`() =
    runTest {
      var checked = 0
      for (cancelled in listOf(false, true)) {
        val signals = AttemptSignals()
        val parts = FakeParts()
        val told = Told()
        val scope = queueScope()
        val run = CaptureRun(parts, signals, CameraAvailability(), told.calls(), { Side.LEFT }, scope)
        run.open(request)
        advanceUntilIdle()
        parts.gates[1] = CompletableDeferred() // never answered: the start ends by its bound, or by the cancel
        parts.starting = { id -> signals.dropped(id, IOException("endpoint closed"))?.let { told.reports += it } }
        run.execute(connect(1))
        runCurrent()
        assertEquals(emptyList(), told.reports, "held while the start is in flight")
        if (cancelled) scope.cancel()
        advanceUntilIdle()
        val label = if (cancelled) "cancelled" else "timed out"
        assertEquals(listOf<Input>(Input.Dropped(1, DropReason.ENDPOINT_CLOSED, "IOException: endpoint closed")), told.reports, label)
        checked += 1
      }
      assertEquals(2, checked, "the sweep's own count")
    }

  /**
   * Device session 4, F-S4-1, through the real run and the real signals. The SRT socket connected, then StreamPack
   * 3.2.1's start failed later on, and its own catch closed the endpoint it had opened (`EncodingPipelineOutput
   * .startStream`, the 3.2.1 sources): our sink's close is a drop with no cause, held while the start was in flight.
   * The start's failure is what the machine hears, never that close; the record names the throw by class only.
   */
  @Test
  fun `F-S4-1 a start that fails after its endpoint opened reports its own failure, never the close its cleanup made`() =
    runTest {
      val quoted = "srt://live.cloudflare.com:778?streamid=${Configs.STREAM_ID}"
      val pipeline = thrownAt(IllegalStateException("Endpoint must be opened before starting stream: $quoted"), pipelineOutput, "startStreamUnsafe")
      val refused = thrownAt(ConnectException("Connection setup failure: connection rejected"), "com.seazn.capture.engine.srt.SeaznSrtSink", "startStream")
      val wrapped = RuntimeException("start failed", thrownAt(IllegalArgumentException("Output STREAM not found in outputs PREVIEW"), "$cameraSources.controllers.CameraController", "addTarget"))
      val rows =
        listOf(
          Triple(pipeline, ConnectFailure.OTHER, listOf("error" to "IllegalStateException", "site" to "EncodingPipelineOutput.startStreamUnsafe")),
          Triple(refused, ConnectFailure.REFUSED, listOf("error" to "ConnectException", "site" to "SeaznSrtSink.startStream")),
          Triple(wrapped, ConnectFailure.OTHER, listOf("error" to "RuntimeException", "site" to "CameraController.addTarget", "rootError" to "IllegalArgumentException")),
        )
      var checked = 0
      for ((thrown, expected, named) in rows) {
        val signals = AttemptSignals()
        val s = scene(signals = signals)
        s.run.open(request)
        advanceUntilIdle()
        s.parts.failing[1] = thrown
        s.parts.starting = { id -> signals.dropped(id, null)?.let { s.told.reports += it } } // the cleanup's close, while the start is in flight
        does(s, connect(1))
        assertEquals(listOf<Input>(Input.ConnectFailed(1, expected, Failures.describe(thrown))), s.told.reports, "${thrown.javaClass.simpleName}: the start's own failure")
        val line = s.told.lines.single { it.kind == "capture-start-failed" }
        assertEquals(listOf<Pair<String, Any?>>("attempt" to 1) + named, line.fields, "class names only")
        assertFalse(line.fields.any { (_, value) -> value.toString().contains("srt://") || value.toString().contains(" ") }, "never a message: ${line.fields}")
        checked += 1
      }
      assertEquals(3, checked, "the sweep's own count")
    }

  /** F-S4-1: the line is the allow-list's (kind and keys), and the record keeps its class names whole, never masked. */
  @Test
  fun `F-S4-1 the start-failed line is the allow-list's, and the record keeps its names`() =
    runTest {
      val signals = AttemptSignals()
      val s = scene(signals = signals)
      s.run.open(request)
      advanceUntilIdle()
      s.parts.failing[1] = RuntimeException("start failed", thrownAt(IllegalArgumentException("Output STREAM not found"), "$cameraSources.controllers.CameraController", "addTarget"))
      does(s, connect(1))
      val line = s.told.lines.single { it.kind == "capture-start-failed" }
      val list = Shared.read("scrub/allow-list.json")
      val plain = list.getJSONArray("plain").let { a -> (0 until a.length()).map { a.getString(it) }.toSet() }
      assertTrue(line.kind in list.getJSONObject("kinds").keySet(), "the kind is listed")
      assertEquals(emptyList(), line.fields.map { it.first }.filterNot { it in plain || it == "attempt" }, "each key plain")
      val written = mutableListOf<String>()
      SessionRecord { written += it }.append(0L, line)
      val record = written.single()
      for (name in listOf("RuntimeException", "CameraController.addTarget", "IllegalArgumentException")) assertTrue("\"$name\"" in record, "$name kept: $record")
      assertFalse(SessionRecord.MASK in record, record)
    }

  /** A throwable as StreamPack's code makes it: its stack starts at [method] of [type], where it was thrown. */
  private fun <T : Throwable> thrownAt(error: T, type: String, method: String): T =
    error.apply { stackTrace = arrayOf(StackTraceElement(type, method, "${type.substringAfterLast('.')}.kt", 1)) + stackTrace }

  /** F-S4-1: a start that runs out its bound is TIMEOUT, though its cancelled cleanup closed the endpoint it opened. */
  @Test
  fun `F-S4-1 a start that times out after its endpoint opened is TIMEOUT, never the close its cleanup made`() =
    runTest {
      val signals = AttemptSignals()
      val s = scene(signals = signals)
      s.run.open(request)
      advanceUntilIdle()
      s.parts.gates[1] = CompletableDeferred() // never answered: the start ends by its bound
      s.parts.starting = { id -> signals.dropped(id, null)?.let { s.told.reports += it } }
      does(s, connect(1))
      assertEquals(ConnectFailure.TIMEOUT, (s.told.reports.single() as? Input.ConnectFailed)?.failure, "${s.told.reports}")
    }

  // --- C6 I-1: a start is bounded, under the machine's own connect timeout ---

  @Test
  fun `C6 I-1 a start that never returns fails TIMEOUT, and a close queued behind it releases the camera within the machine's connect timeout`() =
    runTest {
      val s = opened()
      s.parts.gates[1] = CompletableDeferred() // never answered: a connect hung in the vendor's code
      var releasedAt: Long? = null
      s.parts.stopped = { if (s.parts.log.lastOrNull() == "release done") releasedAt = testScheduler.currentTime }
      s.run.execute(connect(1))
      s.run.close()
      advanceTimeBy(SessionMachine.CONNECT_TIMEOUT_MS / 2)
      runCurrent()
      assertFalse("release" in s.parts.log, "the hung start holds the one queue, and the close waits behind it")
      advanceUntilIdle()
      assertTrue("release done" in s.parts.log, "the close queued behind the hung start ran: ${s.parts.log}")
      assertFalse(s.parts.held, "the camera is released")
      val at = assertNotNull(releasedAt)
      assertTrue(at <= SessionMachine.CONNECT_TIMEOUT_MS, "released at $at ms, past the machine's ${SessionMachine.CONNECT_TIMEOUT_MS} ms")
      val failed = s.told.reports.single()
      assertIs<Input.ConnectFailed>(failed)
      assertEquals(1, failed.attemptId)
      assertEquals(ConnectFailure.TIMEOUT, failed.failure)
    }

  /** The sequence after it: the half-open endpoint is closed, the machine's own late Disconnect stops nothing, and the next attempt connects. */
  @Test
  fun `C6 I-1 after a start timed out its endpoint is closed, and the next attempt connects`() =
    runTest {
      val s = opened()
      s.parts.gates[1] = CompletableDeferred()
      does(s, connect(1))
      assertEquals(listOf("before 1", "start 1", "stop -", "stop done"), s.parts.log, "the cancelled start's endpoint is closed as a stop asked for")
      s.parts.log.clear()
      does(s, Command.Disconnect(1), connect(2))
      assertEquals(listOf("before 2", "start 2", "start done"), s.parts.log)
      assertEquals(2, s.parts.publishing)
      assertEquals(listOf(ConnectFailure.TIMEOUT), s.told.reports.filterIsInstance<Input.ConnectFailed>().map { it.failure })
      assertEquals(listOf<Input>(Input.Connected(2)), s.told.reports.filter { it !is Input.ConnectFailed })
    }

  // --- N2, I4, P11, P12 and the ledger advisory ---

  @Test
  fun `N2 a second open while one is held builds nothing, and serves the new pairing`() =
    runTest {
      val s = opened()
      val again = Configs.pairRequest(code = "fx42hmnp7k3r")
      s.run.open(again)
      advanceUntilIdle()
      assertEquals(emptyList(), s.parts.log)
      assertSame(again, s.run.request)
    }

  @Test
  fun `I4 a busy camera waits - Camera2's reasons, or the device's own word - and never fails the pairing`() =
    runTest {
      for ((label, reason, takenFirst) in listOf(Triple("in use", cameraInUse, false), Triple("max in use", maxCamerasInUse, false), Triple("onError, no code", null, true))) {
        val cameras = CameraAvailability()
        if (takenFirst) cameras.unavailable("0", 1_000) // another app opened camera 0 first
        val s = scene(cameras)
        s.parts.builds += Built.Failed("0", reason, encoder = false, error = RuntimeException("Camera already in use"))
        s.run.open(request)
        advanceUntilIdle()
        assertEquals(listOf(request), s.told.busy, label)
        assertEquals(emptyList(), s.told.pairFailed, label)
        assertTrue(cameras.contended("0"), "$label: the release is waited for")
        // The release asks for the reopen, with nothing open: the pairing's request is built. Review C7 I-2:
        // the release is heard first, as CameraWatch hears it; the reopen's build erases no take of its own.
        assertEquals(Input.CameraReleased, cameras.available("0", 3_000), "$label: the holder let go")
        s.parts.log.clear()
        does(s, Command.ReopenCamera)
        assertEquals(listOf("build $left", "build done"), s.parts.log, label)
        assertEquals(listOf<Input>(Input.CameraReopened(true)), s.told.reports, label)
      }
    }

  @Test
  fun `P12 the camera's own failure passes as it is, and a disconnect is not busy`() =
    runTest {
      val s = scene()
      val error = RuntimeException("Camera has been disabled")
      s.parts.builds += Built.Failed("0", cameraDisconnected, encoder = false, error = error)
      s.run.open(request)
      advanceUntilIdle()
      assertEquals(emptyList(), s.told.busy)
      assertSame(request, s.told.pairFailed.single().first)
      assertSame(error, s.told.pairFailed.single().second, "never wrapped: Failures.permanent alone decides")
      assertEquals(emptyList(), s.told.failures, "reported, never thrown (P11)")
    }

  @Test
  fun `CD11 the encoder's configuration failure is permanent, unless another app holds the camera`() =
    runTest {
      val s = scene()
      val error = IllegalArgumentException("codec refused")
      s.parts.builds += Built.Failed("0", null, encoder = true, error = error)
      s.run.open(request)
      advanceUntilIdle()
      val failed = s.told.pairFailed.single().second
      assertIs<PermanentPlatformFailure>(failed)
      assertSame(error, failed.cause)
      // StreamPack opens the camera lazily: a configuration that failed while another app holds it is busy.
      val cameras = CameraAvailability().apply { unavailable("0", 1_000) }
      val busy = scene(cameras)
      busy.parts.builds += Built.Failed("0", null, encoder = true, error = error)
      busy.run.open(request)
      advanceUntilIdle()
      assertEquals(listOf(request), busy.told.busy)
      assertEquals(emptyList(), busy.told.pairFailed)
    }

  @Test
  fun `ledger advisory - closing forgets the pairing, so a later reopen builds nothing`() =
    runTest {
      val s = scene()
      s.parts.builds += Built.Failed("0", cameraInUse, encoder = false, error = RuntimeException("busy"))
      s.run.open(request)
      s.run.close()
      advanceUntilIdle()
      assertNull(s.run.request)
      s.parts.log.clear()
      does(s, Command.ReopenCamera)
      assertEquals(emptyList(), s.parts.log, "no build for a pairing the capture no longer serves")
      assertEquals(listOf<Input>(Input.CameraReopened(false)), s.told.reports)
      // A second close is harmless, and opens nothing.
      s.run.close()
      advanceUntilIdle()
      assertEquals(listOf("release", "release done"), s.parts.log)
    }

  // --- CD42: the rotation is the build's ---

  @Test
  fun `CD42 Orient for the side the build encodes changes nothing, and with nothing open there is nothing to turn`() =
    runTest {
      val s = opened()
      does(s, Command.Orient(Side.LEFT))
      assertEquals(emptyList(), s.parts.log)
      assertEquals(emptyList(), s.told.lines)
      s.run.close()
      advanceUntilIdle()
      s.parts.log.clear()
      does(s, Command.Orient(Side.RIGHT))
      assertEquals(emptyList(), s.parts.log, "closed: no request, no rebuild")
    }

  @Test
  fun `CD42 the opening's side is read at the build, never later`() =
    runTest {
      var side = Side.RIGHT
      val s = scene(side = { side })
      s.run.open(request)
      advanceUntilIdle()
      side = Side.LEFT
      does(s, connect(1))
      assertEquals(listOf("build ${EncoderKeys.surfaceRotation(Side.RIGHT)}", "build done", "before 1", "start 1", "start done"), s.parts.log)
    }

  // --- N8 ---

  @Test
  fun `N8 an unreadable mic session is recorded once per opening, at its first connect`() =
    runTest {
      val s = opened()
      s.parts.micKnown = false
      does(s, connect(1), Command.Disconnect(1), connect(2))
      assertEquals(listOf("watch-failed"), s.told.lines.map { it.kind })
      assertEquals(listOf("action" to "mic-session"), s.told.lines.single().fields)
      does(s, Command.Orient(Side.RIGHT), connect(3)) // a new opening
      assertEquals(listOf("watch-failed", "capture-rebuilt", "watch-failed"), s.told.lines.map { it.kind })
    }

  // --- The broadcast's end, and the commands passed through ---

  @Test
  fun `StopBroadcast and End stop the attempt held and keep the camera`() =
    runTest {
      for (end in listOf(Command.StopBroadcast, Command.End(EndReason.OPERATOR_STOPPED), Command.End(EndReason.FATAL_ERROR))) {
        val s = opened()
        does(s, connect(1), end)
        assertEquals(listOf("before 1", "start 1", "start done", "stop 1", "stop done", "after"), s.parts.log, "$end")
        assertTrue(s.parts.held, "$end: the camera stays until close")
        assertEquals(emptyList(), s.told.reports.filterIsInstance<Input.Dropped>(), "$end")
      }
    }

  @Test
  fun `nothing held - no command reaches StreamPack, a connect is answered at once, and a reopen answers false`() =
    runTest {
      val s = scene()
      does(s, connect(1), Command.Disconnect(1), Command.SetBitrate(1, 2_000_000), Command.Slate(true), Command.SwitchCamera, Command.ReopenCamera)
      assertEquals(emptyList(), s.parts.log)
      assertEquals(listOf<Input>(Input.ConnectFailed(1, ConnectFailure.UNHELD, "no capture held"), Input.CameraReopened(false)), s.told.reports)
    }

  /**
   * C6 m-3: a connect with no capture held, a Rebuild's or a new session's next one too, is answered at
   * once with a line, never left for the machine's connect timeout. After a close as before an open, and
   * again for the next attempt.
   */
  @Test
  fun `C6 m-3 and I-3 a connect with nothing held writes a line and fails UNHELD at once, each time`() =
    runTest {
      val s = opened()
      s.run.close()
      advanceUntilIdle()
      s.parts.log.clear()
      does(s, connect(1), Command.Rebuild(1, connect(2)), Command.StartNewSession(2, connect(3)))
      assertEquals(emptyList(), s.parts.log, "nothing reached StreamPack")
      assertEquals((1..3).map<Int, Input> { Input.ConnectFailed(it, ConnectFailure.UNHELD, "no capture held") }, s.told.reports)
      assertEquals(List(3) { "capture-unheld" }, s.told.lines.map { it.kind })
      assertEquals((1..3).map { listOf<Pair<String, Any?>>("action" to "connect", "attempt" to it) }, s.told.lines.map { it.fields })
    }

  @Test
  fun `held - the encoder, the link, the camera and the slate commands reach StreamPack`() =
    runTest {
      val s = opened()
      s.parts.reopens = false
      does(s, Command.SetBitrate(1, 2_000_000), Command.SetMaxBw(1, 250_000), Command.SwitchCamera, Command.ReopenCamera, Command.Slate(true))
      assertEquals(listOf("bitrate 2000000", "maxbw 1 250000", "switch", "reopen", "slate true"), s.parts.log)
      assertEquals(listOf<Input>(Input.CameraReopened(false)), s.told.reports)
    }
}
