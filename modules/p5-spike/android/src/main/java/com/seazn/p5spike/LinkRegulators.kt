package com.seazn.p5spike

import android.os.SystemClock
import android.util.Range
import io.github.thibaultbee.streampack.core.configuration.BitrateRegulatorConfig
import io.github.thibaultbee.streampack.core.elements.metrics.EndpointMetricsTracker
import io.github.thibaultbee.streampack.core.regulator.controllers.IBitrateRegulatorController
import io.github.thibaultbee.streampack.core.regulator.controllers.IntervalBitrateRegulatorController
import io.github.thibaultbee.streampack.ext.rtmp.regulator.RtmpBitrateRegulator
import io.github.thibaultbee.streampack.ext.srt.elements.endpoints.SrtRawMetrics
import io.github.thibaultbee.streampack.ext.srt.regulator.SrtBitrateRegulator
import kotlin.time.Duration.Companion.seconds

/**
 * F-P5-5's regulation, on StreamPack's own mechanism. `IntervalBitrateRegulatorController` polls a
 * transport's `BitrateRegulator`, and the regulator's change is applied to the running video encoder
 * (`MediaCodec.PARAMETER_KEY_VIDEO_BITRATE`).
 *
 * The decision is ours ([VideoBitratePolicy]), because nothing StreamPack 3.2.0 ships can react to
 * what Soak A showed (read in its sources jars):
 * - `DummySrtBitrateRegulator`, SRT's default, cannot climb back after a cut. It raises the target
 *   only from the floor: its raise branch is the `else` of `currentVideoBitrate > floor`. It reads a
 *   missing estimate (0 Mbps) as a link of zero and floors the target. And it cuts on the estimate
 *   alone, which Soak A shows reads below the sending rate on a healthy still scene.
 * - `SimpleBitrateRegulator` (core) reacts only to drops and losses, never to the send buffer.
 * - RTMP ships only the abstract `RtmpBitrateRegulator`.
 */
object LinkRegulators {
  /** The last target a regulator applied to the encoder; null when none is in force. */
  @Volatile var targetBps: Int? = null
    private set

  /**
   * This operator session's regulation, carried from attempt to attempt so a reconnect keeps its
   * target, its last cut and its failed rate. Replaced, never cleared, by [newSession]: a tick still
   * in flight from the last session writes to the old holder, which nothing reads again.
   */
  @Volatile private var session = CarriedRegulation()

  /** Once a second: the CSV's own cadence, so every change lines up with one sample row. */
  private val POLL = 1.seconds

  /**
   * RTMPS has no latency window to judge a backlog against. This is how long a cut waits before
   * drops can speak for the new rate: StreamPack's RTMP queue holds 10 FLV tags, well under a
   * second, so this is mostly the encoder settling on its new target.
   */
  private const val RTMP_DRAIN_MS = 2_000

  /** Every operator intent: a fresh session starts at [VideoBitratePolicy.START_BPS]. */
  fun newSession() {
    session = CarriedRegulation()
  }

  /** The target the next attempt starts at: the session's last, or the fresh-session start. */
  fun startBps(): Int = VideoBitratePolicy.attemptStarted(session.state).targetBps

  /** A new controller for one attempt on [transport], carrying this session's regulation. */
  fun controllerFactory(transport: String, srtLatencyMs: Int): IBitrateRegulatorController.Factory {
    val carried = session
    return IntervalBitrateRegulatorController.Factory(
      bitrateRegulatorFactory =
        if (transport == "srt") SrtLinkRegulator.Factory(srtLatencyMs, carried) else RtmpLinkRegulator.Factory(carried),
      // The same range the policy enforces, so StreamPack's own coercion never moves a target.
      bitrateRegulatorConfig = BitrateRegulatorConfig(
        videoBitrateRange = Range(VideoBitratePolicy.FLOOR_BPS, VideoBitratePolicy.CEILING_BPS),
        audioBitrateRange = Range(VideoBitratePolicy.AUDIO_BPS, VideoBitratePolicy.AUDIO_BPS),
      ),
      pollingTime = POLL,
    )
  }

  fun cleared() {
    targetBps = null
  }

  fun applied(bps: Int) {
    targetBps = bps
  }

  /** [RTMP_DRAIN_MS], for the RTMP regulator below. */
  internal val rtmpDrainMs: Int get() = RTMP_DRAIN_MS
}

/** One session's [Regulation], written by whichever attempt's regulator is ticking. */
internal class CarriedRegulation {
  @Volatile var state: Regulation? = null
}

/**
 * One attempt's regulation: reads the link, asks [VideoBitratePolicy], applies the answer.
 *
 * It never throws. StreamPack's `CoroutineScheduler` runs each tick in a scope with no exception
 * handler, so a throw would crash the process, and the broadcast with it. The likeliest throw is
 * `setParameters` before the codec has started; the next tick simply tries again.
 */
private class AttemptRegulation(private val latencyMs: Int, private val carried: CarriedRegulation) {
  private var regulation: Regulation? = null

  /**
   * The encoder object keeps the last target across a reconnect, but `MediaCodecEncoder.reset()`
   * reconfigures the codec at its start bitrate. So the first tick always applies, and the codec
   * and the target agree again.
   */
  private var applied = false

  @Synchronized
  fun update(encoderTargetBps: Int, read: () -> LinkSample?, apply: (Int) -> Unit) {
    try {
      val state = regulation ?: VideoBitratePolicy.attemptStarted(carried.state)
      val next = VideoBitratePolicy.next(state, read(), SystemClock.elapsedRealtime(), latencyMs)
      regulation = next
      carried.state = next
      if (!applied || next.targetBps != encoderTargetBps) {
        apply(next.targetBps)
        applied = true
      }
      LinkRegulators.applied(next.targetBps)
    } catch (failure: Throwable) {
      // Unapplied: the encoder keeps its target, and the next tick decides again.
    }
  }
}

/** Packets since the last reading, from a cumulative counter; a counter that went backwards is none. */
private class CounterDelta {
  private var lastTotal: Long? = null

  fun since(total: Long): Long {
    val previous = lastTotal ?: total
    lastTotal = total
    return (total - previous).coerceAtLeast(0)
  }
}

/**
 * Bits per second from the endpoint's cumulative byte counter over the real interval between
 * readings, exactly as `SpikeTelemetry` computes column 13. Null on the first reading, or when the
 * counter went backwards: no interval to judge.
 */
private class EgressMeter {
  private var lastBytes: Long? = null
  private var lastAtMs = 0L

  fun bitsPerSecond(totalBytes: Long): Long? {
    val atMs = SystemClock.elapsedRealtime()
    val previous = lastBytes
    val elapsedMs = atMs - lastAtMs
    lastBytes = totalBytes
    lastAtMs = atMs
    if (previous == null || elapsedMs <= 0 || totalBytes < previous) return null
    return (totalBytes - previous) * 8_000 / elapsedMs
  }
}

private class SrtLinkRegulator(
  metricsTracker: EndpointMetricsTracker,
  bitrateRegulatorConfig: BitrateRegulatorConfig,
  onVideoTargetBitrateChange: (Int) -> Unit,
  onAudioTargetBitrateChange: (Int) -> Unit,
  latencyMs: Int,
  carried: CarriedRegulation,
) : SrtBitrateRegulator(metricsTracker, bitrateRegulatorConfig, onVideoTargetBitrateChange, onAudioTargetBitrateChange) {
  private val regulation = AttemptRegulation(latencyMs, carried)
  private val drops = CounterDelta()
  private val losses = CounterDelta()
  private val egress = EgressMeter()

  override fun update(currentVideoBitrate: Int, currentAudioBitrate: Int) =
    regulation.update(currentVideoBitrate, ::read, onVideoTargetBitrateChange)

  /**
   * One `srt_bistats`, never cleared: SpikeTelemetry reads the same socket's counters. Null while no
   * SRT socket is connected, which holds the target. `byteSentTotal` is what column 13's
   * `bytesWritten` is built from (`SrtEndpointMetrics`), retransmits included.
   */
  private fun read(): LinkSample? {
    val raw = metricsTracker.rawMetrics as? SrtRawMetrics ?: return null
    val stats = raw.bistatsOrNull(clear = false, instantaneous = true) ?: return null
    return LinkSample(
      droppedPackets = drops.since(stats.pktSndDropTotal.toLong()),
      lostPackets = losses.since(stats.pktSndLossTotal.toLong()),
      sendBufferMs = stats.msSndBuf,
      bandwidthBps = (stats.mbpsBandwidth * 1_000_000).toLong(),
      egressBps = egress.bitsPerSecond(stats.byteSentTotal),
    )
  }

  class Factory(private val latencyMs: Int, private val carried: CarriedRegulation) : SrtBitrateRegulator.Factory {
    override fun newBitrateRegulator(
      metricsTracker: EndpointMetricsTracker,
      bitrateRegulatorConfig: BitrateRegulatorConfig,
      onVideoTargetBitrateChange: (Int) -> Unit,
      onAudioTargetBitrateChange: (Int) -> Unit,
    ): SrtBitrateRegulator = SrtLinkRegulator(
      metricsTracker, bitrateRegulatorConfig, onVideoTargetBitrateChange, onAudioTargetBitrateChange, latencyMs, carried,
    )
  }
}

/**
 * RTMPS over TCP has no send buffer or estimate to read. StreamPack's `RtmpEndpoint` puts FLV tags
 * through a 10-tag channel with `DROP_OLDEST`, and counts every tag it drops into
 * `messagesSendDropped` = `packetsWriteDropped`. Verified in the 3.2.0 sources, and in the cached jar
 * (`frameDropped`, `getSyncMetrics`). A socket that cannot keep up therefore shows as drops, and only
 * as drops. `RtmpEndpointMetrics` reports `packetsWriteLost` as 0, so losses never make it unclean.
 */
private class RtmpLinkRegulator(
  metricsTracker: EndpointMetricsTracker,
  bitrateRegulatorConfig: BitrateRegulatorConfig,
  onVideoTargetBitrateChange: (Int) -> Unit,
  onAudioTargetBitrateChange: (Int) -> Unit,
  carried: CarriedRegulation,
) : RtmpBitrateRegulator(metricsTracker, bitrateRegulatorConfig, onVideoTargetBitrateChange, onAudioTargetBitrateChange) {
  private val regulation = AttemptRegulation(LinkRegulators.rtmpDrainMs, carried)
  private val drops = CounterDelta()
  private val losses = CounterDelta()
  private val egress = EgressMeter()

  override fun update(currentVideoBitrate: Int, currentAudioBitrate: Int) =
    regulation.update(currentVideoBitrate, ::read, onVideoTargetBitrateChange)

  private fun read(): LinkSample {
    val cumulative = metricsTracker.cumulative
    return LinkSample(
      droppedPackets = drops.since(cumulative.packetsWriteDropped),
      lostPackets = losses.since(cumulative.packetsWriteLost),
      sendBufferMs = null,
      bandwidthBps = null,
      egressBps = egress.bitsPerSecond(cumulative.bytesWritten),
    )
  }

  class Factory(private val carried: CarriedRegulation) : RtmpBitrateRegulator.Factory {
    override fun newBitrateRegulator(
      metricsTracker: EndpointMetricsTracker,
      bitrateRegulatorConfig: BitrateRegulatorConfig,
      onVideoTargetBitrateChange: (Int) -> Unit,
      onAudioTargetBitrateChange: (Int) -> Unit,
    ): RtmpBitrateRegulator =
      RtmpLinkRegulator(metricsTracker, bitrateRegulatorConfig, onVideoTargetBitrateChange, onAudioTargetBitrateChange, carried)
  }
}
