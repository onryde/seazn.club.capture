package com.seazn.capture.engine.core

import java.net.URLEncoder

/** One line of the session record, before the scrub. [kind] is the core's own vocabulary. */
data class RecordEntry(val kind: String, val fields: List<Pair<String, Any?>> = emptyList())

/**
 * The post-match session record (AGENTS §11): timestamped transitions, fallbacks, reconnects,
 * thermal readings and heartbeat results, one JSON object per line.
 *
 * Scrubbed at the sink, by allow-list (P5's scrub rule). A string passes only under a key this
 * object knows; public URLs pass verbatim, because every viewer already holds them. The same value
 * can be a secret in one role and public in another: the SRT stream id is a secret, and on
 * Cloudflare it is also a path segment of the public playback URL. So the stream id is masked
 * everywhere except inside a public URL, and `tok`, passphrases and stream keys are masked everywhere.
 */
class SessionRecord(private val sink: (String) -> Unit) {
  private var secrets: List<String> = emptyList()
  private var urlSecrets: List<String> = emptyList()
  private val recent = ArrayDeque<String>()

  /** How many lines the sink refused. Surfaced in Diagnostics by plan C; never thrown. */
  var sinkFailures: Int = 0
    private set

  /**
   * Called for every arm, before the machine sees it. From then on these values never reach a line.
   * It only ever adds: a value that was a secret in this process stays masked.
   */
  fun protect(config: SessionConfig) {
    val all = config.secrets()
    val streamIds = listOfNotNull(config.primary, config.fallback).filterIsInstance<SrtTarget>().map { it.streamId }
    secrets = withEncodings(secrets + all)
    urlSecrets = withEncodings(urlSecrets + (all - streamIds.toSet()))
  }

  fun append(atEpochMs: Long, entry: RecordEntry) {
    val fields = listOf("at" to IsoTime.utc(atEpochMs), "kind" to entry.kind) + entry.fields.map { (key, value) -> key to scrub(key, value) }
    val line = Json.obj(fields)
    recent.addLast(line)
    while (recent.size > LAST_LINES) recent.removeFirst()
    try {
      sink(line)
    } catch (_: Exception) {
      sinkFailures += 1
    }
  }

  /** The last [LAST_LINES] lines, oldest first, for Diagnostics (spec §4). */
  fun lastLines(): List<String> = recent.toList()

  private fun scrub(key: String, value: Any?): Any? =
    when {
      key in NEVER -> MASK
      value == null || value is Boolean || value is Int || value is Long || value is Wire || value is Decimal -> value
      value is Double -> Decimal.tenths(value)
      value !is String -> MASK
      key in PUBLIC_URL_KEYS -> masked(value, urlSecrets)
      key in PLAIN_KEYS || key in TEXT_KEYS -> masked(value, secrets)
      else -> MASK
    }

  private fun masked(text: String, values: List<String>): String = values.fold(text) { acc, secret -> acc.replace(secret, MASK) }

  /** Longest first, so a secret that contains another is masked whole; URL-encoded forms too. */
  private fun withEncodings(values: List<String>): List<String> =
    values.filter { it.isNotBlank() }.flatMap { listOf(it, URLEncoder.encode(it, "UTF-8")) }.distinct().sortedByDescending { it.length }

  companion object {
    const val LAST_LINES = 20
    const val MASK = "***"

    /** Public by construction: every viewer's player and every overlay browser source holds them. */
    val PUBLIC_URL_KEYS = setOf("playbackUrl", "overlayUrl")

    /** Free text from a library or the platform, which can quote a URL or a key. Masked by value. */
    val TEXT_KEYS = setOf("message", "problems")

    /** The core's own vocabulary and measurements' labels. Masked by value too, as defence in depth. */
    val PLAIN_KEYS =
      setOf("sid", "transport", "reason", "cause", "failure", "from", "to", "result", "state", "endReason", "delivery", "shed", "intent", "phase", "host", "appVersion")

    /** Never written, whatever the value, and never allowed onto the lists above. */
    val NEVER = setOf("tok", "token", "passphrase", "streamKey", "streamId", "bearer", "authorization")
  }
}
