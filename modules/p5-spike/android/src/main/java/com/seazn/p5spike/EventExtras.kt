package com.seazn.p5spike

/**
 * Decides what each sink of an event gets: the CSV every extra scrubbed, JS every extra scrubbed
 * except the public URLs. Pure, so the decision is testable on the JVM with any scrub function.
 *
 * Why it exists (the output check's 404): scrubbing masks `srt.streamId`, and for Cloudflare the
 * stream id is the live input id, which is also a path segment of the public playback URL. JS used
 * to receive the scrubbed `armed` event, so the output check played a URL whose input id read
 * `***`, and Cloudflare answered 404 for every peek.
 */
object EventExtras {
  /**
   * The only extras JS receives unscrubbed. Both are public by construction — every viewer's
   * player has the playback URL and every overlay browser source has the overlay URL. A secret
   * shows up in the playback URL only because Cloudflare uses the live input id both as the SRT
   * stream id and as the playback path; it is no secret there.
   *
   * Nothing else belongs here: every other extra can carry a stream key, a passphrase or a URL a
   * library quoted in an error, and the scrub is the only guard between those and the screen. The
   * CSV stays scrubbed for these keys too, so a shared log never carries a live input id.
   */
  val PUBLIC_URL_KEYS: Set<String> = setOf("playbackUrl", "overlayUrl")

  data class Split(val csv: List<Pair<String, Any?>>, val js: List<Pair<String, Any?>>)

  fun split(extras: List<Pair<String, Any?>>, scrub: (Any?) -> Any?): Split {
    val csv = extras.map { (key, value) -> key to scrub(value) }
    val js = extras.zip(csv) { (key, raw), (_, scrubbed) -> key to if (key in PUBLIC_URL_KEYS) raw else scrubbed }
    return Split(csv, js)
  }
}
