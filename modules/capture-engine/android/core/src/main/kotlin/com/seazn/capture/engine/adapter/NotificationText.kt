package com.seazn.capture.engine.adapter

import java.util.Locale

/**
 * The foreground service's notification, for the whole pairing (amendment §2, _Android
 * notification_; CD16): "Paired · waiting for Go live" while paired; the STARTING tally word in
 * Pairing, Arming and Armed, with the not-ready line after it; and `LIVE · 3000k · 47 min` from
 * Connecting on, the minutes running through trouble as the broadcast does (AGENTS §9; review 18
 * m1). Its language is the pairing's, then the phone's, then English (P3, M5).
 *
 * The words are the app's own dictionary words, copied from `src/i18n/` because the native side
 * cannot read the JS bundle; `NotificationTextTest` holds them equal, key for key. Pure: the glue
 * calls [content] with the snapshot wire it already publishes, and holds no rule (Task 38).
 */
object NotificationText {
  /** The ten dictionary keys the notification shows. A notification has no plate: no `ready` or `notReady` tally words. */
  val KEYS: List<String> =
    listOf(
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

  private val EN =
    mapOf(
      "stream.tally.starting" to "Starting",
      "stream.tally.connecting" to "Connecting",
      "stream.tally.live" to "Live",
      "stream.tally.trouble" to "Trouble",
      "stream.tally.ended" to "Ended",
      "stream.notification.paired" to "Paired · waiting for Go live",
      "stream.status.notReadyCamera" to "Can't go live yet — the camera isn't ready",
      "stream.status.notReadySound" to "Can't go live yet — no sound from the mic",
      "stream.status.notReadyNetwork" to "Can't go live yet — no network",
      "stream.status.notReadyHeld" to "Can't go live yet — turn the phone sideways",
    )

  /** Keyed by language, then by dictionary key. */
  val WORDS: Map<String, Map<String, String>> =
    mapOf(
      "en" to EN,
      "es" to
        mapOf(
          "stream.tally.starting" to "Iniciando",
          "stream.tally.connecting" to "Conectando",
          "stream.tally.live" to "En directo",
          "stream.tally.trouble" to "Problema",
          "stream.tally.ended" to "Terminado",
          "stream.notification.paired" to "Vinculado · esperando el directo",
          "stream.status.notReadyCamera" to "Aún no se puede emitir: la cámara no está lista",
          "stream.status.notReadySound" to "Aún no se puede emitir: el micro no da sonido",
          "stream.status.notReadyNetwork" to "Aún no se puede emitir: sin red",
          "stream.status.notReadyHeld" to "Aún no se puede emitir: móvil en horizontal",
        ),
      "fr" to
        mapOf(
          "stream.tally.starting" to "Démarrage",
          "stream.tally.connecting" to "Connexion",
          "stream.tally.live" to "En direct",
          "stream.tally.trouble" to "Problème",
          "stream.tally.ended" to "Terminé",
          "stream.notification.paired" to "Associé · en attente du direct",
          "stream.status.notReadyCamera" to "Pas encore de direct\u00a0: caméra non prête",
          "stream.status.notReadySound" to "Pas encore de direct\u00a0: aucun son du micro",
          "stream.status.notReadyNetwork" to "Pas encore de direct\u00a0: pas de réseau",
          "stream.status.notReadyHeld" to "Pas encore de direct\u00a0: tournez à l'horizontale",
        ),
      "nl" to
        mapOf(
          "stream.tally.starting" to "Starten",
          "stream.tally.connecting" to "Verbinden",
          "stream.tally.live" to "Live",
          "stream.tally.trouble" to "Probleem",
          "stream.tally.ended" to "Beëindigd",
          "stream.notification.paired" to "Gekoppeld · wachten op de start",
          "stream.status.notReadyCamera" to "Nog niet live: de camera is niet klaar",
          "stream.status.notReadySound" to "Nog niet live: geen geluid van de microfoon",
          "stream.status.notReadyNetwork" to "Nog niet live: geen netwerk",
          "stream.status.notReadyHeld" to "Nog niet live: draai de telefoon dwars",
        ),
    )

  /**
   * M18: the channel's name, the `mode.stream` word. Android fixes it when the channel is first
   * created, in the language of that moment, and shows it in the app's notification settings.
   */
  val CHANNEL: Map<String, String> =
    mapOf("en" to "Live Stream", "es" to "Emisión en directo", "fr" to "Diffusion en direct", "nl" to "Livestream")

  /** The wire's `notReady` check → its status line's key. */
  private val NOT_READY =
    mapOf(
      "camera" to "stream.status.notReadyCamera",
      "sound" to "stream.status.notReadySound",
      "network" to "stream.status.notReadyNetwork",
      "held" to "stream.status.notReadyHeld",
    )

  /**
   * P3, M5: the first of the two that [WORDS] holds, else English. [pairLanguage] is the pairing's
   * `language`, which `setLanguage` replaces (Task 6), and "" when it has none (Task 11).
   */
  fun language(pairLanguage: String, phoneLanguage: String): String =
    listOf(pairLanguage, phoneLanguage).firstOrNull { it in WORDS } ?: "en"

  /** The snapshot's `state.kind` → `paired`, or the tally key's last part. Any other kind, or none, is `starting`. */
  fun tallyKey(kind: String?): String =
    when (kind) {
      "paired" -> "paired"
      "connecting" -> "connecting"
      "publishing" -> "live"
      "degraded", "reconnecting" -> "trouble"
      "ended" -> "ended"
      else -> "starting"
    }

  /** The tally [word], upper-cased in [locale], then the target when known, then whole minutes on air. */
  fun line(word: String, targetKbps: Int?, liveSinceEpochMs: Long?, nowEpochMs: Long, locale: Locale): String {
    val parts = mutableListOf(word.uppercase(locale))
    if (targetKbps != null) parts += "${targetKbps}k"
    // A wall clock set back past the start reads 0, never a negative.
    if (liveSinceEpochMs != null) parts += "${((nowEpochMs - liveSinceEpochMs) / 60_000).coerceAtLeast(0)} min"
    return parts.joinToString(" · ")
  }

  /**
   * What the service shows, read from the snapshot [wire] the bridge publishes (numbers are Doubles
   * there). [language] is already resolved by [language]; anything [WORDS] does not hold reads as
   * English, so no raw key ever shows. The paired line is a sentence, as written, never a plate.
   * Minutes show once the broadcast is on air, live or in trouble, never before.
   */
  fun content(wire: Map<String, Any?>, nowEpochMs: Long, language: String): String {
    val resolved = language.takeIf { it in WORDS } ?: "en"
    val words = WORDS.getValue(resolved)
    val state = wire["state"] as? Map<*, *>
    val key = tallyKey(state?.get("kind") as? String)
    if (key == "paired") return words.getValue("stream.notification.paired")
    val since = if (key == "live" || key == "trouble") (state?.get("sinceEpochMs") as? Number)?.toLong() else null
    val kbps = ((wire["telemetry"] as? Map<*, *>)?.get("targetBitrateKbps") as? Number)?.toInt()
    val tally = line(words.getValue("stream.tally.$key"), kbps, since, nowEpochMs, Locale.forLanguageTag(resolved))
    val notReady = NOT_READY[state?.get("notReady")]?.let(words::getValue) ?: return tally
    return "$tally · $notReady"
  }
}
