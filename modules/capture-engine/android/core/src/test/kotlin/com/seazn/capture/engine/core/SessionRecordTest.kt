package com.seazn.capture.engine.core

import java.io.IOException
import java.net.URLEncoder
import java.util.Objects
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

/** Plan B's callers, as Task 5 re-states them: a config's secrets, its SRT stream ids allowed in public URLs. */
private fun SessionRecord.protectConfig(config: SessionConfig) =
  protect(config.secrets(), notInUrls = listOfNotNull(config.primary, config.fallback).filterIsInstance<SrtTarget>().map { it.streamId })

class SessionRecordTest {
  private val lines = mutableListOf<String>()
  private val record = SessionRecord { lines += it }.apply { protectConfig(Configs.valid()) }
  private val secrets = listOf(Configs.TOKEN, Configs.PASSPHRASE, Configs.STREAM_ID, Configs.STREAM_KEY)

  private fun write(vararg fields: Pair<String, Any?>): String {
    record.append(1_790_778_725_123, RecordEntry("test", fields.toList()))
    return lines.last()
  }

  @Test
  fun `a line is one JSON object with at and kind first`() {
    val line = write("transport" to Transport.SRT, "attempt" to 3, "validated" to true, "fps" to 29.96)
    assertEquals("""{"at":"2026-09-30T14:32:05.123Z","kind":"test","transport":"srt","attempt":3,"validated":true,"fps":30.0}""", line)
  }

  @Test
  fun `P5 scrub rule - a public URL passes verbatim though the stream id is in it`() {
    assertTrue(Configs.PLAYBACK_URL in write("playbackUrl" to Configs.PLAYBACK_URL))
  }

  // Task 10 (CD6): was "the token is masked even inside a public URL", in place. A public URL now
  // passes whole or not at all; the test above still pins the stream id passing in a clean one.
  @Test
  fun `a public URL with a query is masked whole, so nothing in it reaches the line`() {
    // Fix round 1: so is the passphrase, raw and URL-encoded, which the brief masks everywhere.
    val url = "${Configs.PLAYBACK_URL}?tok=${Configs.TOKEN}&passphrase=${Configs.PASSPHRASE}&passphrase=pass%2Bphrase%2F6d1e8b0c"
    val line = write("playbackUrl" to url)
    assertFalse(Configs.TOKEN in line)
    assertEquals("""{"at":"2026-09-30T14:32:05.123Z","kind":"test","playbackUrl":"***"}""", line)
  }

  @Test
  fun `tok, passphrases, stream keys and stream ids never pass under their own names`() {
    val line =
      write("tok" to Configs.TOKEN, "passphrase" to Configs.PASSPHRASE, "streamKey" to Configs.STREAM_KEY, "streamId" to Configs.STREAM_ID)
    for (secret in secrets) assertFalse(secret in line, "leaked $secret")
  }

  @Test
  fun `a secret quoted in free text is masked, URL-encoded or not`() {
    val encoded = URLEncoder.encode(Configs.PASSPHRASE, "UTF-8")
    val quoted = "connect srt://live.cloudflare.com:778?streamid=${Configs.STREAM_ID}&passphrase=$encoded " +
      "rtmps://live.cloudflare.com:443/live/${Configs.STREAM_KEY} Bearer ${Configs.TOKEN}"
    val line = write("message" to quoted)
    for (secret in secrets + encoded) assertFalse(secret in line, "leaked $secret")
    assertTrue("live.cloudflare.com" in line)

    // Fix round 1. Every form is hand-written. Masked where it stands: the raw value, URLEncoder's
    // form (space as +), and the form android.net.Uri.encode writes (space as %20, ~ ! ' ( ) raw),
    // which srtdroid's SrtUri.Builder puts in the SRT query. Masked whole: a form that only
    // percent-decoding reveals.
    val inPlace = "passphrase=***"
    val whole = "***"
    val forms = listOf(
      Triple("correct horse battery", "correct horse battery", inPlace),
      Triple("correct horse battery", "correct+horse+battery", inPlace),
      Triple("correct horse battery", "correct%20horse%20battery", inPlace),
      Triple("pass/word~x1", "pass%2Fword~x1", inPlace),
      Triple("pass+word!x1", "pass%2Bword!x1", inPlace),
      Triple("pass=word(x)", "pass%3Dword(x)", inPlace),
      Triple("pass'word/x1", "pass'word%2Fx1", inPlace),
      Triple(Configs.PASSPHRASE, "pass%2bphrase%2f6d1e8b0c", whole), // lowercase hex
      Triple(Configs.PASSPHRASE, "pass%2Bphrase/6d1e8b0c", whole), // "/" left raw
      Triple("a b/c+d xyz", "a%20b/c+d%20xyz", whole), // %20 with a raw + and /
      Triple("a b/c~d xyz", "a+b%2Fc~d+xyz", whole), // + for a space, ~ raw
      Triple("trailing-pass/", "trailing-pass%2f", whole), // ends on an escape
      Triple("p\u00e4ssw\u00f6rd-x1", "p%c3%a4ssw%c3%b6rd-x1", whole), // two-byte UTF-8, lowercase
      Triple("100%z5%5z-pass+x1", "100%z5%5z-pass%2bx1", whole), // a literal % that is not an escape
    )
    for ((passphrase, form, expected) in forms) {
      val out = mutableListOf<String>()
      val srt = SrtTarget("srt://live.cloudflare.com:778", Configs.STREAM_ID, passphrase, latencyMs = 2_000)
      SessionRecord { out += it }
        .apply { protectConfig(Configs.valid(primary = srt)) }
        .append(0, RecordEntry("test", listOf("message" to "passphrase=$form")))
      assertEquals("""{"at":"1970-01-01T00:00:00.000Z","kind":"test","message":"$expected"}""", out.single(), form)
    }
  }

  // Task 10 (carry 11): text reads a value as JS's readingsOf does. URLEncoder writes "fake pass+0002"
  // as fake+pass%2B0002; with the escape in lowercase no form matches in place, and only reading + as a
  // space before decoding shows it. Before Task 10 native wrote this line as it stood; JS masks it.
  @Test
  fun `text masks a secret whole when only reading + as a space, then decoding, reveals it`() {
    val out = mutableListOf<String>()
    val srt = SrtTarget("srt://live.cloudflare.com:778", Configs.STREAM_ID, "fake pass+0002", latencyMs = 2_000)
    SessionRecord { out += it }
      .apply { protectConfig(Configs.valid(primary = srt)) }
      .append(0, RecordEntry("test", listOf("message" to "passphrase=fake+pass%2b0002")))
    assertEquals("""{"at":"1970-01-01T00:00:00.000Z","kind":"test","message":"***"}""", out.single())
  }

  @Test
  fun `a stray percent sign is kept as it is, neither decoded nor refused`() {
    val line = write("message" to "100% done, %zz, and a trailing %2")
    assertEquals("""{"at":"2026-09-30T14:32:05.123Z","kind":"test","message":"100% done, %zz, and a trailing %2"}""", line)
  }

  @Test
  fun `a string under a key the record does not know is masked`() {
    assertTrue(""""surprise":"***"""" in write("surprise" to "anything"))
  }

  @Test
  fun `a value of a type the record does not know is masked, not stringified`() {
    assertTrue(""""transport":"***"""" in write("transport" to listOf(Configs.srt)))
  }

  @Test
  fun `no key on an allow-list is also on the never list`() {
    val allowed = SessionRecord.PUBLIC_URL_KEYS + SessionRecord.TEXT_KEYS + SessionRecord.PLAIN_KEYS
    assertTrue(allowed.intersect(SessionRecord.NEVER).isEmpty())
  }

  @Test
  fun `a newline in free text cannot split a line`() {
    val line = write("message" to "first\nsecond")
    assertEquals(1, line.lines().size)
  }

  @Test
  fun `the last 20 lines are kept for Diagnostics`() {
    repeat(25) { write("attempt" to it) }
    val last = record.lastLines()
    assertEquals(20, last.size)
    assertTrue(last.first().endsWith(""""attempt":5}"""))
    assertTrue(last.last().endsWith(""""attempt":24}"""))
  }

  @Test
  fun `a sink that throws is counted and never throws out`() {
    val broken = SessionRecord { throw IllegalStateException("disk full") }
    broken.append(0, RecordEntry("armed"))
    broken.append(0, RecordEntry("connecting"))
    assertEquals(2, broken.sinkFailures)
    assertEquals(2, broken.lastLines().size)
  }

  // Beyond the brief (B5): each test below kills a mutant the eleven above leave alive, or answers one
  // of AGENTS §10's four questions. Expected lines are literal; the ISO strings came from `date -u -r`.

  @Test
  fun `a key on the never list is masked whatever the type of its value`() {
    val never = listOf("tok", "token", "passphrase", "streamKey", "streamId", "bearer", "authorization")
    val values = listOf(7, 7L, true, null, Transport.SRT, Decimal.tenths(1.5), 1.5)
    for (key in never) {
      for (value in values) {
        assertEquals("""{"at":"2026-09-30T14:32:05.123Z","kind":"test","$key":"***"}""", write(key to value), "$key = $value")
      }
    }
  }

  // Task 10 (CD6): was "… and a NaN is written as null". JS masks a non-finite number; so does native.
  @Test
  fun `a long, a null and a Decimal pass under any key, and a NaN is masked, as JS masks it`() {
    val line = write("dataUsedBytes" to 5_000_000_000L, "thermalStatus" to null, "headroom" to Decimal.tenths(1.5), "drain" to Double.NaN)
    assertEquals(
      """{"at":"2026-09-30T14:32:05.123Z","kind":"test","dataUsedBytes":5000000000,"thermalStatus":null,"headroom":1.5,"drain":"***"}""",
      line,
    )
  }

  // Task 10 (CD6): was "a plain key passes its text, with a secret in it masked", in place.
  @Test
  fun `a plain key passes a plain word, and masks anything else whole`() {
    val line = write("host" to "live.cloudflare.com", "reason" to "refused ${Configs.STREAM_KEY}")
    assertEquals("""{"at":"2026-09-30T14:32:05.123Z","kind":"test","host":"live.cloudflare.com","reason":"***"}""", line)
  }

  // Task 10 (CD6): was "every key on the allow-lists passes plain text" ("plain words" under each).
  // Each class now passes what its rule allows; a field named like a line key is written field_<key> (P1).
  @Test
  fun `every key passes what its class allows`() {
    fun writtenAs(key: String) = if (key in SessionRecord.RESERVED_KEYS) "field_$key" else key
    for (key in SessionRecord.PLAIN_KEYS) {
      assertEquals("""{"at":"2026-09-30T14:32:05.123Z","kind":"test","${writtenAs(key)}":"plain-word"}""", write(key to "plain-word"), key)
    }
    for (key in SessionRecord.PUBLIC_URL_KEYS) {
      val expected = """{"at":"2026-09-30T14:32:05.123Z","kind":"test","${writtenAs(key)}":"${Configs.PLAYBACK_URL}"}"""
      assertEquals(expected, write(key to Configs.PLAYBACK_URL), key)
    }
    for (key in SessionRecord.TEXT_KEYS) {
      assertEquals("""{"at":"2026-09-30T14:32:05.123Z","kind":"test","${writtenAs(key)}":"plain words"}""", write(key to "plain words"), key)
    }
  }

  @Test
  fun `RTMPS preferred - the stream id of the SRT fallback passes inside the public URL and nowhere else`() {
    val out = mutableListOf<String>()
    val rtmpsFirst = SessionRecord { out += it }.apply { protectConfig(Configs.valid(primary = Configs.rtmps, fallback = Configs.srt)) }
    val encoded = URLEncoder.encode(Configs.PASSPHRASE, "UTF-8")
    // Task 10 (CD6): the URL is a clean one now; one with a query is masked whole, whatever it holds.
    val fields = listOf(
      "playbackUrl" to Configs.PLAYBACK_URL,
      "message" to "streamid=${Configs.STREAM_ID} passphrase=$encoded key=${Configs.STREAM_KEY} Bearer ${Configs.TOKEN}",
    )
    rtmpsFirst.append(1_790_778_725_123, RecordEntry("test", fields))
    val expected = """{"at":"2026-09-30T14:32:05.123Z","kind":"test","playbackUrl":"${Configs.PLAYBACK_URL}",""" +
      """"message":"streamid=*** passphrase=*** key=*** Bearer ***"}"""
    assertEquals(expected, out.single())
  }

  // Task 10 (CD6): was "… masked in text and inside a public URL", in place.
  @Test
  fun `RTMPS only - the stream key and the token are masked in text, and a public URL carrying them is masked whole`() {
    val out = mutableListOf<String>()
    val rtmpsOnly = SessionRecord { out += it }.apply { protectConfig(Configs.valid(primary = Configs.rtmps, fallback = null)) }
    val fields = listOf(
      "playbackUrl" to "${Configs.PLAYBACK_URL}?key=${Configs.STREAM_KEY}&tok=${Configs.TOKEN}",
      "message" to "rtmps://live.cloudflare.com:443/live/${Configs.STREAM_KEY} Bearer ${Configs.TOKEN}",
    )
    rtmpsOnly.append(1_790_778_725_123, RecordEntry("test", fields))
    val expected = """{"at":"2026-09-30T14:32:05.123Z","kind":"test","playbackUrl":"***",""" +
      """"message":"rtmps://live.cloudflare.com:443/live/*** Bearer ***"}"""
    assertEquals(expected, out.single())
  }

  @Test
  fun `secrets from an earlier arm stay masked after a second arm`() {
    val secondToken = "tok-0a1b2c3d4e5f6789"
    val second = SessionConfig(
      sid = "sess_43",
      token = secondToken,
      primary = SrtTarget("srt://live.cloudflare.com:778", "ffeeddccbbaa99887766554433221100", "second+pass/7a8b9c0d", latencyMs = 2_000),
      fallback = null,
      holdWindowSeconds = mapOf(Transport.SRT to 183),
      playbackUrl = "https://customer-x.cloudflarestream.com/ffeeddccbbaa99887766554433221100/manifest/video.m3u8",
      heartbeatUrl = "https://stg.seazn.club/api/capture/heartbeat",
      appVersion = "1.0.0",
    )
    record.protectConfig(second)
    val line = write("playbackUrl" to "${Configs.PLAYBACK_URL}?tok=${Configs.TOKEN}", "message" to "first ${Configs.STREAM_KEY} second $secondToken")
    // Task 10 (CD6): the URL is masked whole now (it has a query); the message's point is unchanged.
    assertEquals(
      """{"at":"2026-09-30T14:32:05.123Z","kind":"test","playbackUrl":"***","message":"first *** second ***"}""",
      line,
    )
  }

  @Test
  fun `a secret that contains another is masked whole`() {
    val out = mutableListOf<String>()
    val keyWithId = "${Configs.STREAM_ID}k5e6f7a8b"
    val nested = SessionRecord { out += it }
      .apply { protectConfig(Configs.valid(fallback = RtmpsTarget("rtmps://live.cloudflare.com:443/live/", keyWithId))) }
    nested.append(1_790_778_725_123, RecordEntry("test", listOf("message" to "key $keyWithId")))
    assertEquals("""{"at":"2026-09-30T14:32:05.123Z","kind":"test","message":"key ***"}""", out.single())
  }

  @Test
  fun `the same entry written twice gives two scrubbed lines, and a repeated arm changes nothing`() {
    record.protectConfig(Configs.valid())
    val entry = RecordEntry("heartbeat", listOf("result" to HeartbeatResult.FAILED, "message" to "401 for Bearer ${Configs.TOKEN}"))
    record.append(1_790_778_725_123, entry)
    record.append(1_790_778_725_123, entry)
    val expected = """{"at":"2026-09-30T14:32:05.123Z","kind":"heartbeat","result":"failed","message":"401 for Bearer ***"}"""
    assertEquals(listOf(expected, expected), lines)
    assertEquals(listOf(expected, expected), record.lastLines())
  }

  @Test
  fun `an empty record holds nothing, and before any arm it still masks by key`() {
    val out = mutableListOf<String>()
    val empty = SessionRecord { out += it }
    assertEquals(emptyList(), empty.lastLines())
    assertEquals(0, empty.sinkFailures)
    empty.append(0, RecordEntry("armed"))
    empty.append(0, RecordEntry("armed", listOf("tok" to "x", "surprise" to "y")))
    assertEquals(
      listOf(
        """{"at":"1970-01-01T00:00:00.000Z","kind":"armed"}""",
        """{"at":"1970-01-01T00:00:00.000Z","kind":"armed","tok":"***","surprise":"***"}""",
      ),
      out,
    )
  }

  // A file append fails with IOException, a checked exception: the containment is not only for runtime ones.
  @Test
  fun `after a refused line the next one still reaches the sink`() {
    val out = mutableListOf<String>()
    var refuse = true
    val flaky = SessionRecord { line ->
      if (refuse) {
        refuse = false
        throw IOException("disk full")
      }
      out += line
    }
    flaky.append(0, RecordEntry("armed"))
    flaky.append(0, RecordEntry("connecting"))
    assertEquals(1, flaky.sinkFailures)
    assertEquals(listOf("""{"at":"1970-01-01T00:00:00.000Z","kind":"connecting"}"""), out)
    assertEquals(
      listOf("""{"at":"1970-01-01T00:00:00.000Z","kind":"armed"}""", """{"at":"1970-01-01T00:00:00.000Z","kind":"connecting"}"""),
      flaky.lastLines(),
    )
  }

  @Test
  fun `at capacity the ring drops old lines but the sink still gets every one`() {
    repeat(25) { write("attempt" to it) }
    assertEquals(25, lines.size)
    assertTrue(lines.first().endsWith(""""attempt":0}"""))
    assertEquals(20, record.lastLines().size)
  }

  // Fix round 1 (review of B5).

  @Test
  fun `a sink that appends once from inside terminates, in one order for the sink and lastLines`() {
    val out = mutableListOf<String>()
    lateinit var echoing: SessionRecord
    var echoed = false
    echoing = SessionRecord { line ->
      if (!echoed) {
        echoed = true
        echoing.append(0, RecordEntry("logger-echo"))
      }
      out += line
    }
    echoing.append(0, RecordEntry("armed"))
    val expected = listOf("""{"at":"1970-01-01T00:00:00.000Z","kind":"armed"}""", """{"at":"1970-01-01T00:00:00.000Z","kind":"logger-echo"}""")
    assertEquals(expected, out)
    assertEquals(expected, echoing.lastLines())
  }

  // The levelled logger feeds the record (AGENTS §11) and the record's sink feeds the logger. If that
  // loop closes, a queue alone would deliver echoes forever: one echo is written, the next is dropped.
  // The appends run on a daemon thread with a bounded join, so a loop that never ends fails the test
  // instead of hanging the build.
  @Test
  fun `a sink that appends for every line is cut after one echo, and the drop is counted`() {
    val out = mutableListOf<String>()
    lateinit var cyclic: SessionRecord
    cyclic = SessionRecord { line ->
      cyclic.append(0, RecordEntry("echo"))
      if (out.size < 100) out += line
    }
    val scheduler = Thread {
      cyclic.append(0, RecordEntry("armed"))
      cyclic.append(0, RecordEntry("connecting"))
    }
    scheduler.isDaemon = true
    scheduler.start()
    scheduler.join(10_000)
    assertFalse(scheduler.isAlive, "the sink loop never ended")
    val echo = """{"at":"1970-01-01T00:00:00.000Z","kind":"echo"}"""
    val expected = listOf("""{"at":"1970-01-01T00:00:00.000Z","kind":"armed"}""", echo, """{"at":"1970-01-01T00:00:00.000Z","kind":"connecting"}""", echo)
    assertEquals(expected, out)
    assertEquals(expected, cyclic.lastLines())
    assertEquals(2, cyclic.reentrantDropped)
  }

  @Test
  fun `two appends from inside the sink are written in the order they were made`() {
    val out = mutableListOf<String>()
    lateinit var echoing: SessionRecord
    echoing = SessionRecord { line ->
      if (out.isEmpty()) {
        echoing.append(0, RecordEntry("first-echo"))
        echoing.append(0, RecordEntry("second-echo"))
      }
      out += line
    }
    echoing.append(0, RecordEntry("armed"))
    val kinds = out.map { it.substringAfter(""""kind":"""").substringBefore('"') }
    assertEquals(listOf("armed", "first-echo", "second-echo"), kinds)
    assertEquals(out, echoing.lastLines())
  }

  @Test
  fun `an Error from the sink escapes append, and the next append still reaches the sink`() {
    val out = mutableListOf<String>()
    var failed = false
    val fragile = SessionRecord { line ->
      if (!failed) {
        failed = true
        TODO("sink not written")
      }
      out += line
    }
    assertFailsWith<NotImplementedError> { fragile.append(0, RecordEntry("armed")) }
    assertEquals(0, fragile.sinkFailures)
    fragile.append(0, RecordEntry("connecting"))
    assertEquals(listOf("""{"at":"1970-01-01T00:00:00.000Z","kind":"connecting"}"""), out)
  }

  @Test
  fun `a field named at or kind is written as field_at or field_kind, never twice`() {
    val line = write("kind" to Transport.SRT, "at" to 5)
    assertEquals("""{"at":"2026-09-30T14:32:05.123Z","kind":"test","field_kind":"srt","field_at":5}""", line)
  }

  // Task 10 (CD7): the JS line's shape. An info line keeps the shape every test above pins.
  @Test
  fun `a level other than info is written after the kind, and a field named level is written field_level`() {
    record.append(1_790_778_725_123, RecordEntry("probe", listOf("level" to 2, "ms" to 3), level = "warn"))
    assertEquals("""{"at":"2026-09-30T14:32:05.123Z","kind":"probe","level":"warn","field_level":2,"ms":3}""", lines.last())
  }

  // Review M4: the level is a caller's value; only the four the JS logger has are written.
  @Test
  fun `each of the other three levels is written as itself, and any other level is masked`() {
    for (level in listOf("debug", "warn", "error")) {
      record.append(1_790_778_725_123, RecordEntry("probe", level = level))
      assertEquals("""{"at":"2026-09-30T14:32:05.123Z","kind":"probe","level":"$level"}""", lines.last())
    }
    for (level in listOf(Configs.TOKEN, "fatal", "WARN", "")) {
      record.append(1_790_778_725_123, RecordEntry("probe", level = level))
      assertEquals("""{"at":"2026-09-30T14:32:05.123Z","kind":"probe","level":"***"}""", lines.last(), level)
    }
  }

  // Task 10 (CD6): was "the kind is masked by value like a field", in place ("connect ***").
  @Test
  fun `the kind is a plain word, or masked whole`() {
    record.append(1_790_778_725_123, RecordEntry(Configs.TOKEN))
    assertEquals("""{"at":"2026-09-30T14:32:05.123Z","kind":"***"}""", lines.last())
    // Not a word, and holding the stream id, a secret here: masked whole.
    record.append(1_790_778_725_123, RecordEntry("connect ${Configs.STREAM_ID}"))
    assertEquals("""{"at":"2026-09-30T14:32:05.123Z","kind":"***"}""", lines.last())
  }

  // Appends belong to the scheduler thread; Diagnostics reads from another. A fixed number of appends,
  // and at least 1,000 reads, so the run is bounded and nothing depends on timing to pass.
  @Test
  fun `lastLines and sinkFailures can be read from another thread while appends run`() {
    val shared = SessionRecord { if (""""kind":"refuse"""" in it) throw IllegalStateException("disk full") }
    val writer = Thread {
      repeat(5_000) { shared.append(0, RecordEntry(if (it % 2 == 0) "keep" else "refuse", listOf("attempt" to it))) }
    }
    var thrown: Throwable? = null
    var nulls = 0
    var reads = 0
    writer.start()
    while (writer.isAlive || reads < 1_000) {
      try {
        val last = shared.lastLines()
        if (last.size > 20) thrown = AssertionError("${last.size} lines")
        nulls += last.count { Objects.isNull(it) }
        if (shared.sinkFailures > 2_500) thrown = AssertionError("sinkFailures ${shared.sinkFailures}")
      } catch (failure: Throwable) {
        thrown = failure
      }
      reads += 1
    }
    writer.join()
    assertNull(thrown)
    assertEquals(0, nulls)
    assertEquals(2_500, shared.sinkFailures)
    assertTrue(shared.lastLines().last().endsWith(""""attempt":4999}"""))
  }
}
