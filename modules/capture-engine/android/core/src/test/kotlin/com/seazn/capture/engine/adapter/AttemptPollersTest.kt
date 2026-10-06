package com.seazn.capture.engine.adapter

import com.seazn.capture.engine.core.Cancellable
import com.seazn.capture.engine.core.Command
import com.seazn.capture.engine.core.Configs
import com.seazn.capture.engine.core.ConnectFailure
import com.seazn.capture.engine.core.DropReason
import com.seazn.capture.engine.core.EndReason
import com.seazn.capture.engine.core.Environment
import com.seazn.capture.engine.core.FakeClock
import com.seazn.capture.engine.core.FakeScheduler
import com.seazn.capture.engine.core.Input
import com.seazn.capture.engine.core.LinkCounters
import com.seazn.capture.engine.core.MachineRig
import com.seazn.capture.engine.core.RecordEntry
import com.seazn.capture.engine.core.Scheduler
import kotlin.test.Test
import kotlin.test.assertEquals

/**
 * Every run advances the fake scheduler by a fixed duration, never "until idle": a mutant that posts
 * again for ever, with a delay, then fails on its counts instead of hanging the suite (Task 13). One
 * that posts again with no delay still hangs it: `FakeScheduler.advanceBy` has no cap on tasks per call.
 */
class AttemptPollersTest {
  private val scheduler = FakeScheduler(FakeClock())
  private val sent = mutableListOf<Input>()
  private var video = 0L
  private val counters = LinkCounters(1_000, 10, 0, 0, 0, 40, 120, 3_000_000)
  private val pollers = AttemptPollers(scheduler, frames = { FrameCount(video, video) }, link = { counters }, send = { sent += it })
  private val rebuild = Command.Rebuild(1, Command.Connect(2, Configs.srt, 1_500_000, null))

  private fun frames() = sent.filterIsInstance<Input.Frames>()

  private fun links() = sent.filterIsInstance<Input.Link>()

  @Test
  fun `carry 16 one poller per attempt, however often it is begun`() {
    // P4: a second Connected 400 ms in. Kept, the first poller reads at 500 and 1000 (two frames,
    // one link). Restarted, the mutant reads once, at 900, and its first link would be at 1400.
    pollers.onInput(Input.Connected(1))
    scheduler.advanceBy(400)
    pollers.onInput(Input.Connected(1))
    scheduler.advanceBy(600)
    assertEquals(2, frames().size, "500 ms for 1 s, once")
    assertEquals(1, links().size, "1000 ms for 1 s, once")
  }

  @Test
  fun `carry 19 frames keep coming every 500 ms through a camera switch, and through every command that does not end the attempt`() {
    // Review 14, I2: what the machine sends while on air without ending the attempt. A poller stopped
    // by any of them lets the LIVE gate drop and the watchdog rebuild a healthy broadcast.
    val keeps =
      listOf(
        Command.SwitchCamera,
        Command.SetBitrate(1, 1_200_000),
        Command.SetMaxBw(1, 172_500),
        Command.Slate(true),
        Command.Slate(false),
        Command.ReopenCamera,
        Command.FetchPlaylist(1, Configs.PLAYBACK_URL),
        Command.PostHeartbeat(1, "https://stg.seazn.club/api/capture/codes/fx42hmnp7k2q/beat", Configs.TOKEN, "{}"),
        Command.FetchCode(1, "https://stg.seazn.club/api/capture/codes/fx42hmnp7k2q", Configs.TOKEN, Configs.PHONE_ID, 1, Environment.STAGING),
        Command.Record(RecordEntry("bitrate")),
      )
    var checked = 0
    for (command in keeps) {
      val own = FakeScheduler(FakeClock())
      val got = mutableListOf<Input>()
      val row = AttemptPollers(own, frames = { FrameCount(1, 1) }, link = { counters }, send = { got += it })
      row.onInput(Input.Connected(1))
      own.advanceBy(500)
      row.onCommand(command)
      own.advanceBy(3_000)
      assertEquals(7, got.filterIsInstance<Input.Frames>().size, "$command: every 500 ms from 500 to 3500")
      assertEquals(3, got.filterIsInstance<Input.Link>().size, "$command: every second from 1000 to 3000")
      assertEquals(1, row.running, "$command")
      checked += 1
    }
    assertEquals(10, checked, "every row ran")
  }

  @Test
  fun `a new attempt replaces the old one's pollers, and readings name their attempt`() {
    pollers.onInput(Input.Connected(1))
    pollers.onCommand(rebuild)
    pollers.onInput(Input.Connected(2))
    scheduler.advanceBy(1_000)
    assertEquals(setOf(2), frames().map { it.attemptId }.toSet())
  }

  @Test
  fun `a drop, a disconnect, a new session, the end and a stopped broadcast each stop the pollers`() {
    val stops =
      listOf<(AttemptPollers) -> Unit>(
        { it.onInput(Input.Dropped(1, DropReason.ENDPOINT_CLOSED, null)) },
        { it.onCommand(Command.Disconnect(1)) },
        { it.onCommand(Command.StartNewSession(1, Command.Connect(2, Configs.srt, 1_500_000, null))) },
        { it.onCommand(Command.End(EndReason.OPERATOR_STOPPED)) },
        // A broadcast that ends without the operator returns to Paired: its attempt is over too.
        { it.onCommand(Command.StopBroadcast) },
      )
    stops.forEachIndexed { row, stop ->
      sent.clear()
      pollers.onInput(Input.Connected(1))
      stop(pollers)
      scheduler.advanceBy(2_000)
      assertEquals(emptyList(), sent, "row $row: no frames and no link")
      assertEquals(null, pollers.running, "row $row")
    }
  }

  @Test
  fun `a drop of an older attempt does not stop the current one`() {
    pollers.onInput(Input.Connected(2))
    pollers.onInput(Input.Dropped(1, DropReason.ENDPOINT_CLOSED, null))
    scheduler.advanceBy(500)
    assertEquals(1, frames().size)
  }

  @Test
  fun `no reading sends nothing`() {
    val quiet = AttemptPollers(scheduler, frames = { null }, link = { null }, send = { sent += it })
    quiet.onInput(Input.Connected(1))
    scheduler.advanceBy(2_000)
    assertEquals(emptyList(), sent)
  }

  @Test
  fun `PV16 a rebuild stops the old attempt's pollers before the next attempt connects`() {
    pollers.onInput(Input.Connected(1))
    scheduler.advanceBy(500)
    pollers.onCommand(rebuild)
    scheduler.advanceBy(2_000)
    assertEquals(1, frames().size, "only the reading before the rebuild")
    assertEquals(0, links().size)
    assertEquals(null, pollers.running)
  }

  @Test
  fun `review 14 I1 a ConnectFailed after its Connected leaves the on-air attempt reading`() {
    // The machine ignores it once on air (Transports.connectFailed acts only in Connecting, Requested),
    // so the pollers do too: stopping here would starve a healthy broadcast into a watchdog rebuild.
    pollers.onInput(Input.Connected(1))
    pollers.onInput(Input.ConnectFailed(1, ConnectFailure.TIMEOUT, null))
    scheduler.advanceBy(1_000)
    assertEquals(listOf(1, 1), frames().map { it.attemptId })
    assertEquals(listOf(Input.Link(1, counters)), links())
    assertEquals(1, pollers.running)
  }

  @Test
  fun `review 14 I1 a ConnectFailed before its Connected stops nothing itself, and the machine's Disconnect ends the poller a late Connected began`() {
    // The real machine, wired in the plan's order (plan:9268, plan:9393): the pollers see each input
    // first, then every command the machine answers it with.
    val rig = MachineRig().armed()
    fun report(input: Input) {
      pollers.onInput(input)
      val from = rig.commands.size
      rig.send(input)
      rig.commands.drop(from).forEach(pollers::onCommand)
    }
    val from = rig.commands.size
    rig.ready()
    rig.commands.drop(from).forEach(pollers::onCommand)
    assertEquals(listOf(1), rig.connects().map { it.attemptId }, "ready, Armed asked for attempt 1")
    report(Input.ConnectFailed(1, ConnectFailure.TIMEOUT, null))
    assertEquals(null, rig.attempt, "the machine acted on it: a retry is waiting")
    assertEquals(null, pollers.running)
    report(Input.Connected(1))
    assertEquals(listOf(Command.Disconnect(1)), rig.sent<Command.Disconnect>(), "the machine closed the stale attempt")
    assertEquals(null, pollers.running, "the machine's Disconnect ended the poller the late Connected began")
    scheduler.advanceBy(2_000)
    assertEquals(emptyList(), sent)
  }

  @Test
  fun `a connect failure of an older attempt does not stop the current one`() {
    pollers.onInput(Input.Connected(2))
    pollers.onInput(Input.ConnectFailed(1, ConnectFailure.TIMEOUT, null))
    scheduler.advanceBy(500)
    assertEquals(1, frames().size)
    assertEquals(2, pollers.running)
  }

  @Test
  fun `a newer attempt's Connected while the old poller is still scheduled replaces it, with no command between`() {
    pollers.onInput(Input.Connected(1))
    scheduler.advanceBy(400)
    pollers.onInput(Input.Connected(2))
    scheduler.advanceBy(1_000)
    // Attempt 1's first reading was due at 500: it never comes. Attempt 2 reads at 900 and 1400.
    assertEquals(listOf(2, 2), frames().map { it.attemptId })
    assertEquals(listOf(Input.Link(2, counters)), links())
  }

  @Test
  fun `an older attempt's late Connected does not replace the current one`() {
    pollers.onInput(Input.Connected(2))
    pollers.onInput(Input.Connected(1))
    scheduler.advanceBy(1_000)
    assertEquals(listOf(2, 2), frames().map { it.attemptId })
    assertEquals(2, pollers.running)
  }

  @Test
  fun `the Disconnect the machine answers a stale Connected with leaves the current attempt reading`() {
    // SessionMachine's stale-connected answer: a Connected for an attempt it no longer wants is closed
    // with a Disconnect naming that attempt, while the current one stays on air.
    pollers.onInput(Input.Connected(2))
    pollers.onInput(Input.Connected(1))
    pollers.onCommand(Command.Disconnect(1))
    scheduler.advanceBy(1_000)
    assertEquals(listOf(2, 2), frames().map { it.attemptId })
    assertEquals(listOf(Input.Link(2, counters)), links())
    assertEquals(2, pollers.running)
  }

  @Test
  fun `a null reading skips its tick and the poller keeps reading, video and audio in their own places`() {
    var reading: FrameCount? = null
    var linkReading: LinkCounters? = null
    val gappy = AttemptPollers(scheduler, frames = { reading }, link = { linkReading }, send = { sent += it })
    gappy.onInput(Input.Connected(1))
    scheduler.advanceBy(1_000)
    assertEquals(emptyList(), sent, "two frames reads and one link read, all null")
    reading = FrameCount(video = 30, audio = 47)
    linkReading = counters
    scheduler.advanceBy(1_000)
    assertEquals(listOf(Input.Frames(1, 30, 47), Input.Frames(1, 30, 47)), frames())
    assertEquals(listOf(Input.Link(1, counters)), links())
  }

  @Test
  fun `a supplier that throws is left to the guarded scheduler, and both pollers keep ticking`() {
    val failures = mutableListOf<Throwable>()
    val guarded = GuardedScheduler(scheduler) { failures += it }
    var reads = 0
    val flaky =
      AttemptPollers(
        guarded,
        frames = {
          reads += 1
          if (reads == 1) throw IllegalStateException("frames") else FrameCount(reads.toLong(), 0)
        },
        link = { throw IllegalStateException("link") },
        send = { sent += it },
      )
    flaky.onInput(Input.Connected(1))
    scheduler.advanceBy(2_000)
    assertEquals(3, frames().size, "the reads at 1000, 1500 and 2000; the throw at 500 sent nothing")
    assertEquals(1, failures.count { it.message == "frames" })
    assertEquals(2, failures.count { it.message == "link" }, "the link read threw at 1000 and again at 2000")
    assertEquals(3, guarded.caught)
    assertEquals(1, flaky.running)
  }

  @Test
  fun `a stop from inside a reading leaves nothing scheduled`() {
    lateinit var reentrant: AttemptPollers
    reentrant =
      AttemptPollers(
        scheduler,
        frames = { FrameCount(1, 1) },
        link = { counters },
        send = {
          sent += it
          reentrant.onInput(Input.Dropped(1, DropReason.ENDPOINT_CLOSED, null))
        },
      )
    reentrant.onInput(Input.Connected(1))
    scheduler.advanceBy(500)
    assertEquals(null, reentrant.running)
    assertEquals(0, scheduler.pending, "the reading that stopped its poller posted no next one")
    scheduler.advanceBy(2_000)
    assertEquals(1, frames().size)
    assertEquals(0, links().size)
  }

  @Test
  fun `a stopped poller whose task the scheduler cannot take back reads nothing when it runs`() {
    // A cancel that is too late to unschedule: the task still runs, and must find itself stopped.
    val late =
      object : Scheduler {
        override fun schedule(delayMs: Long, task: () -> Unit): Cancellable {
          scheduler.schedule(delayMs, task)
          return Cancellable {}
        }
      }
    var reads = 0
    val stale =
      AttemptPollers(
        late,
        frames = {
          reads += 1
          FrameCount(1, 1)
        },
        link = {
          reads += 1
          counters
        },
        send = { sent += it },
      )
    stale.onInput(Input.Connected(1))
    stale.onInput(Input.Dropped(1, DropReason.ENDPOINT_CLOSED, null))
    scheduler.advanceBy(2_000)
    assertEquals(0, reads)
    assertEquals(emptyList(), sent)
    assertEquals(0, scheduler.pending)
  }
}
