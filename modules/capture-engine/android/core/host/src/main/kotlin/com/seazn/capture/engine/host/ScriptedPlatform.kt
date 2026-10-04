package com.seazn.capture.engine.host

import com.seazn.capture.engine.adapter.AttemptSignals
import com.seazn.capture.engine.adapter.BridgeCore
import com.seazn.capture.engine.adapter.FrameCount
import com.seazn.capture.engine.adapter.HttpOutcome
import com.seazn.capture.engine.adapter.HttpRequest
import com.seazn.capture.engine.adapter.JsonReader
import com.seazn.capture.engine.adapter.Platform
import com.seazn.capture.engine.adapter.PlatformFacts
import com.seazn.capture.engine.core.Command
import com.seazn.capture.engine.core.Input
import com.seazn.capture.engine.core.LinkCounters
import com.seazn.capture.engine.core.PairRequest
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

/**
 * A phone that grants, connects and counts frames, over [server]. Its own single thread answers
 * connects and HTTP, as a real platform's callbacks arrive off the scheduler thread. Events go out
 * through [write]; everything else is a diagnostic on stderr.
 */
class ScriptedPlatform(private val server: ScriptedServer, private val write: (String) -> Unit) : Platform {
  lateinit var core: BridgeCore

  private val executor = Executors.newSingleThreadScheduledExecutor { task -> Thread(task, "scripted-platform").apply { isDaemon = true } }

  /** R3: one open per attempt, whatever the platform repeats (PV24). */
  private val signals = AttemptSignals()

  /** The attempt counting frames, and when it connected; null when none is. */
  @Volatile private var counting: Pair<Int, Long>? = null

  override fun execute(command: Command) {
    when (command) {
      Command.AskPermissions -> core.report(Input.PermissionsAnswered(true))
      is Command.Connect -> connect(command.attemptId)
      is Command.Rebuild -> {
        counting = null
        connect(command.next.attemptId)
      }
      is Command.StartNewSession -> {
        counting = null
        connect(command.next.attemptId)
      }
      is Command.Disconnect, Command.StopBroadcast, is Command.End -> {
        counting = null
        diagnostic("$command")
      }
      else -> diagnostic("$command")
    }
  }

  /** Connected [CONNECT_MS] later; frames count from then. */
  private fun connect(id: Int) {
    executor.schedule(
      {
        counting = id to monotonicMs()
        signals.connected(id)?.let(core::report)
      },
      CONNECT_MS,
      TimeUnit.MILLISECONDS,
    )
  }

  override fun http(request: HttpRequest, answer: (HttpOutcome) -> Unit) {
    // The body the engine sent, never the URL or the Bearer: the kit asserts the claim, `stopped` and `notReady`.
    server.path(request)?.let { path -> write(Protocol.encode("request", mapOf("path" to path, "body" to request.body?.let(JsonReader::parse)))) }
    val taken = server.take(request)
    // In flight until the core has been handed it, so the host is never quiet between the two (Task 27).
    executor.execute {
      try {
        answer(taken.outcome)
      } finally {
        server.handed(taken)
      }
    }
  }

  override fun capture(wanted: Boolean, request: PairRequest?) = diagnostic("capture wanted=$wanted")

  /** 15 video and 23 audio frames every 500 ms since the connect, for the attempt connected. */
  override fun frames(attemptId: Int): FrameCount? {
    val (id, since) = counting ?: return null
    if (id != attemptId) return null
    val steps = (monotonicMs() - since) / FRAME_STEP_MS
    return FrameCount(15 * steps, 23 * steps)
  }

  override fun link(attemptId: Int): LinkCounters? = null

  override fun facts(): PlatformFacts = PlatformFacts(audioLevel = 0.5, survivesBackground = true)

  override fun snapshot(wire: Map<String, Any?>) = write(Protocol.encode("snapshot", mapOf("body" to wire)))

  override fun recordLine(line: String) = write(Protocol.encode("record", mapOf("line" to line)))

  override fun acked(seq: Int) = write(Protocol.encode("ack", mapOf("seq" to seq.toDouble())))

  fun shutdown() {
    executor.shutdownNow()
  }

  private fun diagnostic(text: String) = System.err.println("host: $text")

  private companion object {
    const val CONNECT_MS = 100L
    const val FRAME_STEP_MS = 500L

    fun monotonicMs(): Long = System.nanoTime() / 1_000_000
  }
}
