package com.seazn.capture.engine.adapter

import com.seazn.capture.engine.core.Command
import com.seazn.capture.engine.core.LinkCounters
import com.seazn.capture.engine.core.PairRequest

/** What a platform gives [BridgeCore]. Android's is the glue (Task 33); the JVM host's is scripted (Task 21). */
interface Platform {
  /** Carry out one command. Never blocks the calling (scheduler) thread; outcomes come back through [BridgeCore]. */
  fun execute(command: Command)

  /**
   * One HTTP request, answered once on any thread, whatever happens (C0b: a `POST start` never answered
   * would hold every later Go live). [BridgeCore] backs this with its own backstop and answers once.
   */
  fun http(request: HttpRequest, answer: (HttpOutcome) -> Unit)

  /**
   * CD37: open ([wanted]) or close the camera and microphone. Called on the scheduler thread, only on
   * a change. Must return at once: a build posted elsewhere that fails reports through
   * [BridgeCore.pairFailed] with [request], the pairing it was built for (P11).
   */
  fun capture(wanted: Boolean, request: PairRequest?)

  /** Cumulative counts for the attempt, or null when it is not the attempt the endpoint holds. */
  fun frames(attemptId: Int): FrameCount?

  fun link(attemptId: Int): LinkCounters?

  /** Read at every publish, on the scheduler thread. Volatile reads only. */
  fun facts(): PlatformFacts

  fun snapshot(wire: Map<String, Any?>)

  /** One record line, and its seq (carry C4c-I3): the n-th line of the process is seq n, as [BridgeCore.tail] numbers it. */
  fun recordLine(line: String, seq: Long)

  /** CD8: the intent numbered [seq] has run, with every snapshot and line it caused. Emitted as an event. */
  fun acked(seq: Int)
}

/**
 * App-private storage, excluded from backup (amendment, _Pairing, takeover and rejoin_): Android's
 * `noBackupFilesDir`, the JVM host's memory. Scheduler thread only, but for one read: the Forget marker
 * (`PairingStore.readForgotten`, R6 of the D3 findings design), read on the thread that builds `BridgeCore`, before
 * the scheduler runs any task, so no scheduler-thread write can race it.
 */
interface PrivateStore {
  fun read(name: String): String?

  /** Durable before it returns: A17's record is written before the `End` that follows it. */
  fun write(name: String, text: String)

  fun delete(name: String)
}
