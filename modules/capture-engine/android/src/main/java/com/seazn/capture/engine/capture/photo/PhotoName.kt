package com.seazn.capture.engine.capture.photo

import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.Locale

/** R6: the gallery file's name. The phone's wall clock and nothing else; never the match, a side or a name. */
object PhotoName {
  private val FORMAT = DateTimeFormatter.ofPattern("yyyyMMdd_HHmmss", Locale.ROOT)

  fun of(wallMs: Long, zone: ZoneId): String = "Seazn_" + FORMAT.format(Instant.ofEpochMilli(wallMs).atZone(zone)) + ".jpg"
}
