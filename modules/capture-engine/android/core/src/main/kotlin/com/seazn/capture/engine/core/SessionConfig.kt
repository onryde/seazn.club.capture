package com.seazn.capture.engine.core

/** Where one transport publishes. `toString` never prints a secret: these objects reach logs. */
sealed interface IngestTarget {
  val transport: Transport
}

/** The SRT fields stay separate and canonical (spec §2, lane D); the platform composes the query string. */
class SrtTarget(val url: String, val streamId: String, val passphrase: String, val latencyMs: Int) :
  IngestTarget {
  override val transport = Transport.SRT

  override fun toString(): String =
    "SrtTarget(streamId=<${streamId.length} chars>, passphrase=<${passphrase.length} chars>, latencyMs=$latencyMs)"
}

class RtmpsTarget(val url: String, val streamKey: String) : IngestTarget {
  override val transport = Transport.RTMPS

  override fun toString(): String = "RtmpsTarget(url=$url, streamKey=<${streamKey.length} chars>)"
}

/**
 * What `arm` hands the engine (spec §2: `{session, heartbeat}`), flattened by the bridge. [primary]
 * and [fallback] are already ordered by the code's `preferred`.
 */
class SessionConfig(
  val sid: String,
  /** The per-session `tok`: Bearer for the heartbeat and the descriptor (decision 4). A secret. */
  val token: String,
  val primary: IngestTarget,
  val fallback: IngestTarget?,
  val holdWindowSeconds: Map<Transport, Int>,
  val playbackUrl: String,
  val heartbeatUrl: String,
  val appVersion: String,
) {
  fun target(transport: Transport): IngestTarget? =
    listOfNotNull(primary, fallback).firstOrNull { it.transport == transport }

  /** Values the record must never carry, whatever key they arrive under. Blank ones are no secret. */
  fun secrets(): List<String> {
    val srt = listOfNotNull(primary, fallback).filterIsInstance<SrtTarget>()
    val rtmps = listOfNotNull(primary, fallback).filterIsInstance<RtmpsTarget>()
    return (listOf(token) + srt.flatMap { listOf(it.passphrase, it.streamId) } + rtmps.map { it.streamKey })
      .filter { it.isNotBlank() }
  }

  /** Every reason this config cannot run a session; empty when it can. Checked at arm. */
  fun problems(): List<String> = buildList {
    if (sid.isBlank()) add("sid is blank")
    if (token.isBlank()) add("token is blank")
    if (fallback?.transport == primary.transport) add("fallback repeats the primary transport")
    if (!playbackUrl.startsWith("https://")) add("playbackUrl is not https")
    if (!heartbeatUrl.startsWith("https://")) add("heartbeatUrl is not https")
    for (target in listOfNotNull(primary, fallback)) addAll(targetProblems(target))
  }

  private fun targetProblems(target: IngestTarget): List<String> = buildList {
    val window = holdWindowSeconds[target.transport]
    if (window == null || window <= 0) add("no hold window for ${target.transport.wire}")
    when (target) {
      is SrtTarget -> {
        if (target.url.isBlank()) add("srt url is blank")
        if (target.streamId.isBlank()) add("srt streamId is blank")
        // libsrt accepts a passphrase of 10–79 characters (P5, F-P5-1's ruled-out list).
        if (target.passphrase.length !in 10..79) add("srt passphrase is not 10–79 characters")
        if (target.latencyMs <= 0) add("srt latencyMs is not positive")
      }
      is RtmpsTarget -> {
        if (target.url.isBlank()) add("rtmps url is blank")
        if (target.streamKey.isBlank()) add("rtmps streamKey is blank")
      }
    }
  }

  override fun toString(): String =
    "SessionConfig(sid=$sid, token=<${token.length} chars>, primary=$primary, fallback=$fallback)"
}
