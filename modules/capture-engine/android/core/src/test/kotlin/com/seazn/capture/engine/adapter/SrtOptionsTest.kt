package com.seazn.capture.engine.adapter

import com.seazn.capture.engine.core.Configs
import com.seazn.capture.engine.core.ConnectFailure
import com.seazn.capture.engine.core.SrtTarget
import java.io.IOException
import java.net.ConnectException
import java.net.SocketException
import java.net.URLEncoder
import java.net.UnknownHostException
import java.nio.channels.UnresolvedAddressException
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

class SrtOptionsTest {
  private fun target(url: String) = SrtTarget(url, Configs.STREAM_ID, Configs.PASSPHRASE, latencyMs = 2_000)

  /** A18: Cloudflare's own SRT host, which P5 proved. [Configs.srt] is on the staging `live.*` host. */
  private val cloudflare = target("srt://live.cloudflare.com:778")

  /** Both secrets, and the passphrase as a query string would carry it. */
  private val secrets = listOf(Configs.PASSPHRASE, Configs.STREAM_ID, URLEncoder.encode(Configs.PASSPHRASE, "UTF-8"))

  @Test
  fun `F-P5-11 MAXBW is in bytes per second, and is never among the options set before connect`() {
    val plan = SrtOptions.plan(Configs.srt, maxBw = 375_000)!!
    assertEquals(375_000, plan.maxBwBytesPerSecond)
    assertTrue(SrtOpt.INPUTBW to 0L in plan.before, "INPUTBW is written out: the cap is MAXBW's absolute value, never libsrt's estimate")
    assertTrue(plan.before.none { it.first == SrtOpt.MAXBW }, "MAXBW is set after connect, then on every SetMaxBw")
  }

  @Test
  fun `a connect with no cap is capped at the ceiling's`() {
    // SrtBandwidth at the 3 000 000 bps ceiling, worked by hand in plan B's LinkTest; read from there, not recomputed.
    assertEquals(899_300, SrtOptions.plan(Configs.srt, maxBw = null)!!.maxBwBytesPerSecond)
  }

  @Test
  fun `the secrets go in as socket options, never in a URL`() {
    for ((t, host) in listOf(cloudflare to "live.cloudflare.com", Configs.srt to "live.stg.seazn.club")) {
      val plan = SrtOptions.plan(t, 375_000)!!
      assertEquals(host, plan.host)
      assertEquals(778, plan.port)
      assertTrue(SrtOpt.STREAMID to Configs.STREAM_ID in plan.before)
      assertTrue(SrtOpt.PASSPHRASE to Configs.PASSPHRASE in plan.before)
      assertTrue(SrtOpt.LATENCY to 2_000 in plan.before)
    }
  }

  @Test
  fun `the options set before connect, in full`() {
    // CD14, written out from the brief: live mode, the secrets, the server's latency (not the fixtures'
    // usual 2 000, so it is read, never assumed), INPUTBW 0, libsrt's default overhead (25 %) named, and
    // a 6 s connect timeout.
    val expected =
      listOf(
        SrtOpt.TRANSTYPE_LIVE to true,
        SrtOpt.STREAMID to Configs.STREAM_ID,
        SrtOpt.PASSPHRASE to Configs.PASSPHRASE,
        SrtOpt.LATENCY to 1_234,
        SrtOpt.INPUTBW to 0L,
        SrtOpt.OHEADBW to 25,
        SrtOpt.CONNTIMEO to 6_000,
      )
    val target = SrtTarget("srt://live.cloudflare.com:778", Configs.STREAM_ID, Configs.PASSPHRASE, latencyMs = 1_234)
    assertEquals(expected, SrtOptions.plan(target, 375_000)!!.before)
  }

  @Test
  fun `neither secret is ever printed, by the plan or by a failure`() {
    val plan = SrtOptions.plan(cloudflare, 375_000)!!
    val printed = plan.toString()
    for (secret in secrets) assertFalse(secret in printed, "the plan printed $secret: $printed")
    assertTrue("live.cloudflare.com:778" in printed && "PASSPHRASE" in printed, "it names where and what: $printed")
    // A library quoting both, as a URL would carry them: classified, and nothing returned or thrown carries either.
    val quoted = "srt://live.cloudflare.com:778?streamid=${Configs.STREAM_ID}&passphrase=${secrets[2]} ${Configs.PASSPHRASE}"
    for (thrown in listOf(ConnectException("Connection setup failure: $quoted"), IllegalStateException(quoted))) {
      val outcome = runCatching { SrtOptions.failure(thrown) }
      val said = listOfNotNull(outcome.getOrNull()?.toString(), outcome.getOrNull()?.wire, outcome.exceptionOrNull()?.message)
      for (text in said) for (secret in secrets) assertFalse(secret in text, "failure() said $secret: $text")
      assertEquals(ConnectFailure.OTHER, outcome.getOrThrow())
    }
  }

  @Test
  fun `F-P5-1 a host that does not resolve is reported as unresolved, never as bad parameters`() {
    assertEquals(ConnectFailure.UNRESOLVED, SrtOptions.failure(UnknownHostException("live.cloudflare.com")))
    assertEquals(ConnectFailure.TIMEOUT, SrtOptions.failure(SocketException("Connection setup failure: connection timed out")))
    assertEquals(ConnectFailure.REFUSED, SrtOptions.failure(SocketException("Connection setup failure: connection rejected")))
    assertEquals(ConnectFailure.OTHER, SrtOptions.failure(IllegalStateException("bad parameters")))
  }

  @Test
  fun `I2 F-P5-1 a dead DNS is unresolved on either transport, bare or wrapped`() {
    // SRT: our sink resolves first (srtdroid would hand libsrt an unresolved address, which it reports as
    // "Bad parameters": F-P5-1), so its dead DNS is an UnknownHostException.
    assertEquals(ConnectFailure.UNRESOLVED, SrtOptions.failure(UnknownHostException("live.cloudflare.com")))
    assertEquals(ConnectFailure.UNRESOLVED, SrtOptions.failure(IOException("connect failed", UnknownHostException("live.cloudflare.com"))))
    // RTMPS: Ktor 3.3.3 builds java.net.InetSocketAddress(host, port), which leaves a failed lookup unresolved;
    // SocketChannel.connect then throws UnresolvedAddressException, with no message.
    assertEquals(ConnectFailure.UNRESOLVED, SrtOptions.failure(UnresolvedAddressException()))
    assertEquals(ConnectFailure.UNRESOLVED, SrtOptions.failure(IOException("connect failed", UnresolvedAddressException())))
    assertEquals(ConnectFailure.UNRESOLVED, SrtOptions.failure(RuntimeException(IOException(UnresolvedAddressException()))))
  }

  @Test
  fun `a failure's words are read in any case, and a bare timeout is a timeout`() {
    // Ktor's connect timeout says "timeout", not "timed out".
    assertEquals(ConnectFailure.TIMEOUT, SrtOptions.failure(IOException("Connect timeout has expired")))
    assertEquals(ConnectFailure.REFUSED, SrtOptions.failure(ConnectException("CONNECTION REFUSED")))
    assertEquals(ConnectFailure.TIMEOUT, SrtOptions.failure(ConnectException("Connection setup failure: Connection Timed Out")))
  }

  @Test
  fun `a failure is read through its causes, and one with no message is other`() {
    // srtdroid's connect (1.9.5, javap) throws java.net.ConnectException (a SocketException) with libsrt's last error.
    assertEquals(ConnectFailure.TIMEOUT, SrtOptions.failure(ConnectException("Connection setup failure: connection timed out")))
    // A wrapped lookup failure is still unresolved: F-P5-1's rule never counts it towards the fallback.
    assertEquals(ConnectFailure.UNRESOLVED, SrtOptions.failure(IOException("publish failed", UnknownHostException("h"))))
    assertEquals(ConnectFailure.REFUSED, SrtOptions.failure(IOException("publish failed", ConnectException("Connection refused"))))
    assertEquals(ConnectFailure.OTHER, SrtOptions.failure(IOException()))
  }

  @Test
  fun `a URL with no host or port does not plan`() {
    assertNull(SrtOptions.plan(SrtTarget("srt://", "s", "pppppppppp", 2_000), 1))
    assertNull(SrtOptions.plan(SrtTarget("rtmps://x:1", "s", "pppppppppp", 2_000), 1))
  }

  @Test
  fun `the scheme reads in any case, as the session shape's reader reads it (carry from Task 15)`() {
    for (url in listOf("srt://live.cloudflare.com:778", "SRT://live.cloudflare.com:778", "Srt://live.cloudflare.com:778")) {
      assertEquals("live.cloudflare.com" to 778, SrtOptions.plan(target(url), 375_000)?.let { it.host to it.port }, url)
    }
    // Bodies admits the host in either case too (BodiesTest's edge row); the plan names it lower-cased.
    assertEquals("live.stg.seazn.club" to 778, SrtOptions.plan(target("SRT://LIVE.STG.SEAZN.CLUB:778"), 1)?.let { it.host to it.port })
  }

  @Test
  fun `A18 SRT plans on exactly Cloudflare's host or a live host, with a port from 1 to 65535`() {
    val planned =
      listOf(
        "srt://live.cloudflare.com:778" to ("live.cloudflare.com" to 778),
        "srt://live.stg.seazn.club:778" to ("live.stg.seazn.club" to 778),
        "srt://live.seazn.club:778" to ("live.seazn.club" to 778),
        "srt://live.cloudflare.com:1" to ("live.cloudflare.com" to 1),
        "srt://live.cloudflare.com:65535" to ("live.cloudflare.com" to 65_535),
        // Bodies admits one to five digits, so a leading zero plans as the port it names.
        "srt://live.cloudflare.com:00778" to ("live.cloudflare.com" to 778),
      )
    for ((url, where) in planned) assertEquals(where, SrtOptions.plan(target(url), 1)?.let { it.host to it.port }, url)
  }

  @Test
  fun `lookalikes, userinfo, and a missing or non-numeric port do not plan`() {
    val refused =
      listOf(
        "",
        "srt://live.cloudflare.com.evil.example:778",
        "srt://evil.live.cloudflare.com:778",
        "srt://xlive.cloudflare.com:778",
        "srt://live-cloudflare.com:778",
        "srt://live.cloudflare.com.:778",
        "srt://live.stg.seazn.club.evil.example:778",
        "srt://evil.example:778",
        "srt://127.0.0.1:778",
        "srt://[::1]:778",
        "srt://live.cloudflare.com@evil.example:778",
        "srt://user@live.cloudflare.com:778",
        "srt://user:pw@live.cloudflare.com:778",
        "srt://live.cloudflare.com",
        "srt://live.cloudflare.com:",
        "srt://live.cloudflare.com:abc",
        "srt://live.cloudflare.com:77a",
        "srt://live.cloudflare.com:+778",
        "srt://live.cloudflare.com:-1",
        "srt://live.cloudflare.com:0",
        "srt://live.cloudflare.com:65536",
        "srt://live.cloudflare.com:778778",
        "srt://live.cloudflare.com:000778", // six digits, though its value is in range
        "srt://live.cloudflare.com:१०", // Devanagari digits, which Kotlin's toInt would read
        "srt://live.cloudflare.com:778/live",
        "srt://live.cloudflare.com:778?streamid=x",
        "srt://live.cloudflare.com:778#x",
        "srt://live.cloudflare.com:778 ",
        "srt://live.cloudflare.com:778\n",
        " srt://live.cloudflare.com:778",
        "srt://live.cloudflare.com :778",
        "ſrt://live.cloudflare.com:778", // the long s, which matches s under Unicode case folding
        "srtx://live.cloudflare.com:778",
        "rtmps://live.cloudflare.com:778",
        "srt:/live.cloudflare.com:778",
      )
    for (url in refused) assertNull(SrtOptions.plan(target(url), 1), url)
  }
}
