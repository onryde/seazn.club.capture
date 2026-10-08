package com.seazn.capture.engine.adapter

import java.util.concurrent.atomic.AtomicBoolean

/**
 * The scoring-link route's answer (capture-scoring-link.v1). A link is a scoring credential for one fixture
 * (spec §10): `toString` prints a length, never the URL, and nothing here writes it anywhere but [ScoringLinks.wire].
 */
sealed interface ScoringLinkAnswer {
  /** "ok", or a refusal word (plan decision D3). */
  val word: String

  class Link(val url: String) : ScoringLinkAnswer {
    override val word: String get() = "ok"

    override fun toString(): String = "Link(url=<${url.length} chars>)"
  }

  class Refused(override val word: String, val retryAfterS: Int?) : ScoringLinkAnswer {
    override fun toString(): String = "Refused($word)"
  }
}

object ScoringLinks {
  /** What the module's promise resolves with: the one place the URL leaves native. Every number a Double. */
  fun wire(answer: ScoringLinkAnswer): Map<String, Any?> =
    linkedMapOf<String, Any?>("outcome" to answer.word).also {
      when (answer) {
        is ScoringLinkAnswer.Link -> it["url"] = answer.url
        is ScoringLinkAnswer.Refused -> answer.retryAfterS?.let { s -> it["retryAfterS"] = s.toDouble() }
      }
    }

  /** The link's secret: the `dl_` segment, which the record protects before the answer is handed over. */
  fun secret(url: String): String = url.substringAfterLast('/')
}

/**
 * RP4. One tap's hand-over, and the only thing between a tap and `GuardedScheduler`'s failure path. Everything the call
 * does runs through [apart], so what the transport, the reading or the caller's own [resolve] throws (an `Error` included:
 * `BridgeCore.ask` catches only `Exception`) answers `unavailable`, is noted by its class, and stops here. Without it a
 * `LinkageError` (an `UnsatisfiedLinkError` from a missing TLS library is the realistic one) reaches `BridgeCore.failed`,
 * which holds it against the process for good and ends the pairing: a tap on a side button would end a broadcast.
 * [hand] answers the caller at most once, whoever asks. One tap, one tap object; never shared.
 */
internal class ScoringTap(private val resolve: (Map<String, Any?>) -> Unit, private val note: (Throwable) -> Unit) {
  private val handed = AtomicBoolean(false)

  /** True once the caller has been answered (or has been tried): a late backstop has nothing left to say. */
  val spent: Boolean get() = handed.get()

  /** The first call answers the caller; a later one is dropped. A throw from [resolve] is the caller's own to [apart]. */
  fun hand(wire: Map<String, Any?>) {
    if (handed.compareAndSet(false, true)) resolve(wire)
  }

  /**
   * Runs [work]; if it throws, answers `unavailable` (once, if nothing has been handed yet) and notes the throwable.
   * A [resolve] that is dead as well is noted too, and the second throw stops here, never at the failure path.
   */
  fun apart(work: () -> Unit) {
    try {
      work()
    } catch (failure: Throwable) {
      val again =
        try {
          hand(UNAVAILABLE)
          null
        } catch (second: Throwable) {
          second
        }
      note(failure)
      again?.let(note)
    }
  }

  private companion object {
    val UNAVAILABLE = ScoringLinks.wire(ScoringLinkAnswer.Refused("unavailable", null))
  }
}
