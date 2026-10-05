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
import com.seazn.capture.engine.core.RecordEntry
import com.seazn.capture.engine.core.Side
import java.net.InetSocketAddress
import java.net.SocketException
import java.net.SocketTimeoutException
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertFalse
import kotlin.test.assertIs
import kotlin.test.assertNull
import kotlin.test.assertSame
import kotlin.test.assertTrue

/**
 * Our SRT sink's connect and end (C6 I-2) on the JVM, driven by the capture's own rules ([CaptureRun])
 * with the one [AttemptSignals] both share, as `StreamerAdapter` builds them. The socket is a fake of
 * srtdroid 1.10.1's that ends as srtdroid's does (javap, [SrtSocketPort.connect]): a connect that fails
 * completes the socket's context with the failure, then rethrows it. Its sends (StreamPack#302, C7u) are
 * srtdroid 1.10.1's `trySend`, which never touches the socket's context (javap): each test's lambda
 * answers as `handleTrySendResult` does.
 */
@OptIn(ExperimentalCoroutinesApi::class) // advanceUntilIdle
class SrtConnectionTest {
  /** libsrt's text for SRT_ECONNREJ, which srtdroid throws as a `SocketException` (javap: `executeEpoll`). */
  private val refused = "Connection setup failure: connection rejected"

  /** srtdroid's own text for a socket that broke once connected (javap: `executeEpoll`). */
  private val broken = "Connection was broken"

  private fun connect(id: Int) = Command.Connect(id, Configs.srt, startBitrateBps = 3_000_000, maxBwBytesPerSecond = 1_000_000)

  /** srtdroid 1.10.1's socket, as far as the order goes. Its context is a real Job, so a listener on an ended socket runs at once. */
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

    /** Runs inside close, after the native close and before the context completes: a writer thread's send lands here. */
    var whileClosing: (() -> Unit)? = null

    override fun close() {
      closes += 1
      whileClosing?.invoke()
      context.complete() // srtdroid 1.10.1: close() completes the socket's context
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
      connection.closed { socket?.close() }
      socket = null
      fake.stop()
    }

    override suspend fun endpointClosed() {
      connection.isOpen.first { !it }
    }
  }

  private class Scene(val run: CaptureRun, val told: Told, val connection: SrtConnection, val parts: SinkParts) {
    /** The connection's monotonic clock, moved by hand. */
    var nowMs = 0L
  }

  private fun TestScope.scene(vararg sockets: FakeSocket): Scene {
    val signals = AttemptSignals()
    val told = Told()
    val calls = told.calls()
    lateinit var scene: Scene
    val connection = SrtConnection(signals, calls.report, calls.line) { scene.nowMs }
    val parts = SinkParts(FakeParts(), connection, ArrayDeque(sockets.toList()))
    val run = CaptureRun(parts, signals, CameraAvailability(), calls, { Side.LEFT }, queueScope())
    scene = Scene(run, told, connection, parts)
    run.open(Configs.pairRequest())
    advanceUntilIdle()
    return scene
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

  // --- C7u, StreamPack#302: the sink sends with srtdroid 1.10.1's non-blocking trySend ---

  /** srtdroid 1.10.1's `trySend` answer for a full send buffer (javap, `handleTrySendResult`: EASYNCSND returns -1). */
  private val wouldBlock = -1

  /** libsrt's text for SRT_EASYNCSND never reaches us: trySend answers it with -1. A packet's payload, as the sink writes it. */
  private val payload = 1316

  /** `send` is no suspend function: this helper compiles only while it is not, so a send can never wait on the uplink. */
  private fun sendNow(connection: SrtConnection, answer: () -> Int): Int = connection.send(answer)

  private fun dropLines(s: Scene) = s.told.lines.filter { it.kind == "srt-send-dropped" }

  private fun dropLine(attempt: Int, count: Int) = RecordEntry("srt-send-dropped", listOf("attempt" to attempt, "count" to count))

  @Test
  fun `302 a send that would block never waits, ends nothing, and is counted and recorded at once`() =
    runTest {
      val socket = FakeSocket()
      val s = scene(socket)
      does(s, connect(1))
      assertEquals(payload, sendNow(s.connection) { payload }, "a packet sent passes its byte count on")
      assertEquals(0L, s.connection.sendDropped, "a packet sent is no drop")
      assertEquals(wouldBlock, sendNow(s.connection) { wouldBlock }, "the sink answers StreamPack as its own SrtSink does")
      advanceUntilIdle()
      assertEquals(listOf("Connected 1"), s.told.reports.map(::named), "no drop and no failure: the attempt lives")
      assertTrue(s.connection.isOpen.value)
      assertNull(s.connection.ended)
      assertEquals(1L, s.connection.sendDropped)
      assertEquals(listOf(dropLine(1, 1)), dropLines(s), "the first of an attempt is written at once")
      assertEquals(0, socket.closes)
    }

  @Test
  fun `302 would-block lines are one per window, each with the count held back, and the attempt's end writes the rest`() =
    runTest {
      val s = scene(FakeSocket())
      does(s, connect(1))
      sendNow(s.connection) { wouldBlock }
      repeat(3) { sendNow(s.connection) { wouldBlock } }
      s.nowMs = SrtConnection.DROP_LINE_EVERY_MS - 1
      sendNow(s.connection) { wouldBlock }
      assertEquals(listOf(dropLine(1, 1)), dropLines(s), "nothing more inside the window")
      s.nowMs = SrtConnection.DROP_LINE_EVERY_MS
      sendNow(s.connection) { wouldBlock }
      assertEquals(listOf(dropLine(1, 1), dropLine(1, 5)), dropLines(s), "the window's end writes the four held back and this one")
      s.nowMs += 1
      repeat(2) { sendNow(s.connection) { wouldBlock } }
      assertEquals(8L, s.connection.sendDropped, "the counter counts every one, written or held")
      does(s, Command.Disconnect(1))
      assertEquals(listOf(dropLine(1, 1), dropLine(1, 5), dropLine(1, 2)), dropLines(s), "the close writes the two held back")
      assertEquals(listOf("Connected 1", "Dropped 1 REQUESTED"), s.told.reports.map(::named))
      assertEquals(8, dropLines(s).sumOf { it.fields.toMap()["count"] as Int }, "the lines add up to the counter")
    }

  @Test
  fun `302 the count and its lines restart with each attempt, and an end with nothing held writes nothing`() =
    runTest {
      val first = FakeSocket()
      val second = FakeSocket()
      val s = scene(first, second, FakeSocket())
      does(s, connect(1))
      does(s, Command.Disconnect(1))
      assertEquals(emptyList(), dropLines(s), "an attempt with no drops writes no line")
      does(s, connect(2))
      sendNow(s.connection) { wouldBlock }
      sendNow(s.connection) { wouldBlock }
      first.farEndCloses(SocketException(broken)) // the old socket, long closed: changes nothing
      second.farEndCloses(SocketException(broken))
      advanceUntilIdle()
      assertEquals(listOf(dropLine(2, 1), dropLine(2, 1)), dropLines(s), "the far end's cut writes the one held back")
      does(s, connect(3))
      assertEquals(0L, s.connection.sendDropped, "a new attempt starts at none")
      sendNow(s.connection) { wouldBlock }
      assertEquals(dropLine(3, 1), dropLines(s).last(), "written at once, though attempt 2's line was inside the window")
      assertEquals(listOf(dropLine(2, 1), dropLine(2, 1), dropLine(3, 1)), dropLines(s))
    }

  /**
   * A close that throws never completes the socket's context, so no end writes the drops held back: the
   * close writes them itself (srtdroid's `close` can throw libsrt's error; made-up text here).
   */
  @Test
  fun `302 a close that throws still writes the drops held back, and shows the endpoint closed`() =
    runTest {
      val s = scene(FakeSocket())
      does(s, connect(1))
      repeat(3) { sendNow(s.connection) { wouldBlock } }
      assertFailsWith<SocketException> { s.connection.closed { throw SocketException("Operation not supported: Invalid socket ID") } }
      assertEquals(listOf(dropLine(1, 1), dropLine(1, 2)), dropLines(s))
      assertFalse(s.connection.isOpen.value)
      assertEquals(listOf("Connected 1"), s.told.reports.map(::named), "a close is no drop until the socket ends")
    }

  /** Both of srtdroid's answers for a socket that is over (javap, `handleTrySendResult`): libsrt's text, and a 0 as ESCLOSED. */
  private val overs: List<() -> Exception> = listOf({ SocketException(broken) }, { SocketTimeoutException("ESCLOSED") })

  @Test
  fun `302 a send on a socket that broke is that attempt's one drop, named, and rethrown, before the socket's own end`() =
    runTest {
      for (over in overs) {
        val socket = FakeSocket()
        val s = scene(socket)
        does(s, connect(1))
        val failure = over()
        assertSame(failure, assertFailsWith<Exception> { sendNow(s.connection) { throw failure } }, "rethrown: the sink throws ClosedException with it")
        advanceUntilIdle()
        assertEquals(listOf("Connected 1", "Dropped 1 ENDPOINT_CLOSED"), s.told.reports.map(::named), "$failure")
        assertEquals(failure.message, (s.told.reports.last() as Input.Dropped).message?.substringAfterLast(": "), "the drop names it")
        assertFalse(s.connection.isOpen.value)
        assertSame(failure, s.connection.ended, "the next write fails with it, before any send")
        socket.farEndCloses(SocketException("later")) // the socket's own end, after: no second drop
        does(s, Command.Disconnect(1))
        assertEquals(2, s.told.reports.size, "${s.told.reports}")
        assertSame(failure, s.connection.ended, "the first end's cause stays")
        assertEquals(0L, s.connection.sendDropped, "a broken socket is no would-block")
      }
    }

  @Test
  fun `302 a socket that ended first reports its own drop, and a send failing after it adds none`() =
    runTest {
      val socket = FakeSocket()
      val s = scene(socket)
      does(s, connect(1))
      socket.farEndCloses(SocketException(broken))
      advanceUntilIdle()
      assertFailsWith<SocketException> { sendNow(s.connection) { throw SocketException("Operation not supported: Invalid socket ID") } }
      advanceUntilIdle()
      assertEquals(listOf("Connected 1", "Dropped 1 ENDPOINT_CLOSED"), s.told.reports.map(::named))
      assertEquals(broken, (s.connection.ended as SocketException).message, "the socket's end named it first")
    }

  /** A writer thread's send landing on the socket the sink is closing: libsrt's text is made up. */
  @Test
  fun `302 a send failing on the socket the sink is closing is the requested drop, never a cut`() =
    runTest {
      val socket = FakeSocket()
      val s = scene(socket)
      does(s, connect(1))
      var thrown: Throwable? = null
      socket.whileClosing = { thrown = runCatching { sendNow(s.connection) { throw SocketException("Operation not supported: Invalid socket ID") } }.exceptionOrNull() }
      does(s, Command.Disconnect(1))
      assertIs<SocketException>(thrown, "still rethrown: the sink throws ClosedException")
      assertEquals(listOf("Connected 1", "Dropped 1 REQUESTED"), s.told.reports.map(::named))
      assertEquals(1, socket.closes)
    }

  /** The next attempt's sends are no longer the closed one's: the close's mark ends with the next connect. */
  @Test
  fun `302 after a requested close the next attempt's broken send is its cut`() =
    runTest {
      val first = FakeSocket()
      val second = FakeSocket()
      val s = scene(first, second)
      does(s, connect(1), Command.Disconnect(1), connect(2))
      assertFailsWith<SocketException> { sendNow(s.connection) { throw SocketException(broken) } }
      advanceUntilIdle()
      assertEquals(listOf("Connected 1", "Dropped 1 REQUESTED", "Connected 2", "Dropped 2 ENDPOINT_CLOSED"), s.told.reports.map(::named))
    }

  /** srtdroid 1.10.1 answers bytes, -1, or a throw (javap): any other number is no answer we know, and ends the attempt. */
  @Test
  fun `302 a send answer srtdroid never gives is refused by name and ends the attempt`() =
    runTest {
      for (strange in listOf(0, -2)) {
        val s = scene(FakeSocket())
        does(s, connect(1))
        val refused = assertFailsWith<IllegalStateException> { sendNow(s.connection) { strange } }
        assertEquals("srtdroid's trySend answered $strange", refused.message)
        advanceUntilIdle()
        assertEquals(listOf("Connected 1", "Dropped 1 ENDPOINT_CLOSED"), s.told.reports.map(::named), "answer $strange")
        assertEquals(0L, s.connection.sendDropped)
      }
    }

  /**
   * The sink sends only while it holds a socket; a send with no attempt connected is refused by name, and
   * reports nothing: before any connect, and after a refused one, though the attempt before it connected.
   */
  @Test
  fun `302 a send with no attempt connected is refused and reports nothing`() =
    runTest {
      val s = scene(FakeSocket(), FakeSocket(SocketException(refused)))
      val none = assertFailsWith<IllegalStateException> { sendNow(s.connection) { payload } }
      assertEquals("an SRT send with no attempt connected", none.message)
      does(s, connect(1))
      assertEquals(payload, sendNow(s.connection) { payload })
      does(s, Command.Disconnect(1), connect(2))
      assertFailsWith<IllegalStateException> { sendNow(s.connection) { payload } }
      assertEquals(listOf("Connected 1", "Dropped 1 REQUESTED", "ConnectFailed 2 REFUSED"), s.told.reports.map(::named), "a refused connect holds no attempt to send on")
    }

  private fun named(input: Input): String =
    when (input) {
      is Input.ConnectFailed -> "ConnectFailed ${input.attemptId} ${input.failure}"
      is Input.Connected -> "Connected ${input.attemptId}"
      is Input.Dropped -> "Dropped ${input.attemptId} ${input.reason}"
      else -> "$input"
    }
}
