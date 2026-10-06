package com.seazn.capture.engine.adapter

import com.seazn.capture.engine.core.Shared
import java.io.File
import java.util.Locale
import kotlin.test.Test
import kotlin.test.assertEquals
import org.json.JSONObject

class NotificationTextTest {
  private val root = System.getProperty("capture.i18n") ?: error("capture.i18n is not set: run through Gradle")

  /** The app's own dictionary, `src/i18n/<language>.json`: every expected word below is read from it or copied from it. */
  private fun dictionary(language: String) = JSONObject(File(root, "$language.json").readText(Charsets.UTF_8))

  private val languages = listOf("en", "es", "fr", "nl")

  @Test
  fun `CD16 the notification reads state, target and minutes on air`() {
    // Live since 47 min 30 s ago: minutes are floored.
    assertEquals("LIVE · 3000k · 47 min", NotificationText.line("Live", 3_000, 1_790_000_000_000, 1_790_002_850_000, Locale.ENGLISH))
    assertEquals("CONNECTING", NotificationText.line("Connecting", null, null, 0, Locale.ENGLISH))
    assertEquals("EN DIRECTO · 1500k · 0 min", NotificationText.line("En directo", 1_500, 0, 59_000, Locale.forLanguageTag("es")))
  }

  @Test
  fun `a wall clock set back past the live start reads 0 min, never a negative`() {
    assertEquals("LIVE · 0 min", NotificationText.line("Live", null, 120_000, 0, Locale.ENGLISH))
  }

  /** Amendment §2's notification, written out, not read from the code. */
  private val keys =
    setOf(
      "stream.tally.starting",
      "stream.tally.connecting",
      "stream.tally.live",
      "stream.tally.trouble",
      "stream.tally.ended",
      "stream.notification.paired",
      "stream.status.notReadyCamera",
      "stream.status.notReadySound",
      "stream.status.notReadyNetwork",
      "stream.status.notReadyHeld",
    )

  @Test
  fun `the words are the app's own dictionary words, exactly the ten keys in each of the four languages`() {
    assertEquals(setOf("en", "es", "fr", "nl"), NotificationText.WORDS.keys)
    assertEquals(keys, NotificationText.KEYS.toSet())
    for ((language, words) in NotificationText.WORDS) {
      assertEquals(keys, words.keys, "$language holds every key and no other")
      val dictionary = dictionary(language)
      for ((key, word) in words) assertEquals(dictionary.getString(key), word, "$language $key")
    }
  }

  @Test
  fun `every key the notification shows exists in all four dictionaries`() {
    for (language in languages) {
      val dictionary = dictionary(language)
      for (key in NotificationText.KEYS) assertEquals(true, dictionary.has(key), "$language.json has $key")
    }
  }

  @Test
  fun `M18 the channel is named for the mode, in every language`() {
    assertEquals(setOf("en", "es", "fr", "nl"), NotificationText.CHANNEL.keys)
    for ((language, name) in NotificationText.CHANNEL) assertEquals(dictionary(language).getString("mode.stream"), name, language)
  }

  @Test
  fun `every state kind the wire can carry has its word, and an unknown kind reads starting`() {
    val kinds = Shared.read("wire/snapshot-vectors.json").getJSONObject("vocabulary").getJSONArray("state")
    val expected =
      mapOf(
        "idle" to "starting",
        "pairing" to "starting",
        "paired" to "paired",
        "arming" to "starting",
        "armed" to "starting",
        "connecting" to "connecting",
        "publishing" to "live",
        "degraded" to "trouble",
        "reconnecting" to "trouble",
        "ended" to "ended",
      )
    assertEquals(expected.keys, (0 until kinds.length()).map(kinds::getString).toSet())
    for ((kind, key) in expected) assertEquals(key, NotificationText.tallyKey(kind), kind)
    assertEquals("starting", NotificationText.tallyKey("exploded"))
    assertEquals("starting", NotificationText.tallyKey(null))
  }

  @Test
  fun `CD16 the notification is read from the wire the bridge publishes, so the glue holds no rule`() {
    val live =
      mapOf(
        "state" to mapOf("kind" to "publishing", "sinceEpochMs" to 1_790_000_000_000.0),
        "telemetry" to mapOf("targetBitrateKbps" to 3_000.0),
      )
    assertEquals("EN DIRECT · 3000k · 47 min", NotificationText.content(live, 1_790_002_850_000, "fr"))
    assertEquals("STARTING", NotificationText.content(mapOf("state" to mapOf("kind" to "exploded")), 0, "en"), "an unknown kind")
    assertEquals("STARTING", NotificationText.content(emptyMap(), 0, "en"), "no state at all")
  }

  /** As the projection fills the wire: a target bitrate only on air, which Connecting is not yet. */
  @Test
  fun `every kind on the wire, as the notification reads it`() {
    val now = 1_790_002_850_000
    val since = 1_790_000_000_000.0
    fun read(state: Map<String, Any?>, targetKbps: Double? = null) =
      NotificationText.content(mapOf("state" to state, "telemetry" to mapOf("targetBitrateKbps" to targetKbps)), now, "en")
    assertEquals("STARTING", read(mapOf("kind" to "idle")))
    assertEquals("STARTING", read(mapOf("kind" to "pairing")))
    assertEquals("Paired · waiting for Go live", read(mapOf("kind" to "paired")))
    assertEquals("STARTING", read(mapOf("kind" to "arming", "cause" to "organiser", "retrying" to true)))
    assertEquals("STARTING", read(mapOf("kind" to "armed", "cause" to "organiser", "notReady" to null)))
    assertEquals("CONNECTING", read(mapOf("kind" to "connecting", "transport" to "srt")))
    assertEquals("LIVE · 3000k · 47 min", read(mapOf("kind" to "publishing", "transport" to "srt", "sinceEpochMs" to since), 3_000.0))
    // Review 18 m1: the broadcast runs on through trouble, so its minutes do too (AGENTS §9).
    val degraded = mapOf("kind" to "degraded", "transport" to "srt", "reason" to "poor-uplink", "sinceEpochMs" to since)
    assertEquals("TROUBLE · 3000k · 47 min", read(degraded, 3_000.0))
    assertEquals("TROUBLE · 3000k · 47 min", read(mapOf("kind" to "reconnecting", "cause" to "uplink-lost", "sinceEpochMs" to since), 3_000.0))
    assertEquals("TROUBLE · 47 min", read(mapOf("kind" to "reconnecting", "cause" to "uplink-lost", "sinceEpochMs" to since)), "an outage before the first frame: no target yet")
    assertEquals("ENDED", read(mapOf("kind" to "ended", "reason" to "operator-stopped", "durationMs" to 60_000.0)))
  }

  @Test
  fun `amendment the paired line, then STARTING, with the not-ready line after it`() {
    val paired = mapOf("state" to mapOf("kind" to "paired"))
    assertEquals("Paired · waiting for Go live", NotificationText.content(paired, 0, "en"), "a sentence, not a plate: never upper-cased")
    assertEquals("Gekoppeld · wachten op de start", NotificationText.content(paired, 0, "nl"))
    val arming = mapOf("state" to mapOf("kind" to "arming", "cause" to "organiser", "retrying" to false))
    assertEquals("STARTING", NotificationText.content(arming, 0, "en"))
    val notReady = mapOf("state" to mapOf("kind" to "armed", "cause" to "organiser", "notReady" to "held", "sinceEpochMs" to 0.0))
    assertEquals("STARTING · Can't go live yet — turn the phone sideways", NotificationText.content(notReady, 1_790_002_850_000, "en"), "no minutes before live")
    val ready = mapOf("state" to mapOf("kind" to "armed", "cause" to "organiser", "notReady" to null))
    assertEquals("DÉMARRAGE", NotificationText.content(ready, 0, "fr"))
  }

  @Test
  fun `every not-ready check the wire can carry has its line, and an unknown one adds nothing`() {
    val checks = Shared.read("wire/snapshot-vectors.json").getJSONObject("vocabulary").getJSONArray("notReady")
    val lines =
      mapOf(
        "camera" to "stream.status.notReadyCamera",
        "sound" to "stream.status.notReadySound",
        "network" to "stream.status.notReadyNetwork",
        "held" to "stream.status.notReadyHeld",
      )
    assertEquals(lines.keys, (0 until checks.length()).map(checks::getString).toSet())
    val en = dictionary("en")
    for ((check, key) in lines) {
      val armed = mapOf("state" to mapOf("kind" to "armed", "cause" to "automatic", "notReady" to check))
      assertEquals("STARTING · ${en.getString(key)}", NotificationText.content(armed, 0, "en"), check)
    }
    val unknown = mapOf("state" to mapOf("kind" to "armed", "cause" to "automatic", "notReady" to "battery"))
    assertEquals("STARTING", NotificationText.content(unknown, 0, "en"), "never a raw key, never a throw")
  }

  @Test
  fun `each language reads its own dictionary's words`() {
    val live =
      mapOf(
        "state" to mapOf("kind" to "publishing", "transport" to "rtmps", "sinceEpochMs" to 0.0),
        "telemetry" to mapOf("targetBitrateKbps" to 2_500.0),
      )
    val trouble =
      mapOf(
        "state" to mapOf("kind" to "reconnecting", "cause" to "video-stalled", "holdRemainingSeconds" to 40.0, "sinceEpochMs" to 0.0),
        "telemetry" to mapOf("targetBitrateKbps" to 2_500.0),
      )
    for (language in languages) {
      val words = dictionary(language)
      val locale = Locale.forLanguageTag(language)
      fun plate(key: String) = words.getString("stream.tally.$key").uppercase(locale)
      val paired = mapOf("state" to mapOf("kind" to "paired"))
      assertEquals(words.getString("stream.notification.paired"), NotificationText.content(paired, 0, language), language)
      val held = mapOf("state" to mapOf("kind" to "armed", "cause" to "organiser", "notReady" to "held"))
      assertEquals("${plate("starting")} · ${words.getString("stream.status.notReadyHeld")}", NotificationText.content(held, 0, language), language)
      assertEquals("${plate("live")} · 2500k · 3 min", NotificationText.content(live, 180_000, language), language)
      assertEquals("${plate("trouble")} · 2500k · 3 min", NotificationText.content(trouble, 180_000, language), language)
      val ended = mapOf("state" to mapOf("kind" to "ended", "reason" to "fatal-error"))
      assertEquals(plate("ended"), NotificationText.content(ended, 0, language), language)
    }
  }

  // Carry from Task 11: the pairing's language crosses as "" when absent.
  @Test
  fun `an empty or unknown language reads as absent - English, never a raw key, never a throw`() {
    val en = dictionary("en")
    val paired = mapOf("state" to mapOf("kind" to "paired"))
    val armed = mapOf("state" to mapOf("kind" to "armed", "cause" to "organiser", "notReady" to "sound"))
    for (language in listOf("", "xx")) {
      assertEquals(en.getString("stream.notification.paired"), NotificationText.content(paired, 0, language), "'$language'")
      assertEquals("STARTING · ${en.getString("stream.status.notReadySound")}", NotificationText.content(armed, 0, language), "'$language'")
    }
  }

  // (P3 ruled 2026-10-01, widened by M5) The notification speaks the operator's language.
  @Test
  fun `P3 the pairing's language wins, then the phone's, then English`() {
    assertEquals("fr", NotificationText.language(pairLanguage = "fr", phoneLanguage = "es"))
    assertEquals("es", NotificationText.language(pairLanguage = "", phoneLanguage = "es"))
    assertEquals("es", NotificationText.language(pairLanguage = "de", phoneLanguage = "es"))
    assertEquals("en", NotificationText.language(pairLanguage = "de", phoneLanguage = "pt"))
  }

  @Test
  fun `P3 each of the four languages is kept, and nothing at all is English`() {
    for (language in languages) {
      assertEquals(language, NotificationText.language(pairLanguage = language, phoneLanguage = ""), "paired in $language")
      assertEquals(language, NotificationText.language(pairLanguage = "", phoneLanguage = language), "a $language phone")
    }
    assertEquals("en", NotificationText.language(pairLanguage = "", phoneLanguage = ""))
    assertEquals("en", NotificationText.language(pairLanguage = "xx", phoneLanguage = ""))
  }
}
