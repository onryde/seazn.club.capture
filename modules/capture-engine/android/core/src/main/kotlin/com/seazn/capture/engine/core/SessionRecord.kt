package com.seazn.capture.engine.core

import java.io.ByteArrayOutputStream
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
 *
 * Threads: [protect] and [append] belong to the engine's scheduler thread, the one serial thread
 * plan C backs [Scheduler] with. [lastLines], [sinkFailures] and [reentrantDropped] may be read
 * from any thread, which is how Diagnostics reads them.
 */
class SessionRecord(private val sink: (String) -> Unit) {
  private class Pending(val line: String, val echo: Boolean)

  private var secrets: List<String> = emptyList()
  private var urlSecrets: List<String> = emptyList()
  private val recent = ArrayDeque<String>()
  private val queue = ArrayDeque<Pending>()

  /** The line the sink is handling, or null outside the sink. */
  private var delivering: Pending? = null

  @Volatile private var snapshot: List<String> = emptyList()

  /** How many lines the sink refused. Surfaced in Diagnostics by plan C; never thrown. */
  @Volatile
  var sinkFailures: Int = 0
    private set

  /**
   * Lines appended from inside the sink while it handled a line that was itself appended from
   * inside the sink. The levelled logger feeds the record and the sink feeds the logger (AGENTS
   * §11): if that loop closes, one echo is written and the next is dropped here, and counted.
   */
  @Volatile
  var reentrantDropped: Int = 0
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

  /**
   * Scrubs [entry] and hands the line to the sink. An append made from inside the sink is queued
   * and handed over once the sink returns, so the sink and [lastLines] see one order. An exception
   * from the sink is counted in [sinkFailures]; an `Error` is not caught.
   */
  fun append(atEpochMs: Long, entry: RecordEntry) {
    val current = delivering
    when {
      current == null -> {
        queue.addLast(Pending(line(atEpochMs, entry), echo = false))
        flush()
      }
      current.echo -> reentrantDropped += 1
      else -> queue.addLast(Pending(line(atEpochMs, entry), echo = true))
    }
  }

  /** The last [LAST_LINES] lines, oldest first, for Diagnostics (spec §4). Safe from any thread. */
  fun lastLines(): List<String> = snapshot

  private fun flush() {
    try {
      while (queue.isNotEmpty()) {
        val next = queue.removeFirst()
        delivering = next
        deliver(next.line)
      }
    } finally {
      delivering = null
    }
  }

  private fun deliver(line: String) {
    recent.addLast(line)
    while (recent.size > LAST_LINES) recent.removeFirst()
    snapshot = recent.toList()
    try {
      sink(line)
    } catch (_: Exception) {
      sinkFailures += 1
    }
  }

  private fun line(atEpochMs: Long, entry: RecordEntry): String {
    val head = listOf("at" to IsoTime.utc(atEpochMs), "kind" to masked(entry.kind, secrets))
    return Json.obj(head + entry.fields.map { (key, value) -> fieldKey(key) to scrub(key, value) })
  }

  /** The record's own keys are never written twice: a field that reuses one is renamed, not dropped. */
  private fun fieldKey(key: String): String = if (key in RESERVED_KEYS) "field_$key" else key

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

  /**
   * Each known form of a secret is masked where it stands. If percent-decoding what is left still
   * reveals one (lowercase hex, `/` left raw, two encoders mixed), the whole value is masked.
   */
  private fun masked(text: String, values: List<String>): String {
    val replaced = values.fold(text) { acc, secret -> acc.replace(secret, MASK) }
    val decoded = percentDecoded(replaced)
    val revealed = values.any { it in decoded || it in decoded.replace('+', ' ') }
    return if (revealed) MASK else replaced
  }

  /** Longest first, so a secret that contains another is masked whole; its encoded forms too. */
  private fun withEncodings(values: List<String>): List<String> =
    values.filter { it.isNotBlank() }.flatMap { forms(it) }.distinct().sortedByDescending { it.length }

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

    /** Keys every line starts with. A field under one of them is written as `field_<key>`. */
    val RESERVED_KEYS = setOf("at", "kind")

    /** What `android.net.Uri.encode` leaves raw and `URLEncoder` does not. `*` is raw in both. */
    private val COMPONENT_RAW = listOf("%7E" to "~", "%21" to "!", "%27" to "'", "%28" to "(", "%29" to ")")

    /**
     * The raw value, `URLEncoder`'s form (space as `+`), and the component form `Uri.encode` writes
     * (space as `%20`, `~ ! ' ( )` raw). srtdroid's `SrtUri.Builder` builds the SRT query with
     * `Uri.Builder`, so StreamPack's descriptor prints the passphrase in the component form.
     */
    private fun forms(secret: String): List<String> {
      val form = URLEncoder.encode(secret, "UTF-8")
      val component = COMPONENT_RAW.fold(form.replace("+", "%20")) { acc, (escape, raw) -> acc.replace(escape, raw) }
      return listOf(secret, form, component)
    }

    /**
     * `%XX` escapes decoded as UTF-8, runs of them together so a two-byte character decodes whole.
     * Anything else is kept as it is: a `+`, and a `%` that does not start an escape.
     */
    private fun percentDecoded(text: String): String {
      val out = StringBuilder(text.length)
      val run = ByteArrayOutputStream()
      var at = 0
      while (at < text.length) {
        val byte = escapedByte(text, at)
        if (byte != null) {
          run.write(byte)
          at += 3
        } else {
          out.appendUtf8(run)
          out.append(text[at])
          at += 1
        }
      }
      out.appendUtf8(run)
      return out.toString()
    }

    private fun escapedByte(text: String, at: Int): Int? {
      if (text[at] != '%' || at + 2 >= text.length) return null
      val high = text[at + 1].digitToIntOrNull(16) ?: return null
      val low = text[at + 2].digitToIntOrNull(16) ?: return null
      return high * 16 + low
    }

    private fun StringBuilder.appendUtf8(run: ByteArrayOutputStream) {
      if (run.size() == 0) return
      append(String(run.toByteArray(), Charsets.UTF_8))
      run.reset()
    }
  }
}
