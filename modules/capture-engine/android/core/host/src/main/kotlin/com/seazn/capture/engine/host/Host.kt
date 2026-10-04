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
 */
class Host(scheduler: Scheduler, private val write: (String) -> Unit) {
  val server = ScriptedServer()
  private val platform = ScriptedPlatform(server, write)
  private val core = BridgeCore(SystemClock, scheduler, platform, MemoryStore(), "host", "JVM host", newId = { PHONE_ID }).also { platform.core = it }

  init {
    write(Protocol.encode("ready", mapOf("current" to core.current(), "tail" to core.tail())))
    core.report(Input.Network(true))
    core.readiness(cameraFrames = true, audioPeak = 0.5, pose = Pose.Held(Side.LEFT))
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
        "readiness" ->
          core.readiness(
            cameraFrames = json.opt("camera") as? Boolean,
            audioPeak = (json.opt("audioPeak") as? Number)?.toDouble(),
            pose = json.optString("pose").takeIf { it.isNotEmpty() }?.let(::pose),
          )
        "exit" -> return false
        else -> System.err.println("host: no op '$op'")
      }
    } catch (failure: Exception) {
      System.err.println("host: skipped a line: $failure")
    }
    return true
  }

  fun shutdown() = platform.shutdown()

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
