package com.seazn.capture.engine.adapter

import com.seazn.capture.engine.core.Command
import com.seazn.capture.engine.core.DropReason
import com.seazn.capture.engine.core.Input
import com.seazn.capture.engine.core.LinkCounters
import com.seazn.capture.engine.core.PairRequest
import org.json.JSONObject

/**
 * Records every call, answers the server from [PairWire], and plays a phone that grants and connects.
 * Each switch below breaks one thing, the way a phone or a network can.
 */
class RecordingPlatform : Platform {
  lateinit var core: BridgeCore
  val lines = mutableListOf<String>()
  val snapshots = mutableListOf<Map<String, Any?>>()
  val executed = mutableListOf<Command>()
  val http = mutableListOf<HttpRequest>()
  val captures = mutableListOf<Boolean>()
  val captureRequests = mutableListOf<PairRequest?>()

  /** Snapshots, record lines (`line:<kind>`) and acks, in the order they reached the platform (CD8). */
  val events = mutableListOf<String>()
  var grant = true

  /** False: the permission request is never answered, as when there is no activity to ask from. */
  var ask = true
  var throwOnConnect: Throwable? = null
  var throwOnFactsOnce: Throwable? = null

  /** Thrown by every facts read: a battery or thermal reader that fails on every read (review C4a I-2). */
  var throwOnFacts: Throwable? = null

  /** Thrown by the next snapshot hand-up only: the bridge to JS failing once. */
  var throwOnSnapshotOnce: Throwable? = null

  /** Thrown by every command it names; the command is still recorded. */
  var throwOn: (Command) -> Throwable? = { null }

  /** Thrown by every Link read: a supplier that fails on every read (review 14, G3). */
  var throwOnLink: Throwable? = null

  /** Thrown by the record's sink for every line: a sink that fails the same way each time (review 13, I2). */
  var throwOnLine: Throwable? = null

  /** Thrown by `http` itself, before any answer, for each request it names. */
  var throwOnHttp: (HttpRequest) -> Throwable? = { null }

  /** A request this names is not answered by the platform: its answer waits in [owed], for a test to give late. */
  var unanswered: (HttpRequest) -> Boolean = { false }
  val owed = mutableListOf<Pair<HttpRequest, (HttpOutcome) -> Unit>>()

  /** Called with each command before it runs, to look at the world as the command found it. */
  var onExecute: (Command) -> Unit = {}
  var frozen = false
  var answer: (HttpRequest) -> HttpOutcome = PairWire::answer
  private var video = 0L
  private var audio = 0L
  private var connected: Int? = null

  override fun execute(command: Command) {
    executed += command
    onExecute(command)
    throwOn(command)?.let { throw it }
    when (command) {
      Command.AskPermissions -> if (ask) core.report(Input.PermissionsAnswered(grant))
      is Command.Connect -> {
        throwOnConnect?.let { throw it }
        connected = command.attemptId
        core.report(Input.Connected(command.attemptId))
      }
      else -> Unit
    }
  }

  override fun http(request: HttpRequest, answer: (HttpOutcome) -> Unit) {
    http += request
    throwOnHttp(request)?.let { throw it }
    if (unanswered(request)) {
      owed += request to answer
      return
    }
    answer(this.answer(request))
  }

  override fun capture(wanted: Boolean, request: PairRequest?) {
    captures += wanted
    captureRequests += request
  }

  override fun frames(attemptId: Int): FrameCount? {
    if (attemptId != connected) return null
    if (!frozen) {
      video += 15
      audio += 23
    }
    return FrameCount(video, audio)
  }

  override fun link(attemptId: Int): LinkCounters? {
    throwOnLink?.let { throw it }
    return if (attemptId == connected) LinkCounters(1_000, 10, 0, 0, 0, 40, 120, 3_000_000) else null
  }

  override fun facts(): PlatformFacts {
    throwOnFactsOnce?.let {
      throwOnFactsOnce = null
      throw it
    }
    throwOnFacts?.let { throw it }
    return PlatformFacts(audioLevel = 0.5)
  }

  override fun snapshot(wire: Map<String, Any?>) {
    throwOnSnapshotOnce?.let {
      throwOnSnapshotOnce = null
      throw it
    }
    snapshots += wire
    events += "snapshot"
  }

  override fun recordLine(line: String) {
    throwOnLine?.let { throw it }
    lines += line
    events += "line:" + JSONObject(line).getString("kind")
  }

  override fun acked(seq: Int) {
    events += "ack:$seq"
  }

  /** The attempt the platform last connected. */
  val attempt: Int
    get() = connected!!

  fun dropCurrent() = core.report(Input.Dropped(connected!!, DropReason.ENDPOINT_CLOSED, "cut"))

  fun beats() = http.filter { it.url.endsWith("/beats") }
}
