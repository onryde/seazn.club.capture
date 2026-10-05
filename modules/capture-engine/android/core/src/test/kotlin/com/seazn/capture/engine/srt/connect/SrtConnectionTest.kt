package com.seazn.capture.engine.srt.connect

import com.seazn.capture.engine.adapter.AttemptSignals
import com.seazn.capture.engine.adapter.CameraAvailability
import com.seazn.capture.engine.capture.run.CaptureParts
import com.seazn.capture.engine.capture.run.CaptureRun
import com.seazn.capture.engine.capture.run.FakeParts
import com.seazn.capture.engine.capture.run.Told
import com.seazn.capture.engine.capture.run.queueScope
import com.seazn.capture.engine.core.Command
import com.seazn.capture.engine.core.Configs
import com.seazn.capture.engine.core.ConnectFailure
import com.seazn.capture.engine.core.DropReason
import com.seazn.capture.engine.core.Input
import com.seazn.capture.engine.core.Side
import java.net.InetSocketAddress
import java.net.SocketException
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertIs
import kotlin.test.assertTrue

/**
 * Our SRT sink's connect and end (C6 I-2) on the JVM, driven by the capture's own rules ([CaptureRun])
 * with the one [AttemptSignals] both share, as `StreamerAdapter` builds them. The socket is a fake of
 * srtdroid 1.10.0's that ends as srtdroid's does (javap, [SrtSocketPort.connect]): a connect that fails
 * completes the socket's context with the failure, then rethrows it.
 */
@OptIn(ExperimentalCoroutinesApi::class) // advanceUntilIdle
class SrtConnectionTest {
  /** libsrt's text for SRT_ECONNREJ, which srtdroid throws as a `SocketException` (javap: `executeEpoll`). */
  private val refused = "Connection setup failure: connection rejected"

  /** srtdroid's own text for a socket that broke once connected (javap: `executeEpoll`). */
  private val broken = "Connection was broken"

  private fun connect(id: Int) = Command.Connect(id, Configs.srt, startBitrateBps = 3_000_000, maxBwBytesPerSecond = 1_000_000)

  /** srtdroid 1.10.0's socket, as far as the order goes. Its context is a real Job, so a listener on an ended socket runs at once. */
  private class FakeSocket(private val failure: Exception? = null, private val endsOnConnect: Exception? = null) : SrtSocketPort {
    val context = Job()
    var connects = 0

    override suspend fun connect(address: InetSocketAddress) {
      connects += 1
      if (failure != null) {
        context.completeExceptionally(failure) // srtdroid: close, complete(Throwable), then rethrow
        throw failure
      }
      endsOnConnect?.let { context.completeExceptionally(it) } // ended in the gap before the listener
    }

    override fun onEnd(handler: (Throwable?) -> Unit) {
      context.invokeOnCompletion(handler)
    }

    fun farEndCloses(cause: Throwable) = context.completeExceptionally(cause)

    var closes = 0

    override fun close() {
      closes += 1
      context.complete() // srtdroid 1.10.0: close() completes the socket's context
    }
  }

  /** StreamPack's parts with our sink as the endpoint: each start connects the next socket through [connection]. */
  private class SinkParts(private val fake: FakeParts, private val connection: SrtConnection, private val sockets: ArrayDeque<FakeSocket>) :
    CaptureParts by fake {
    private var socket: FakeSocket? = null

    /** What the sink's MAXBW `setSockFlag` throws once connected, if anything (C6 re-review). */
    var maxBwFails: Exception? = null

    override suspend fun start(connect: Command.Connect): Boolean {
      val next = sockets.removeFirst()
      connection.connect(next, connect.attemptId, InetSocketAddress.createUnresolved("ingest.example", 7000)) {
        maxBwFails?.let { throw it }
        socket = next
      }
      return true
    }

    override suspend fun stop() {
      socket?.close()
      socket = null
      connection.closed()
      fake.stop()
    }

    override suspend fun endpointClosed() {
      connection.isOpen.first { !it }
    }
  }

  private class Scene(val run: CaptureRun, val told: Told, val connection: SrtConnection, val parts: SinkParts)

  private fun TestScope.scene(vararg sockets: FakeSocket): Scene {
    val signals = AttemptSignals()
    val told = Told()
    val calls = told.calls()
    val connection = SrtConnection(signals, calls.report)
    val parts = SinkParts(FakeParts(), connection, ArrayDeque(sockets.toList()))
    val run = CaptureRun(parts, signals, CameraAvailability(), calls, { Side.LEFT }, queueScope())
    run.open(Configs.pairRequest())
    advanceUntilIdle()
    return Scene(run, told, connection, parts)
  }

  private fun TestScope.does(scene: Scene, vararg commands: Command) {
    commands.forEach(scene.run::execute)
    advanceUntilIdle()
  }

  @Test
  fun `C6 I-2 a refused connect is that attempt's one ConnectFailed, REFUSED, and never a drop`() =
    runTest {
      val socket = FakeSocket(SocketException(refused))
      val s = scene(socket)
      does(s, connect(1))
      assertEquals(1, socket.connects)
      val failed = s.told.reports.single() // exactly one report: no drop before or after it
      assertIs<Input.ConnectFailed>(failed)
      assertEquals(1, failed.attemptId)
      assertEquals(ConnectFailure.REFUSED, failed.failure, "ruling 15: a refused ingest asks for the code again")
      assertFalse(s.connection.isOpen.value)
    }

  @Test
  fun `C6 I-2 the far end closing a connected socket is that attempt's one drop`() =
    runTest {
      val socket = FakeSocket()
      val s = scene(socket)
      does(s, connect(1))
      assertEquals(listOf<Input>(Input.Connected(1)), s.told.reports)
      socket.farEndCloses(SocketException(broken))
      advanceUntilIdle()
      val dropped = s.told.reports.filterIsInstance<Input.Dropped>()
      assertEquals(listOf(1), dropped.map { it.attemptId }, "one drop, though the run's own watch saw the close too")
      assertEquals(DropReason.ENDPOINT_CLOSED, dropped.single().reason)
      assertEquals(2, s.told.reports.size, "${s.told.reports}")
      assertFalse(s.connection.isOpen.value)
    }

  /** The sequence: a refused attempt, then the machine's next one, which connects and is later cut. */
  @Test
  fun `C6 I-2 after a refused attempt the next one connects, and its cut is its own one drop`() =
    runTest {
      val first = FakeSocket(SocketException(refused))
      val second = FakeSocket()
      val s = scene(first, second)
      does(s, connect(1), connect(2))
      second.farEndCloses(SocketException(broken))
      advanceUntilIdle()
      assertEquals(listOf("ConnectFailed 1 REFUSED", "Connected 2", "Dropped 2 ENDPOINT_CLOSED"), s.told.reports.map(::named))
    }

  /** A socket that ends after its connect returned and before the sink listens still reports: an ended Job runs a new listener at once. */
  @Test
  fun `C6 I-2 a socket that ends before the listening still reports its one drop, and the endpoint shows closed`() =
    runTest {
      val s = scene(FakeSocket(endsOnConnect = SocketException(broken)))
      does(s, connect(1))
      assertEquals(listOf("Dropped 1 ENDPOINT_CLOSED", "Connected 1"), s.told.reports.map(::named))
      assertFalse(s.connection.isOpen.value, "the endpoint was marked open before the listener, never after it")
    }

  // --- C6 re-review: a socket connected and then refused by the sink's own MAXBW is closed, not left open ---

  /** srtdroid's `setSockFlag` failing once connected; made-up text. Closed by the connect, it never reaches the run's stop. */
  @Test
  fun `C6 re-review a held() that throws closes the socket it connected, fails that attempt once, and the next one connects`() =
    runTest {
      val first = FakeSocket()
      val second = FakeSocket()
      val s = scene(first, second)
      s.parts.maxBwFails = SocketException("Operation not supported: Bad parameters")
      does(s, connect(1))
      assertEquals(1, first.connects)
      assertEquals(1, first.closes, "nothing else holds a socket whose held() threw: the connect closes it")
      assertEquals(listOf("ConnectFailed 1 OTHER"), s.told.reports.map(::named), "one failure, and the close is no drop")
      assertFalse(s.connection.isOpen.value)
      s.parts.maxBwFails = null
      does(s, Command.Disconnect(1), connect(2))
      assertEquals(listOf("ConnectFailed 1 OTHER", "Connected 2"), s.told.reports.map(::named))
      assertEquals(0, second.closes)
      assertEquals(1, first.closes, "closed once, not again by the next attempt")
    }

  private fun named(input: Input): String =
    when (input) {
      is Input.ConnectFailed -> "ConnectFailed ${input.attemptId} ${input.failure}"
      is Input.Connected -> "Connected ${input.attemptId}"
      is Input.Dropped -> "Dropped ${input.attemptId} ${input.reason}"
      else -> "$input"
    }
}
