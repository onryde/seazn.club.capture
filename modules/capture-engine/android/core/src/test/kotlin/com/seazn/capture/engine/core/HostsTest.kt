package com.seazn.capture.engine.core

import kotlin.test.Test
import kotlin.test.assertEquals

class HostsTest {
  @Test
  fun `every shared host row is judged as the file says, both roles`() {
    val rows = Shared.read("wire/host-vectors.json").getJSONArray("rows")
    val judged = mutableMapOf<String, Int>()
    for (i in 0 until rows.length()) {
      val row = rows.getJSONObject(i)
      val url = row.getString("url")
      val role = row.getString("role")
      val verdict =
        when (role) {
          "seazn" -> Hosts.onSeazn(url, Environment.of(row.getString("env")))
          // One ingest host for every environment (owner ruling A, 2026-10-05): an ingest row names none.
          else -> Hosts.onIngest(url, row.getString("scheme"))
        }
      assertEquals(row.getBoolean("ok"), verdict, url)
      judged.merge("$role ${row.getBoolean("ok")}", 1, Int::plus)
    }
    // The file's rows by role and verdict, so a truncated file or a one-sided table cannot pass (PV12).
    assertEquals(mapOf("seazn true" to 5, "seazn false" to 8, "ingest true" to 4, "ingest false" to 25), judged)
  }

  @Test
  fun `an environment that is not production is staging, as the JS side fails safe`() {
    assertEquals(Environment.STAGING, Environment.of(null))
    assertEquals(Environment.STAGING, Environment.of("prod"))
    assertEquals(Environment.PRODUCTION, Environment.of("production"))
  }

  @Test
  fun `a URL with userinfo has no host at all - it is refused, not read past the at sign`() {
    // The vector rows cannot see this: with or without the `@` exclusion, `stg.seazn.club@evil.io`
    // is never a Seazn host, so their verdict is the same. Only hostOf's own answer differs (review M1).
    assertEquals(null, Hosts.hostOf("https://stg.seazn.club@evil.io/x", "https"))
    assertEquals(null, Hosts.hostOf("srt://user@live.cloudflare.com:778", "srt"))
    assertEquals("stg.seazn.club", Hosts.hostOf("https://STG.seazn.club:8443/x", "https"))
  }

  @Test
  fun `hostOf stops where the JS rule stops - a final line break, a non-ASCII scheme letter, a Unicode space`() {
    // Each is null in wire.ts's httpsHost too (review C0a, M1). The vector rows pin the first two
    // verdicts; a host ending in a Unicode space never equals a Seazn host, so only hostOf can see it.
    assertEquals(null, Hosts.hostOf("https://stg.seazn.club\n", "https"))
    assertEquals(null, Hosts.hostOf("http\u017f://stg.seazn.club/x", "https"))
    assertEquals(null, Hosts.hostOf("https://stg.seazn.club\u00a0/x", "https"))
    assertEquals(null, Hosts.hostOf("srt://live.cloudflare.com:778\n", "srt"))
    assertEquals("stg.seazn.club", Hosts.hostOf("https://stg.seazn.club/x\n", "https"))
  }
}
