package com.seazn.capture.engine.core

/**
 * The build's environment, as the pair intent names it (CD36). Anything but `production` is
 * staging: the JS side's `seaznHosts` fails safe the same way, so a build that forgets the variable
 * refuses a club's real codes rather than trusting a staging one.
 */
enum class Environment(override val wire: String, val seaznHost: String) : Wire {
  PRODUCTION("production", "seazn.club"),
  STAGING("staging", "stg.seazn.club");

  companion object {
    fun of(wire: String?): Environment = if (wire == PRODUCTION.wire) PRODUCTION else STAGING
  }
}

/**
 * The amendment's host rules (_Who reads what_), one vector file for both languages. A host is
 * matched exactly and lower-cased: never a suffix, never a subdomain, never read through userinfo.
 */
object Hosts {
  /**
   * JS's `\s` (`wire.ts`'s `HTTPS_HOST`): Java's own `\s` is ASCII only, so the Unicode spaces JS also
   * stops a host at are listed. Without them `hostOf` would read a host JS refuses (review C0a, M1).
   */
  private const val SPACE = "\\s\\u00a0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000\\ufeff"

  /**
   * Read as JS reads `HTTPS_HOST`, edge for edge (review C0a, M1). The scheme's letters are ASCII,
   * listed both cases, with no `IGNORE_CASE`: Kotlin's adds `UNICODE_CASE`, under which `ſ` matches
   * `s`. This class is the one guard against a non-ASCII scheme letter (the `httpſ` row). The end is
   * `\z`: Java's `$` also matches before a final line break, which JS's does not.
   */
  private val SHAPE = Regex("^([A-Za-z][A-Za-z0-9+.-]*)://([^/?#@:\\\\$SPACE]+)(?::(\\d+))?(?:[/?#]|\\z)")

  /** The host of [url] when its scheme is [scheme]; null for any other scheme or shape. */
  fun hostOf(url: String, scheme: String): String? {
    val match = SHAPE.find(url) ?: return null
    // ASCII by SHAPE's class, so this compare never sees `ſ`: the class, not the compare, refuses it.
    if (!match.groupValues[1].equals(scheme, ignoreCase = true)) return null
    return match.groupValues[2].lowercase()
  }

  /** `heartbeatUrl`, `startUrl` and `codeUrl`: https on the build's Seazn host. */
  fun onSeazn(url: String, env: Environment): Boolean = hostOf(url, "https") == env.seaznHost

  /**
   * A `cred` URL: [scheme] on exactly [INGEST], whatever the environment. Owner ruling A, 2026-10-05: stg
   * dropped its custom ingest host (live.stg.seazn.club) and prd never had one (live.seazn.club), so the pin
   * trusts Cloudflare's host alone, for srt and rtmps both. The scheme stays each transport's own; the port is
   * not part of the pin.
   */
  fun onIngest(url: String, scheme: String): Boolean = hostOf(url, scheme) == INGEST

  /** Cloudflare's own ingest host, both transports, matched exactly: never a suffix (`live.cloudflare.com.evil`). */
  const val INGEST = "live.cloudflare.com"
}
