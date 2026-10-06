package com.seazn.capture.engine.net

import com.seazn.capture.engine.adapter.AttemptSignals
import com.seazn.capture.engine.adapter.CameraAvailability
import com.seazn.capture.engine.adapter.SrtOptions
import com.seazn.capture.engine.capture.run.CaptureParts
import com.seazn.capture.engine.capture.run.CaptureRun
import com.seazn.capture.engine.capture.run.FakeParts
import com.seazn.capture.engine.capture.run.Told
import com.seazn.capture.engine.capture.run.queueScope
import com.seazn.capture.engine.core.Command
import com.seazn.capture.engine.core.Configs
import com.seazn.capture.engine.core.ConnectFailure
import com.seazn.capture.engine.core.Input
import com.seazn.capture.engine.core.RtmpsTarget
import com.seazn.capture.engine.core.SessionMachine
import com.seazn.capture.engine.core.Side
import java.net.InetAddress
import java.net.UnknownHostException
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.locks.LockSupport
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.advanceTimeBy
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.withTimeoutOrNull
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertFalse
import kotlin.test.assertIs
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertSame
import kotlin.test.assertTrue

/**
 * The glue's one DNS lookup (C6 I-1, and the re-review's RTMPS lookup before komuxer's), on real threads:
 * the lookup blocks one, as the platform's does, and the bound is CaptureRun's `withTimeoutOrNull`.
 */
@OptIn(ExperimentalCoroutinesApi::class) // advanceUntilIdle
class HostLookupTest {
  private val loopback = InetAddress.getLoopbackAddress()

  /** The fixture's RTMPS ingest host, as `Configs.rtmps` spells it. */
  private val rtmpsHost = Configs.INGEST_HOST

  private fun bounded(lookup: HostLookup): Pair<InetAddress?, Long> =
    runBlocking {
      val began = System.nanoTime()
      val resolved = withTimeoutOrNull(BOUND_MS) { lookup.resolve("ingest.example") }
      resolved to (System.nanoTime() - began) / 1_000_000
    }

  /** Android's resolver (getaddrinfo) ignores an interrupt: this one waits it out, until [answered] or [capMs]. */
  private fun stuck(answered: CountDownLatch, asked: MutableList<String>, capMs: Long = 3_000, entered: CountDownLatch = CountDownLatch(1)) =
    HostLookup { host ->
      synchronized(asked) { asked += host }
      entered.countDown()
      val until = System.nanoTime() + TimeUnit.MILLISECONDS.toNanos(capMs)
      while (answered.count > 0 && System.nanoTime() < until) LockSupport.parkNanos(TimeUnit.MILLISECONDS.toNanos(10))
      loopback
    }

  // --- C6 I-1: the lookup is inside the start's bound (CaptureRun.START_BOUND_MS) ---

  @Test
  fun `C6 I-1 a lookup that ignores an interrupt never holds the connect past its bound`() {
    val answered = CountDownLatch(1)
    val (resolved, tookMs) = bounded(stuck(answered, mutableListOf()))
    answered.countDown()
    assertNull(resolved, "the bound ended the connect")
    assertTrue(tookMs < 1_000, "the bound ended the wait at $tookMs ms, not the lookup's own end")
  }

  @Test
  fun `C6 I-1 a lookup that honours an interrupt is interrupted once the bound ends`() {
    val interrupted = CountDownLatch(1)
    val lookup =
      HostLookup {
        try {
          Thread.sleep(10_000)
        } catch (e: InterruptedException) {
          interrupted.countDown()
          throw e
        }
        loopback
      }
    assertNull(bounded(lookup).first)
    assertTrue(interrupted.await(2, TimeUnit.SECONDS), "the lookup's thread was interrupted")
  }

  /** The second call, and the empty case's sibling: a lookup that answers, then one that fails, each the connect's own. */
  @Test
  fun `C6 I-1 a lookup's answer is the connect's, and an unknown host stays UNRESOLVED`() {
    val asked = mutableListOf<String>()
    val lookup =
      HostLookup { host ->
        synchronized(asked) { asked += host }
        if (host == "nowhere.example") throw UnknownHostException(host) else loopback
      }
    assertSame(loopback, bounded(lookup).first)
    val failed = assertFailsWith<UnknownHostException> { runBlocking { lookup.resolve("nowhere.example") } }
    assertEquals(ConnectFailure.UNRESOLVED, SrtOptions.failure(failed), "F-P5-1: an unresolved host never counts toward the fallback")
    assertEquals(listOf("ingest.example", "nowhere.example"), synchronized(asked) { asked.toList() })
  }

  // --- C6 re-review: RTMPS looks its host up first, inside the start's bound, before komuxer's own lookup ---

  /** StreamerAdapter's RTMPS start, as far as the order goes: [HostLookup.warm], then the vendor's connect (the fake's start). */
  private class WarmingParts(private val fake: FakeParts, private val lookup: HostLookup) : CaptureParts by fake {
    override suspend fun start(connect: Command.Connect): Boolean {
      (connect.target as? RtmpsTarget)?.let { lookup.warm(it.url) }
      return fake.start(connect)
    }
  }

  private class Scene(val parts: FakeParts, val told: Told, val run: CaptureRun)

  private fun TestScope.opened(lookup: HostLookup): Scene {
    val parts = FakeParts()
    val told = Told()
    val run = CaptureRun(WarmingParts(parts, lookup), AttemptSignals(), CameraAvailability(), told.calls(), { Side.LEFT }, queueScope())
    run.open(Configs.pairRequest())
    advanceUntilIdle()
    parts.log.clear()
    return Scene(parts, told, run)
  }

  /**
   * A lookup answers on its own IO thread, which the virtual clock never waits for: left to advanceUntilIdle,
   * the bound would fire first. Steps the clock 1 ms at a time, waiting real time for each tick, until [done].
   */
  private fun TestScope.settle(done: () -> Boolean) {
    var ticks = 0
    while (!done()) {
      assertTrue(ticks++ < 2_000, "not settled by ${testScheduler.currentTime} ms, inside the ${CaptureRun.START_BOUND_MS} ms bound")
      Thread.sleep(1)
      advanceTimeBy(1)
      runCurrent()
    }
    advanceUntilIdle()
  }

  private fun rtmps(id: Int) = Command.Connect(id, Configs.rtmps, startBitrateBps = 3_000_000, maxBwBytesPerSecond = null)

  @Test
  fun `C6 re-review an RTMPS lookup that never returns lets the start's bound fire, never reaches komuxer, and a close queued behind it goes through`() {
    val answered = CountDownLatch(1)
    val asked = mutableListOf<String>()
    // Capped past the test's own life only so a mutant that blocks on it still ends; the bound fires in virtual time.
    val entered = CountDownLatch(1)
    val lookup = stuck(answered, asked, capMs = 5_000, entered = entered)
    try {
      runTest {
        val s = opened(lookup)
        var releasedAt: Long? = null
        s.parts.stopped = { if (s.parts.log.lastOrNull() == "release done") releasedAt = testScheduler.currentTime }
        s.run.execute(rtmps(1))
        s.run.close()
        // Step virtual time until the lookup is in flight on its own thread, far inside the bound: the bound must
        // end a lookup that has begun, not one cancelled before its thread ran it.
        while (!entered.await(50, TimeUnit.MILLISECONDS)) {
          assertTrue(testScheduler.currentTime < SessionMachine.CONNECT_TIMEOUT_MS / 2, "the lookup never began")
          advanceTimeBy(10)
          runCurrent()
        }
        advanceUntilIdle()
        assertEquals(listOf(rtmpsHost), synchronized(asked) { asked.toList() }, "the RTMPS ingest's host was looked up")
        assertFalse("start 1" in s.parts.log, "komuxer's connect, and its own blocking lookup, never ran: ${s.parts.log}")
        assertTrue("release done" in s.parts.log, "the close queued behind the hung lookup ran: ${s.parts.log}")
        assertFalse(s.parts.held, "the camera is released")
        val at = assertNotNull(releasedAt)
        assertTrue(at <= SessionMachine.CONNECT_TIMEOUT_MS, "released at $at ms, past the machine's ${SessionMachine.CONNECT_TIMEOUT_MS} ms")
        val failed = s.told.reports.single()
        assertIs<Input.ConnectFailed>(failed)
        assertEquals(1, failed.attemptId)
        assertEquals(ConnectFailure.TIMEOUT, failed.failure)
      }
    } finally {
      answered.countDown()
    }
  }

  /** The positive pair and the second call: a lookup that answers lets komuxer connect, then one that fails stops it UNRESOLVED. */
  @Test
  fun `C6 re-review an RTMPS lookup that answers lets komuxer connect, and an unknown host fails UNRESOLVED before it`() =
    runTest {
      val asked = mutableListOf<String>()
      var resolves = true
      val s = opened(HostLookup { host -> synchronized(asked) { asked += host }; if (resolves) loopback else throw UnknownHostException(host) })
      s.run.execute(rtmps(1))
      settle { s.told.reports.isNotEmpty() }
      assertEquals(listOf<Input>(Input.Connected(1)), s.told.reports)
      assertEquals(listOf("before 1", "start 1", "start done"), s.parts.log)
      resolves = false
      s.parts.log.clear()
      s.run.execute(Command.Disconnect(1))
      s.run.execute(rtmps(2))
      settle { s.told.reports.size > 1 }
      val failed = s.told.reports.filterIsInstance<Input.ConnectFailed>().single()
      assertEquals(2, failed.attemptId)
      assertEquals(ConnectFailure.UNRESOLVED, failed.failure, "F-P5-1: never counted towards the fallback")
      assertFalse("start 2" in s.parts.log, "komuxer is never called for a host that did not resolve: ${s.parts.log}")
      assertEquals(listOf(rtmpsHost, rtmpsHost), synchronized(asked) { asked.toList() })
    }

  /** The empty case: a URL with no host to read looks nothing up and throws nothing, so the ingest URL reaches no error text. */
  @Test
  fun `C6 re-review an RTMPS URL with no host looks nothing up and never throws`() {
    val asked = mutableListOf<String>()
    val lookup = HostLookup { host -> synchronized(asked) { asked += host }; loopback }
    val hostless = listOf("rtmps:///live/", "not a url at all", "", "rtmps://%zz/live/")
    for (url in hostless) {
      assertNull(HostLookup.hostOf(url), url)
      runBlocking { lookup.warm(url) }
    }
    assertEquals(4, hostless.size, "checked ${hostless.size} hostless URLs")
    assertEquals(emptyList(), synchronized(asked) { asked.toList() })
    assertEquals(rtmpsHost, HostLookup.hostOf(Configs.rtmps.url), "the positive pair")
  }

  private companion object {
    /** Far under the 3 s the stuck lookup holds out for, and over a quick lookup's few milliseconds. */
    const val BOUND_MS = 200L
  }
}
