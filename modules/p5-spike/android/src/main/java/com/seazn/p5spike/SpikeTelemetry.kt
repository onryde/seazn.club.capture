package com.seazn.p5spike

import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import android.os.BatteryManager
import android.os.Build
import android.os.PowerManager
import android.os.SystemClock
import io.github.thibaultbee.streampack.core.elements.metrics.WithEndpointMetrics
import io.github.thibaultbee.streampack.core.streamers.single.SingleStreamer
import io.github.thibaultbee.streampack.ext.srt.elements.endpoints.SrtEndpointMetrics
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch

/** 1 Hz, whether or not anything changed: the heartbeat contract (CaptureEnginePort). */
object SpikeTelemetry {
  fun start(context: Context, scope: CoroutineScope, onSample: (Map<String, Any?>) -> Unit) {
    scope.launch {
      val throughput = Throughput()
      var lastFailure: String? = null
      while (isActive) {
        try {
          onSample(sample(context, throughput))
          lastFailure = null
        } catch (failure: Throwable) {
          // A failed sample is a missing row, never a dead heartbeat. Logged once per distinct failure.
          val text = failure.toString()
          if (text != lastFailure) runCatching { SpikeSession.event("error", "message" to "sample failed: $text") }
          lastFailure = text
        }
        delay(1_000)
      }
    }
  }

  private fun sample(context: Context, throughput: Throughput): Map<String, Any?> {
    val power = context.getSystemService(PowerManager::class.java)
    val battery = context.registerReceiver(null, IntentFilter(Intent.ACTION_BATTERY_CHANGED))
    val streamer = SpikeSession.streamerFlow.value
    val streaming = streamer?.isStreamingFlow?.value ?: false
    return mapOf(
      "atMs" to System.currentTimeMillis(),
      "thermalStatus" to (if (Build.VERSION.SDK_INT >= 29) power.currentThermalStatus else -1),
      // NaN when polled faster than the platform allows; logged as-is, never smoothed.
      "thermalHeadroom" to (if (Build.VERSION.SDK_INT >= 30) power.getThermalHeadroom(10).toDouble() else -1.0),
      "batteryPercent" to percent(battery),
      // null, not 0.0: a missing reading must not read as a cold battery.
      "batteryTempC" to battery?.takeIf { it.hasExtra(BatteryManager.EXTRA_TEMPERATURE) }
        ?.getIntExtra(BatteryManager.EXTRA_TEMPERATURE, 0)?.div(10.0),
      "charging" to ((battery?.getIntExtra(BatteryManager.EXTRA_PLUGGED, 0) ?: 0) != 0),
      // Int.MIN_VALUE means unsupported (API 28+). Older platforms report 0 and cannot be told apart.
      "currentMicroAmps" to context.getSystemService(BatteryManager::class.java)
        .getIntProperty(BatteryManager.BATTERY_PROPERTY_CURRENT_NOW).takeUnless { it == Int.MIN_VALUE },
      "network" to network(context),
      "screenOn" to power.isInteractive,
      "streaming" to streaming,
      "transport" to SpikeSession.transport,
      "videoBitrate" to throughput.bitsPerSecond(if (streaming) bytesWritten(streamer) else null),
    ) + frames(streamer) + srt(streamer)
  }

  /**
   * Cumulative bytes the endpoint has sent, or null when it exposes no metrics. Through the
   * counting wrapper this is still the inner endpoint's figure: [CountingEndpoint] passes
   * `WithEndpointMetrics` through, and `CountingEndpointTest` holds this exact expression to it.
   */
  private fun bytesWritten(streamer: SingleStreamer?): Long? = runCatching {
    (streamer?.endpoint as? WithEndpointMetrics<*>)?.metrics?.bytesWritten
  }.getOrNull()

  /** Cumulative encoded frames handed to the endpoint (F-P5-4); null before arm creates one. */
  private fun frames(streamer: SingleStreamer?): Map<String, Any?> {
    val counts = (streamer?.endpoint as? CountingEndpoint)?.counts
    return mapOf("videoFrames" to counts?.videoFrames, "audioFrames" to counts?.audioFrames)
  }

  /**
   * SRT's own account of the socket, which egress cannot give: egress counts retransmissions, and
   * bytes handed to a socket with no network behind it (2026-09-14, nine seconds of network=none
   * at 3.5–4.5 Mbps). Reached by the same path as [bytesWritten]: DynamicEndpoint forwards
   * `metrics` to the open endpoint, the SRT one is a CompositeEndpointWithMetrics delegating to
   * SrtSink, and SrtSink's metrics are an [SrtEndpointMetrics] built from `srt_bstats`.
   *
   * All or nothing, and nothing unless the socket is connected: SrtEndpointMetrics reports a
   * disconnected socket as zeros (SrtStatsHelper.ZERO, uptime 0), and a dead socket must not read
   * as a clean one. `clear = false` so no other reader's interval counters are reset under it.
   */
  private fun srt(streamer: SingleStreamer?): Map<String, Any?> {
    val reading = runCatching {
      val metrics = (streamer?.endpoint as? WithEndpointMetrics<*>)?.metrics as? SrtEndpointMetrics
      val instant = metrics?.rawMetrics?.bistatsOrNull(clear = false, instantaneous = true)
      if (metrics == null || instant == null || !metrics.uptime.isPositive()) null else metrics to instant
    }.getOrNull()
    val metrics = reading?.first
    val instant = reading?.second
    return mapOf(
      "srtPacketsWritten" to metrics?.packetsWritten,
      "srtPacketsRetransmitted" to metrics?.packetsRetransmitted,
      "srtPacketsWriteLost" to metrics?.packetsWriteLost,
      "srtPacketsWriteDropped" to metrics?.packetsWriteDropped,
      "srtRttMs" to instant?.msRTT,
      "srtSndBufMs" to instant?.msSndBuf,
      "srtFlightSizePkts" to instant?.pktFlightSize,
      "srtBandwidthMbps" to instant?.mbpsBandwidth,
    )
  }

  private fun percent(battery: Intent?): Int {
    val level = battery?.getIntExtra(BatteryManager.EXTRA_LEVEL, -1) ?: -1
    val scale = battery?.getIntExtra(BatteryManager.EXTRA_SCALE, 100) ?: 100
    return if (level < 0) -1 else level * 100 / scale
  }

  /** Some Android 11 builds throw SecurityException here: one bad column, not a lost row. */
  private fun network(context: Context): String = runCatching {
    val connectivity = context.getSystemService(ConnectivityManager::class.java)
    val capabilities = connectivity.getNetworkCapabilities(connectivity.activeNetwork) ?: return@runCatching "none"
    when {
      capabilities.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) -> "wifi"
      capabilities.hasTransport(NetworkCapabilities.TRANSPORT_CELLULAR) -> "cellular"
      else -> "other"
    }
  }.getOrDefault("unknown")

  /**
   * Bits per second from a cumulative byte counter, scaled by the real
   * interval between readings (ticks drift; 1 000 ms is never assumed).
   * Touched only by the sampler coroutine.
   */
  private class Throughput {
    private var lastBytes: Long? = null
    private var lastAtMs = 0L

    /** 0 on the first reading, when unavailable, or when the counter went backwards (a reconnect resets it). */
    fun bitsPerSecond(bytes: Long?): Long {
      val atMs = SystemClock.elapsedRealtime()
      val previous = lastBytes
      val elapsedMs = atMs - lastAtMs
      lastBytes = bytes
      lastAtMs = atMs
      if (bytes == null || previous == null || elapsedMs <= 0) return 0
      val delta = bytes - previous
      return if (delta < 0) 0 else delta * 8_000 / elapsedMs
    }
  }
}
