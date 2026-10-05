package com.seazn.capture.engine.capture.run

import com.seazn.capture.engine.adapter.AttemptSignals
import com.seazn.capture.engine.adapter.CameraAvailability
import com.seazn.capture.engine.adapter.EncoderKeys
import com.seazn.capture.engine.adapter.PermanentPlatformFailure
import com.seazn.capture.engine.core.Command
import com.seazn.capture.engine.core.Configs
import com.seazn.capture.engine.core.ConnectFailure
import com.seazn.capture.engine.core.DropReason
import com.seazn.capture.engine.core.EndReason
import com.seazn.capture.engine.core.Input
import com.seazn.capture.engine.core.Side
import java.net.ConnectException
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertIs
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

  private fun connect(id: Int) = Command.Connect(id, Configs.srt, startBitrateBps = 3_000_000, maxBwBytesPerSecond = 1_000_000)

  private class Scene(val parts: FakeParts, val told: Told, val cameras: CameraAvailability, val run: CaptureRun)

  private fun TestScope.scene(cameras: CameraAvailability = CameraAvailability(), side: () -> Side = { Side.LEFT }): Scene {
    val parts = FakeParts()
    val told = Told()
    return Scene(parts, told, cameras, CaptureRun(parts, AttemptSignals(), cameras, told.calls(), side, queueScope()))
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
        // The release asks for the reopen, with nothing open: the pairing's request is built.
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
  fun `nothing held - no command reaches StreamPack, and a reopen answers false`() =
    runTest {
      val s = scene()
      does(s, connect(1), Command.Disconnect(1), Command.SetBitrate(1, 2_000_000), Command.Slate(true), Command.SwitchCamera, Command.ReopenCamera)
      assertEquals(emptyList(), s.parts.log)
      assertEquals(listOf<Input>(Input.CameraReopened(false)), s.told.reports)
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
