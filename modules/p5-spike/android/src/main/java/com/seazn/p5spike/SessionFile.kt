package com.seazn.p5spike

import android.content.Context
import android.net.Uri
import org.json.JSONObject
import java.io.File

data class SrtTarget(
  val host: String,
  val port: Int,
  val streamId: String,
  val passphrase: String?,
  val latencyMs: Int,
)

/** The payload `scripts/p5/cf.ts create` writes, pushed by adb. Never bundled. */
data class SessionFile(
  val srt: SrtTarget,
  val rtmpsUrl: String,
  val overlayUrl: String,
  val playbackUrl: String,
) {
  companion object {
    const val NAME = "p5-session.json"

    fun read(context: Context): SessionFile? {
      val file = File(context.getExternalFilesDir(null), NAME)
      if (!file.exists()) return null
      val json = JSONObject(file.readText())
      val srt = json.getJSONObject("srt")
      val rtmps = json.getJSONObject("rtmps")
      val srtUri = Uri.parse(srt.getString("url"))
      return SessionFile(
        srt = SrtTarget(
          host = requireNotNull(srtUri.host) { "srt.url has no host" },
          // Uri.port is -1 when the url omits it, and SrtUrl would then reject it with a
          // vaguer message from two libraries away. Fail here, where the payload is.
          port = srtUri.port.also { require(it > 0) { "srt.url has no port" } },
          streamId = srt.getString("streamId"),
          passphrase = srt.optString("passphrase").ifEmpty { null },
          latencyMs = srt.getInt("latencyMs"),
        ),
        rtmpsUrl = rtmps.getString("url").trimEnd('/') + "/" + rtmps.getString("streamKey"),
        overlayUrl = json.getString("overlayUrl"),
        playbackUrl = json.getString("playbackUrl"),
      )
    }
  }
}
