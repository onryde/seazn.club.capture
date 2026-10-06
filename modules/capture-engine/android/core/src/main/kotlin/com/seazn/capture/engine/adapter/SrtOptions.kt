package com.seazn.capture.engine.adapter

import com.seazn.capture.engine.core.ConnectFailure
import com.seazn.capture.engine.core.Encode
import com.seazn.capture.engine.core.Hosts
import com.seazn.capture.engine.core.SrtBandwidth
import com.seazn.capture.engine.core.SrtTarget
import java.net.UnknownHostException
import java.nio.channels.UnresolvedAddressException

/**
 * The socket options our own SRT sink (Task 35) sets before connect. The glue maps each to srtdroid's
 * `SockOpt` by name, except [TRANSTYPE_LIVE], which is `SockOpt.TRANSTYPE` set to `Transtype.LIVE`.
 * The glue pins srtdroid 1.10.1, the version StreamPack 3.2.1 names (C7u); these names were read with javap
 * from 1.9.5, Task 35's javap of 1.10.0 settled them, and 1.10.1 keeps every one (C7u, javap: it adds only
 * `trySend`).
 */
enum class SrtOpt { TRANSTYPE_LIVE, STREAMID, PASSPHRASE, LATENCY, INPUTBW, OHEADBW, MAXBW, CONNTIMEO }

/** Where and how to connect. [before] holds both secrets, so `toString` names the options and never prints their values. */
data class SrtPlan(val host: String, val port: Int, val before: List<Pair<SrtOpt, Any>>, val maxBwBytesPerSecond: Long) {
  override fun toString(): String = "SrtPlan($host:$port, options=${before.map { it.first }}, maxBw=$maxBwBytesPerSecond)"
}

/** CD14. The options our own sink sets, so no secret is ever written into an SRT URL. */
object SrtOptions {
  /** A half-open network must not park a connect: P5's spike used 15 s. libsrt's own default is 3 s. */
  private const val CONNECT_TIMEOUT_MS = 6_000

  /** libsrt's default, written out so the plan says what it relies on. */
  private const val OVERHEAD_PERCENT = 25

  private const val MAX_CAUSES = 8

  /**
   * `srt://host:port` and nothing after, the shape the session shape's reader admits (`Bodies`), with
   * the scheme's letters ASCII in either case (carry from Task 15). The host's letters are ASCII too, so
   * lower-casing it can never turn another script's letter into an ingest host's. Today that is belt and
   * braces: under `Locale.ROOT` only U+212A (the Kelvin sign) lower-cases into ASCII, to `k`, and no SRT
   * ingest host holds a `k` (every code point checked, Task 19).
   */
  private val SHAPE = Regex("[Ss][Rr][Tt]://([A-Za-z0-9.-]+):([0-9]{1,5})")


  /** Null when the URL is not exactly `srt://<an SRT ingest host>:<1–65535>`. */
  fun plan(target: SrtTarget, maxBw: Long?): SrtPlan? {
    val match = SHAPE.matchEntire(target.url) ?: return null
    // A18: the one ingest host, matched exactly ([Hosts.INGEST], owner ruling A, 2026-10-05). `Bodies` has
    // already held the URL to it ([Hosts.onIngest]); the plan refuses anything else as well, so a lookalike that
    // slipped past would still never reach a socket.
    val host = match.groupValues[1].lowercase().takeIf { it == Hosts.INGEST } ?: return null
    val port = match.groupValues[2].toInt().takeIf { it in 1..65_535 } ?: return null
    val before =
      listOf(
        SrtOpt.TRANSTYPE_LIVE to true,
        SrtOpt.STREAMID to target.streamId,
        SrtOpt.PASSPHRASE to target.passphrase,
        SrtOpt.LATENCY to target.latencyMs,
        SrtOpt.INPUTBW to 0L,
        SrtOpt.OHEADBW to OVERHEAD_PERCENT,
        SrtOpt.CONNTIMEO to CONNECT_TIMEOUT_MS,
      )
    return SrtPlan(host, port, before, maxBw ?: SrtBandwidth.maxBwBytesPerSecond(Encode.CEILING_BPS))
  }

  /**
   * F-P5-1: a dead DNS is UNRESOLVED on either transport, which the fallback policy never counts. SRT
   * resolves first, so it is an [UnknownHostException] and never libsrt's "bad parameters". RTMPS reports
   * an unresolved address: Ktor builds `java.net.InetSocketAddress(host, port)`, which leaves a failed
   * lookup unresolved, and the channel's connect throws [UnresolvedAddressException], with no message.
   * Read through the causes, since a library may wrap what it caught. The text is read, never kept: the
   * result is a closed word, so no secret a library quotes can ride out on it.
   */
  fun failure(t: Throwable): ConnectFailure {
    val chain = generateSequence(t) { it.cause }.take(MAX_CAUSES).toList()
    val text = chain.joinToString(" ") { it.message.orEmpty() }.lowercase()
    return when {
      chain.any { it is UnknownHostException || it is UnresolvedAddressException } -> ConnectFailure.UNRESOLVED
      "timed out" in text || "timeout" in text -> ConnectFailure.TIMEOUT
      "rejected" in text || "refused" in text -> ConnectFailure.REFUSED
      else -> ConnectFailure.OTHER
    }
  }
}
