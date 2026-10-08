package com.seazn.capture.engine.host

import com.seazn.capture.engine.adapter.BridgeCore
import com.seazn.capture.engine.adapter.PrivateStore
import com.seazn.capture.engine.core.Clock
import com.seazn.capture.engine.core.Input
import com.seazn.capture.engine.core.Pose
import com.seazn.capture.engine.core.Scheduler
import com.seazn.capture.engine.core.Side
import org.json.JSONObject

/**
 * `Main`'s logic without stdin and stdout: the real core over [scheduler], a scripted phone that is
 * on a validated network and ready, held left, and a scripted server. The `ready` line is written
 * first, before any task is posted, so no snapshot can come before it.
 *
 * The phone's mic is read every [READINESS_MS], as the glue reads it (Task 33). Sound is the mic's
 * availability, never its level (spec §4): it is ready at the host's first reading, whatever the level,
 * and the meter reads on, so it stays ready. A `readiness` line's `micSilenced` is the contract's only
 * way to make it not ready: the system's word that a call took the mic (F-P5-8), and its `false` gives
 * it back. A `readiness` line's `audioPeak` sets the level read from then on.
 *
 * Spec §10: a `scoringLink` line (`{"op":"scoringLink","call":N}`) is the module's `scoringLink` call, through the same core
 * call, and its answer is one `scoringLink` event naming the call (`Protocol.scoringLink`): the only line that carries the link.
 *
 * Task 27: a `script`, `readiness` or `quiet` line with a `seq` is acked once the host is quiet (PV28):
 * no answer in flight and nothing due on the core's scheduler. A numbered script waits first for its
 * path's next answer; a numbered readiness for two meter periods (review C4a N-3).
 */
class Host(private val scheduler: Scheduler, private val write: (String) -> Unit) {
  val server = ScriptedServer()
  private val platform = ScriptedPlatform(server, write)
  private val core =
    BridgeCore(SystemClock, scheduler, platform, MemoryStore(), "host", "JVM host", newId = { PHONE_ID })
      .also { platform.core = it }

  @Volatile private var level = 0.5

  /** The numbered lines waiting for quiet, in the order they arrived, with when each may be acked. Core thread only. */
  private val waiting = ArrayDeque<Pair<Int, Long>>()

  /** Set by [shutdown]: the quiet check posts itself no more. */
  @Volatile private var closed = false

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
        // §10: the module's scoringLink call, through the same core call; the answer is one event naming the call.
        "scoringLink" -> {
          val call = json.getInt("call")
          core.scoringLink { answer -> write(Protocol.scoringLink(call, answer)) }
        }
        "script" -> {
          val path = json.getString("path")
          server.script(path, json.getInt("status"), json.getJSONObject("body"))
          seq(json)?.let { seq -> server.onAnswered(path) { whenQuiet(seq) } }
        }
        "readiness" -> {
          val peak = (json.opt("audioPeak") as? Number)?.toDouble()
          peak?.let { level = it }
          (json.opt("network") as? Boolean)?.let { core.report(Input.Network(it)) }
          (json.opt("micSilenced") as? Boolean)?.let { core.report(Input.MicSilenced(it)) }
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
    closed = true
    platform.shutdown()
  }

  private fun seq(json: JSONObject): Int? = (json.opt("seq") as? Number)?.toInt()

  /**
   * Acks [seq] once the host is quiet, and no sooner than [afterMs] from now: no answer in flight, and
   * nothing due on the core's scheduler ([check]). A timer not yet due (the next beat) is never waited
   * for, so quiet always comes. Acks go out in the order their lines arrived.
   *
   * The ack is written by the check itself, on the core's thread, after every snapshot already written:
   * the engine publishes each input's own field changes with it (review C4c I-1), a refusal or readiness
   * while paired included, so the kit reads the quiet engine's last word without waiting for a tick.
   */
  private fun whenQuiet(seq: Int, afterMs: Long = 0) {
    val probe = scheduler as? ExecutorScheduler ?: error("a numbered line needs the ExecutorScheduler")
    val notBefore = SystemClock.monotonicMs() + afterMs
    scheduler.schedule(0) {
      waiting.addLast(seq to notBefore)
      if (waiting.size == 1) check(probe)
    }
  }

  /**
   * The quiet check, a marker task on the core's own thread, as [ExecutorScheduler.drain]'s is (review
   * C4c M-2): while it runs no other core task can, so none can be between the queue and running. The
   * answers in flight are read first: an answer is handed to the core, which posts its input, before it
   * leaves flight, and a request is taken only on this thread. Then nothing may be due but the check.
   */
  private fun check(probe: ExecutorScheduler) {
    if (closed) return
    val nowMs = SystemClock.monotonicMs()
    val isQuiet = server.inFlight == 0 && probe.dueNow() == ONLY_THE_CHECK
    while (isQuiet && waiting.isNotEmpty() && waiting.first().second <= nowMs) platform.acked(waiting.removeFirst().first)
    if (waiting.isNotEmpty()) scheduler.schedule(QUIET_POLL_MS) { check(probe) }
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
     * Review C4a N-3: a level is judged at the meter's next reading, so a readiness is acked no sooner than
     * two meter periods on, with 100 ms for the meter's own lateness.
     */
    const val METER_SETTLE_MS = 2 * READINESS_MS + 100

    private const val QUIET_POLL_MS = 20L

    /** [ExecutorScheduler.dueNow] while the quiet check runs: the check itself. */
    private const val ONLY_THE_CHECK = 1
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
