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
 * The phone's mic is read every [READINESS_MS], as the glue reads it (Task 33): sound is held (review
 * C4a I-1) and turns only at a reading 300 ms into its run, so it is ready from the second reading,
 * about 500 ms after the host starts. A `readiness` line's `audioPeak` sets the level read from then on.
 */
class Host(private val scheduler: Scheduler, private val write: (String) -> Unit) {
  val server = ScriptedServer()
  private val platform = ScriptedPlatform(server, write)
  private val core = BridgeCore(SystemClock, scheduler, platform, MemoryStore(), "host", "JVM host", newId = { PHONE_ID }).also { platform.core = it }

  @Volatile private var level = 0.5

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
        "script" -> server.script(json.getString("path"), json.getInt("status"), json.getJSONObject("body"))
        "readiness" -> {
          val peak = (json.opt("audioPeak") as? Number)?.toDouble()
          peak?.let { level = it }
          core.readiness(cameraFrames = json.opt("camera") as? Boolean, audioPeak = peak, pose = json.optString("pose").takeIf { it.isNotEmpty() }?.let(::pose))
        }
        "exit" -> return false
        else -> System.err.println("host: no op '$op'")
      }
    } catch (failure: Exception) {
      System.err.println("host: skipped a line: $failure")
    }
    return true
  }

  fun shutdown() = platform.shutdown()

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
