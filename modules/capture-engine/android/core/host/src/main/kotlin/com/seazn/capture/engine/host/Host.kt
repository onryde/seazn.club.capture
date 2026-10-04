package com.seazn.capture.engine.host

import com.seazn.capture.engine.adapter.BridgeCore
import com.seazn.capture.engine.adapter.PrivateStore
import com.seazn.capture.engine.core.Clock
import com.seazn.capture.engine.core.Engine
import com.seazn.capture.engine.core.Input
import com.seazn.capture.engine.core.Pose
import com.seazn.capture.engine.core.Scheduler
import com.seazn.capture.engine.core.Side
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import org.json.JSONObject

/**
 * `Main`'s logic without stdin and stdout: the real core over [scheduler], a scripted phone that is
 * on a validated network and ready, held left, and a scripted server. The `ready` line is written
 * first, before any task is posted, so no snapshot can come before it.
 *
 * The phone's mic is read every [READINESS_MS], as the glue reads it (Task 33): sound is held (review
 * C4a I-1) and turns only at a reading 300 ms into its run, so it is ready from the second reading,
 * about 500 ms after the host starts. A `readiness` line's `audioPeak` sets the level read from then on.
 *
 * Task 27: a `script`, `readiness` or `quiet` line with a `seq` is acked once the host is quiet (PV28):
 * no answer in flight and nothing due on the core's scheduler. A numbered script waits first for its
 * path's next answer; a numbered readiness for two meter periods (review C4a N-3).
 */
class Host(private val scheduler: Scheduler, private val write: (String) -> Unit) {
  val server = ScriptedServer()
  private val platform = ScriptedPlatform(server, write)
  private val core = BridgeCore(SystemClock, scheduler, platform, MemoryStore(), "host", "JVM host", newId = { PHONE_ID }).also { platform.core = it }

  @Volatile private var level = 0.5

  /** Polls for quiet, off the core's thread, for the numbered lines waiting on it. */
  private val quiet = Executors.newSingleThreadScheduledExecutor { task -> Thread(task, "host-quiet").apply { isDaemon = true } }

  /** The numbered lines waiting for quiet, in the order they arrived; the quiet thread only. */
  private val waiting = ArrayDeque<Pair<Int, Long>>()

  init {
    write(Protocol.encode("ready", mapOf("current" to core.current(), "tail" to core.tail())))
    core.report(Input.Network(true))
    core.readiness(cameraFrames = true, audioPeak = level, pose = Pose.Held(Side.LEFT))
    meter()
    core.start()
  }

  /** One stdin line. False on `exit`; a line that does not parse, or names no op, goes to stderr and is skipped. */
  fun handle(line: String): Boolean {
    try {
      val json = JSONObject(line)
      when (val op = json.optString("op")) {
        "send" -> core.send(Protocol.toWire(json.getJSONObject("intent")) + ("seq" to json.getNumber("seq").toDouble()))
        "log" -> core.log(json.getString("level"), json.getString("kind"), json.optJSONObject("fields")?.let(Protocol::toWire).orEmpty())
        "script" -> {
          val path = json.getString("path")
          server.script(path, json.getInt("status"), json.getJSONObject("body"))
          seq(json)?.let { seq -> server.onAnswered(path) { whenQuiet(seq) } }
        }
        "readiness" -> {
          val peak = (json.opt("audioPeak") as? Number)?.toDouble()
          peak?.let { level = it }
          (json.opt("network") as? Boolean)?.let { core.report(Input.Network(it)) }
          core.readiness(cameraFrames = json.opt("camera") as? Boolean, audioPeak = peak, pose = json.optString("pose").takeIf { it.isNotEmpty() }?.let(::pose))
          seq(json)?.let { seq -> whenQuiet(seq, METER_SETTLE_MS) }
        }
        "quiet" -> whenQuiet(json.getInt("seq"))
        "exit" -> return false
        else -> System.err.println("host: no op '$op'")
      }
    } catch (failure: Exception) {
      System.err.println("host: skipped a line: $failure")
    }
    return true
  }

  fun shutdown() {
    quiet.shutdownNow()
    platform.shutdown()
  }

  private fun seq(json: JSONObject): Int? = (json.opt("seq") as? Number)?.toInt()

  /**
   * Acks [seq] once the host is quiet, and no sooner than [afterMs] from now: no answer in flight, and
   * nothing due on the core's scheduler, read so that work running between the two reads is seen (the
   * scheduler's finished count is read on both sides). A timer not yet due (the next beat) is never
   * waited for, so quiet always comes. Acks go out in the order their lines arrived.
   *
   * The ack is posted one [Engine.TICK_MS] on: the engine publishes for an input only when the state
   * changes, and anything else (a refusal, readiness while paired) on its next tick, which always
   * publishes. That tick is due no later than the ack and was posted before it, so its snapshot is
   * written first, and the kit reads the quiet engine's last word.
   */
  private fun whenQuiet(seq: Int, afterMs: Long = 0) {
    val probe = scheduler as? ExecutorScheduler ?: error("a numbered line needs the ExecutorScheduler")
    val notBefore = System.nanoTime() / 1_000_000 + afterMs
    quiet.execute {
      waiting.addLast(seq to notBefore)
      if (waiting.size == 1) poll(probe)
    }
  }

  private fun poll(probe: ExecutorScheduler) {
    val nowMs = System.nanoTime() / 1_000_000
    val finished = probe.completed()
    val isQuiet = server.inFlight == 0 && probe.dueNow() == 0 && probe.completed() == finished
    while (isQuiet && waiting.isNotEmpty() && waiting.first().second <= nowMs) {
      val seq = waiting.removeFirst().first
      scheduler.schedule(Engine.TICK_MS) { platform.acked(seq) }
    }
    if (waiting.isNotEmpty()) quiet.schedule({ poll(probe) }, QUIET_POLL_MS, TimeUnit.MILLISECONDS)
  }

  private fun meter() {
    scheduler.schedule(READINESS_MS) {
      core.readiness(audioPeak = level)
      meter()
    }
  }

  private fun pose(word: String): Pose =
    when (word) {
      "left" -> Pose.Held(Side.LEFT)
      "right" -> Pose.Held(Side.RIGHT)
      "not-held" -> Pose.NotHeld
      "no-sensor" -> Pose.NoSensor
      else -> throw IllegalArgumentException("no pose '$word'")
    }

  companion object {
    /** Made-up, within `capture-beat.v1`'s 16 to 64 characters (G2 would make a shorter one again). */
    const val PHONE_ID = "host-phone-0000001"

    /** The glue's cadence for the mic and camera readings (Task 33). */
    const val READINESS_MS = 500L

    /**
     * Review C4a N-3: a level is judged at the meter's next readings and sound is held for 300 ms, so a
     * readiness is acked no sooner than two meter periods on, with 100 ms for the meter's own lateness.
     */
    const val METER_SETTLE_MS = 2 * READINESS_MS + 100

    private const val QUIET_POLL_MS = 20L
  }
}

private object SystemClock : Clock {
  override fun monotonicMs(): Long = System.nanoTime() / 1_000_000

  override fun wallMs(): Long = System.currentTimeMillis()
}

/** The host's private store: memory, for one run. */
private class MemoryStore : PrivateStore {
  private val files = mutableMapOf<String, String>()

  override fun read(name: String): String? = files[name]

  override fun write(name: String, text: String) {
    files[name] = text
  }

  override fun delete(name: String) {
    files.remove(name)
  }
}
