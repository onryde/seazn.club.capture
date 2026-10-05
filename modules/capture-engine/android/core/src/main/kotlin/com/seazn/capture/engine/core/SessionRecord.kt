package com.seazn.capture.engine.core

import java.io.ByteArrayOutputStream
import java.net.URLEncoder

/**
 * One line of the session record, before the scrub. [kind] is the core's own vocabulary. [level] is
 * written only when it is not `info` (CD7), so every line the core writes keeps its shape.
 */
data class RecordEntry(val kind: String, val fields: List<Pair<String, Any?>> = emptyList(), val level: String = "info")

/**
 * The record's last lines, oldest first, and the seq of the first of them (carry C4c-I3). The n-th line
 * the process wrote is seq n, so a reader holding the tail tells a later line from one of the tail's by
 * number: two lines can be equal, character for character, but never their seqs. One value, so a reader
 * on another thread never pairs one append's seq with another's lines.
 */
data class RecordTail(val firstSeq: Long, val lines: List<String>)

/**
 * The post-match session record (AGENTS §11): timestamped transitions, fallbacks, reconnects,
 * thermal readings and heartbeat results, one flat JSON object per line, `{at, kind, [level], …}`.
 *
 * Scrubbed at the sink by allow-list (CD6, carry 11), one rule set with the JS scrub. The source of
 * record is `modules/capture-engine/src/scrub/allow-list.json`, which both sides test their sets
 * against, and both run `scrub/vectors.json`. The masked value is [MASK]. The four rules:
 * - a [NEVER] key is always masked, whatever it holds;
 * - a finite number, a boolean, null, a [Wire] or a [Decimal] passes under any other key: no secret
 *   is a number. A non-finite number is masked, as JS masks it;
 * - a string passes only under a listed key, by its class. A [PLAIN_KEYS] key passes a short plain
 *   word that shows no held secret, else the whole value is masked. A [PUBLIC_URL_KEYS] key passes a
 *   public https URL with no query, fragment or userinfo, else the whole value is masked: every viewer
 *   already holds those, and the SRT stream id, a secret elsewhere, is a path segment of Cloudflare's
 *   playback URL, so it alone may stand in one. A [TEXT_KEYS] key masks each held secret where it
 *   stands, then the whole value if decoding what is left still reveals one;
 * - anything else is masked.
 * The kind passes as a plain word, or is masked whole.
 *
 * Threads: [protect] and [append] belong to the engine's scheduler thread, the one serial thread
 * plan C backs [Scheduler] with. [lastLines], [sinkFailures] and [reentrantDropped] may be read
 * from any thread, which is how Diagnostics reads them.
 */
class SessionRecord(private val sink: (String) -> Unit) {
  private class Pending(val line: String, val echo: Boolean)

  private var secrets: List<String> = emptyList()
  private var urlSecrets: List<String> = emptyList()
  private var textOnly: List<String> = emptyList()

  /** [secrets] and [textOnly] together, longest first: what free text is masked with. */
  private var textSecrets: List<String> = emptyList()
  private val recent = ArrayDeque<String>()
  private val queue = ArrayDeque<Pending>()

  /** The line the sink is handling, or null outside the sink. */
  private var delivering: Pending? = null

  @Volatile private var tail = RecordTail(1, emptyList())

  /**
   * The seq of the newest line, 0 before the first (carry C4c-I3). Inside the sink it is the seq of the
   * line being handed over: an append made from the sink waits for the sink to return, so it never moves
   * under the sink. Each line handed to the sink takes one, a line the sink refuses too; an echo dropped
   * as [reentrantDropped] takes none, since it is never written.
   */
  @Volatile
  var lastSeq: Long = 0
    private set

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
   * Called before the machine sees a secret: the token at `pair`, the credentials at an open code
   * answer. From then on [secrets] never reach a line, nor a public URL unless listed in [notInUrls]
   * (a stream id, which is a path segment of the playback URL). [inTextOnly] is masked in free text
   * alone (M3): the code, which no line names, but a library's error can quote in a URL. It only ever
   * adds: a value that was a secret in this process stays masked.
   */
  fun protect(secrets: List<String>, notInUrls: List<String> = emptyList(), inTextOnly: List<String> = emptyList()) {
    this.secrets = adding(this.secrets, secrets)
    urlSecrets = adding(urlSecrets, secrets - notInUrls.toSet())
    textOnly = adding(textOnly, inTextOnly)
    textSecrets = (this.secrets + textOnly).distinct().sortedByDescending { it.length }
  }

  /**
   * Only the new values are encoded. The engine protects at every input, so the same values arrive
   * again; encoding what is held would add forms of forms, which no encoder writes and JS, deriving
   * its forms from the raw values, never holds (review M3).
   */
  private fun adding(held: List<String>, more: List<String>): List<String> =
    (held + withEncodings(more)).distinct().sortedByDescending { it.length }

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
  fun lastLines(): List<String> = tail.lines

  /** The same lines with the seq of the first, as one value (carry C4c-I3). Safe from any thread. */
  fun numberedTail(): RecordTail = tail

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
    val seq = lastSeq + 1
    tail = RecordTail(seq - recent.size + 1, recent.toList())
    lastSeq = seq
    try {
      sink(line)
    } catch (_: Exception) {
      sinkFailures += 1
    }
  }

  private fun line(atEpochMs: Long, entry: RecordEntry): String {
    val head = listOf("at" to IsoTime.utc(atEpochMs), "kind" to kindWord(entry.kind))
    val level = if (entry.level == "info") emptyList() else listOf("level" to levelWord(entry.level))
    return Json.obj(head + level + entry.fields.map { (key, value) -> fieldKey(key) to scrub(key, value) })
  }

  /** One of [LEVELS], or masked: a caller's level is a value like any other, and only those four are vetted. */
  private fun levelWord(level: String): String = if (level in LEVELS) level else MASK

  /** The record's own keys are never written twice: a field that reuses one is renamed, not dropped. */
  private fun fieldKey(key: String): String = if (key in RESERVED_KEYS) "field_$key" else key

  /**
   * The four rules (CD6). Text masks the code too ([textSecrets], M3); a plain word and the kind are
   * checked against [secrets] alone, so a short code never masks a closed word that contains it.
   */
  private fun scrub(key: String, value: Any?): Any? =
    when {
      key in NEVER -> MASK
      value == null || value is Boolean || value is Int || value is Long || value is Wire || value is Decimal -> value
      value is Double -> if (value.isFinite()) Decimal.tenths(value) else MASK
      value !is String -> MASK
      key in PUBLIC_URL_KEYS -> if (isPublicUrl(value)) value else MASK
      key in PLAIN_KEYS -> if (PLAIN_WORD.matches(value) && !revealed(value, secrets)) value else MASK
      key in TEXT_KEYS -> masked(value, textSecrets)
      else -> MASK
    }

  private fun kindWord(kind: String): String = if (PLAIN_WORD.matches(kind) && !revealed(kind, secrets)) kind else MASK

  /** https, a host, an optional port and path; no query, fragment or userinfo, and no secret but the stream id. */
  private fun isPublicUrl(value: String): Boolean = PUBLIC_URL.matches(value) && !revealed(value, urlSecrets)

  /**
   * Each known form of a secret is masked where it stands. If what is left still reveals one, read
   * as [revealed] reads it (lowercase hex, `/` left raw, two encoders mixed), the whole value is
   * masked: JS's `maskedText`, rule for rule.
   */
  private fun masked(text: String, values: List<String>): String {
    val replaced = values.fold(text) { acc, secret -> acc.replace(secret, MASK) }
    return if (revealed(replaced, values)) MASK else replaced
  }

  /**
   * Whether [text] shows any of [values], each reading on its own: as it stands; percent-decoded;
   * decoded, then `+` read as a space; and `+` read as a space, then decoded, which is URLEncoder's
   * form, where a `+` in the secret is `%2B`. JS's `readingsOf`, reading for reading.
   */
  private fun revealed(text: String, values: List<String>): Boolean {
    val decoded = percentDecoded(text)
    val readings = listOf(text, decoded, decoded.replace('+', ' '), percentDecoded(text.replace('+', ' ')))
    return values.any { secret -> readings.any { secret in it } }
  }

  /** Longest first, so a secret that contains another is masked whole; its encoded forms too. */
  private fun withEncodings(values: List<String>): List<String> =
    values.filter { it.isNotBlank() }.flatMap { forms(it) }.distinct().sortedByDescending { it.length }

  companion object {
    const val LAST_LINES = 20
    const val MASK = "***"

    // The key sets are `scrub/allow-list.json`'s, each key with its reason there; ScrubParityTest
    // holds these to it, and scrub.ts keeps the same sets. Add a key there, here and in JS.

    /** Public by construction: every viewer's player and every overlay browser source holds them. */
    val PUBLIC_URL_KEYS = setOf("url", "playbackUrl", "overlayUrl")

    /** Free text from a library or the platform, which can quote a URL or a key. Masked by value. */
    val TEXT_KEYS = setOf("message", "problems")

    /** Closed words: each side's vocabulary, measurements' labels and tags that name no secret. */
    val PLAIN_KEYS =
      setOf(
        "action", "answer", "appVersion", "attempt", "cause", "claim", "count", "delivery", "endReason", "error", "exit",
        "failure", "from", "host", "intent", "key", "kind", "lastEnd", "lock", "mode", "ms", "notReady", "op", "phase",
        "problem", "reason", "refusal", "result", "retryAfterS", "route", "scene", "shed", "side", "sid", "slot",
        "startFailed", "state", "status", "tag", "to", "tokenTag", "transport", "word",
      )

    /** Never written, whatever the value, and never allowed onto the lists above. A line never carries a code. */
    val NEVER = setOf("tok", "token", "code", "passphrase", "streamKey", "streamId", "bearer", "authorization")

    /** Keys every line starts with. A field under one of them is written as `field_<key>` (CD7). */
    val RESERVED_KEYS = setOf("at", "kind", "level")

    /** The levels a line may carry: the JS logger's four (`LogLevel`). `info` is the one never written. */
    val LEVELS = setOf("debug", "info", "warn", "error")

    /**
     * A word, not a sentence: no spaces, slashes, `?`, `=` or `@`, so no URL or message fits. The
     * file's `plainWord`, character for character. Its letters and digits are ASCII, spelled out:
     * Android's regex engine is ICU, whose `\w` is not promised to be the JVM's or JS's.
     */
    val PLAIN_WORD = Regex("^[A-Za-z0-9_.:-]{1,64}$")

    /**
     * Whitespace is ASCII's six, spelled out as scrub.ts spells them, so the two sides cannot read
     * `\s` differently (JS's holds Unicode spaces). `\x0B`, not `\v`: Java's `\v` is a class that
     * also holds U+2028, where JS's is the one character. The scheme's case is spelled out too, with
     * no case option: Kotlin's IGNORE_CASE adds UNICODE_CASE, which reads `httpſ` as `https` where
     * JS does not (review M1). The port's digits are ASCII for the reason [PLAIN_WORD]'s are.
     */
    private val PUBLIC_URL = Regex("^[Hh][Tt][Tt][Pp][Ss]://[^/?#@ \\t\\n\\x0B\\f\\r:]+(:[0-9]+)?(/[^?# \\t\\n\\x0B\\f\\r]*)?$")

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

    /**
     * `digitToIntOrNull(16)` is Java's `Character.digit`: it reads any decimal digit and the
     * fullwidth A to F as hex digits, one UTF-16 unit at a time. scrub.ts reads them the same way,
     * since decoding more masks more (review M2); `vectors.json` pins both.
     */
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
