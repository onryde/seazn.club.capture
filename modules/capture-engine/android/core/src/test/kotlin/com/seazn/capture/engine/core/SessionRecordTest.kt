package com.seazn.capture.engine.core

import java.io.IOException
import java.net.URLEncoder
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class SessionRecordTest {
  private val lines = mutableListOf<String>()
  private val record = SessionRecord { lines += it }.apply { protect(Configs.valid()) }
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

  @Test
  fun `the token is masked even inside a public URL`() {
    val line = write("playbackUrl" to "${Configs.PLAYBACK_URL}?tok=${Configs.TOKEN}")
    assertFalse(Configs.TOKEN in line)
    assertTrue(Configs.STREAM_ID in line)
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

  @Test
  fun `a long, a null and a Decimal pass under any key, and a NaN is written as null`() {
    val line = write("dataUsedBytes" to 5_000_000_000L, "thermalStatus" to null, "headroom" to Decimal.tenths(1.5), "drain" to Double.NaN)
    assertEquals(
      """{"at":"2026-09-30T14:32:05.123Z","kind":"test","dataUsedBytes":5000000000,"thermalStatus":null,"headroom":1.5,"drain":null}""",
      line,
    )
  }

  @Test
  fun `a plain key passes its text, with a secret in it masked`() {
    val line = write("host" to "live.cloudflare.com", "reason" to "refused ${Configs.STREAM_KEY}")
    assertEquals("""{"at":"2026-09-30T14:32:05.123Z","kind":"test","host":"live.cloudflare.com","reason":"refused ***"}""", line)
  }

  @Test
  fun `every key on the allow-lists passes plain text`() {
    val allowed = listOf(
      "playbackUrl", "overlayUrl", "message", "problems", "sid", "transport", "reason", "cause", "failure", "from", "to",
      "result", "state", "endReason", "delivery", "shed", "intent", "phase", "host", "appVersion",
    )
    for (key in allowed) {
      assertEquals("""{"at":"2026-09-30T14:32:05.123Z","kind":"test","$key":"plain words"}""", write(key to "plain words"), key)
    }
  }

  @Test
  fun `RTMPS preferred - the stream id of the SRT fallback passes inside the public URL and nowhere else`() {
    val out = mutableListOf<String>()
    val rtmpsFirst = SessionRecord { out += it }.apply { protect(Configs.valid(primary = Configs.rtmps, fallback = Configs.srt)) }
    val encoded = URLEncoder.encode(Configs.PASSPHRASE, "UTF-8")
    val fields = listOf(
      "playbackUrl" to "${Configs.PLAYBACK_URL}?tok=${Configs.TOKEN}",
      "message" to "streamid=${Configs.STREAM_ID} passphrase=$encoded key=${Configs.STREAM_KEY} Bearer ${Configs.TOKEN}",
    )
    rtmpsFirst.append(1_790_778_725_123, RecordEntry("test", fields))
    val expected = """{"at":"2026-09-30T14:32:05.123Z","kind":"test","playbackUrl":"${Configs.PLAYBACK_URL}?tok=***",""" +
      """"message":"streamid=*** passphrase=*** key=*** Bearer ***"}"""
    assertEquals(expected, out.single())
  }

  @Test
  fun `RTMPS only - the stream key and the token are masked in text and inside a public URL`() {
    val out = mutableListOf<String>()
    val rtmpsOnly = SessionRecord { out += it }.apply { protect(Configs.valid(primary = Configs.rtmps, fallback = null)) }
    val fields = listOf(
      "playbackUrl" to "${Configs.PLAYBACK_URL}?key=${Configs.STREAM_KEY}&tok=${Configs.TOKEN}",
      "message" to "rtmps://live.cloudflare.com:443/live/${Configs.STREAM_KEY} Bearer ${Configs.TOKEN}",
    )
    rtmpsOnly.append(1_790_778_725_123, RecordEntry("test", fields))
    val expected = """{"at":"2026-09-30T14:32:05.123Z","kind":"test","playbackUrl":"${Configs.PLAYBACK_URL}?key=***&tok=***",""" +
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
    record.protect(second)
    val line = write("playbackUrl" to "${Configs.PLAYBACK_URL}?tok=${Configs.TOKEN}", "message" to "first ${Configs.STREAM_KEY} second $secondToken")
    assertEquals(
      """{"at":"2026-09-30T14:32:05.123Z","kind":"test","playbackUrl":"${Configs.PLAYBACK_URL}?tok=***","message":"first *** second ***"}""",
      line,
    )
  }

  @Test
  fun `a secret that contains another is masked whole`() {
    val out = mutableListOf<String>()
    val keyWithId = "${Configs.STREAM_ID}k5e6f7a8b"
    val nested = SessionRecord { out += it }
      .apply { protect(Configs.valid(fallback = RtmpsTarget("rtmps://live.cloudflare.com:443/live/", keyWithId))) }
    nested.append(1_790_778_725_123, RecordEntry("test", listOf("message" to "key $keyWithId")))
    assertEquals("""{"at":"2026-09-30T14:32:05.123Z","kind":"test","message":"key ***"}""", out.single())
  }

  @Test
  fun `the same entry written twice gives two scrubbed lines, and a repeated arm changes nothing`() {
    record.protect(Configs.valid())
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
}
