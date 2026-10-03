package com.seazn.capture.engine.adapter

import com.seazn.capture.engine.core.BeatBattery
import com.seazn.capture.engine.core.ShedStep
import java.nio.ByteBuffer
import java.nio.ByteOrder
import kotlin.test.Test
import kotlin.test.assertEquals

class DeviceReadingsTest {
  private fun pcm(vararg samples: Short): ByteBuffer =
    ByteBuffer.allocate(samples.size * 2).order(ByteOrder.LITTLE_ENDIAN).apply {
      samples.forEach { putShort(it) }
      flip()
    }

  private fun raw(status: Int? = 1, headroom: Float? = 0.5f, percent: Int? = 81, plugged: Boolean? = true) =
    RawDevice(status, headroom, percent, 2_000_000, plugged)

  @Test
  fun `the PCM peak is the largest magnitude over full scale, and reading it moves nothing`() {
    val buffer = pcm(100, -16_384, 8_000)
    assertEquals(0.5, PcmPeak.of(buffer)) // 16384 / 32768
    assertEquals(0, buffer.position())
    assertEquals(1.0, PcmPeak.of(pcm(Short.MIN_VALUE))) // -32768 is full scale
    assertEquals(0.0, PcmPeak.of(pcm()))
  }

  @Test
  fun `the meter keeps the highest peak until it is taken`() {
    val meter = PeakMeter()
    meter.offer(0.2)
    meter.offer(0.7)
    meter.offer(0.1)
    assertEquals(0.7, meter.take())
    assertEquals(0.0, meter.take())
  }

  @Test
  fun `a level that is not finite is no reading, so it cannot pass the sound check`() {
    val meter = PeakMeter()
    meter.offer(0.3)
    meter.offer(Double.POSITIVE_INFINITY)
    meter.offer(Double.NaN)
    assertEquals(0.3, meter.take())
    meter.offer(Double.POSITIVE_INFINITY)
    assertEquals(0.0, meter.take(), "an infinite level alone leaves the meter at its no-reading 0")
  }

  @Test
  fun `drain is charge used over the full charge, per hour, from 5 minutes on`() {
    val drain = ChargeDrain()
    // 2 000 000 µAh at 50 %: full is 4 000 000 µAh.
    drain.add(0, 2_000_000, 50)
    drain.add(240_000, 1_990_000, 50)
    assertEquals(null, drain.pctPerHour(), "under 5 minutes is no reading")
    // 600 000 ms is 1/6 h; 20 000 µAh used is 0.5 % of full; 0.5 × 6 = 3.0 % an hour.
    drain.add(600_000, 1_980_000, 50)
    assertEquals(3.0, drain.pctPerHour())
  }

  @Test
  fun `a rising charge or a missing counter is no drain reading`() {
    val rising = ChargeDrain().apply { add(0, 1_000_000, 50); add(600_000, 1_100_000, 52) }
    assertEquals(null, rising.pctPerHour())
    val missing = ChargeDrain().apply { add(0, null, 50); add(600_000, null, 49) }
    assertEquals(null, missing.pctPerHour())
    // BatteryManager reads an unsupported counter as 0 (target < P) or Long.MIN_VALUE: no counter either.
    val zero = ChargeDrain().apply { add(0, 0, 50); add(600_000, 0, 50) }
    assertEquals(null, zero.pctPerHour())
    val unsupported = ChargeDrain().apply { add(0, Long.MIN_VALUE, 50); add(600_000, Long.MIN_VALUE, 50) }
    assertEquals(null, unsupported.pctPerHour())
  }

  @Test
  fun `the baseline is the first sample with both a counter and a percent of 1 to 100`() {
    val drain = ChargeDrain()
    drain.add(0, 2_000_000, null) // no percent: no full charge to estimate
    drain.add(60_000, 1_990_000, 101) // past 100: not a percent
    drain.add(120_000, 1_980_000, 0) // 0 %: no full charge either (it would divide by 0)
    drain.add(240_000, 2_000_000, 50) // the baseline: full is 2 000 000 × 100 / 50 = 4 000 000 µAh
    // 840 000 − 240 000 = 600 000 ms = 1/6 h; 20 000 µAh is 0.5 % of full; 0.5 × 6 = 3.0 % an hour.
    drain.add(840_000, 1_980_000, 50)
    assertEquals(3.0, drain.pctPerHour())
  }

  @Test
  fun `R1 drain crosses within the beat's 0 to 1000 an hour, at each edge`() {
    // Full is 1 200 000 µAh (at 100 %); exactly 300 000 ms is the window's first reading, 1/12 h.
    // 1 000 000 µAh used is 83.33… % of full; × 12 = 1000.0 % an hour, kept at the bound.
    val atBound = ChargeDrain().apply { add(0, 1_200_000, 100); add(300_000, 200_000, 17) }
    assertEquals(1_000.0, DeviceReadings.sample(raw(), atBound).drainPctPerHour)
    // 1 000 100 µAh used: 1000.1 % an hour, past the bound: no reading, the battery still whole.
    val past = ChargeDrain().apply { add(0, 1_200_000, 100); add(300_000, 199_900, 17) }
    val sample = DeviceReadings.sample(raw(), past)
    assertEquals(null, sample.drainPctPerHour)
    assertEquals(BeatBattery(81, true, null), BeatBattery.of(sample))
    // No charge used is a drain of 0, which is a reading, not none.
    val still = ChargeDrain().apply { add(0, 1_000_000, 50); add(600_000, 1_000_000, 50) }
    assertEquals(0.0, DeviceReadings.sample(raw(), still).drainPctPerHour)
  }

  @Test
  fun `thermal readings - NaN and negative headroom are none, and shedding follows the status`() {
    assertEquals(null, Thermal.headroom(Float.NaN))
    assertEquals(null, Thermal.headroom(-1f))
    assertEquals(0.75, Thermal.headroom(0.75f))
    assertEquals(null, Thermal.status(7))
    assertEquals(
      listOf(null, null, ShedStep.OVERLAY_PREVIEW, ShedStep.PREVIEW_FRAMERATE, ShedStep.ENCODE, ShedStep.ENCODE, ShedStep.ENCODE),
      (0..6).map { Thermal.shed(it) },
    )
  }

  @Test
  fun `the beat's thermal bound 0 to 6 at each edge, and headroom is finite and 0 or more`() {
    assertEquals(listOf(null, 0, 6, null, null), listOf(-1, 0, 6, 7, null).map { Thermal.status(it) })
    assertEquals(null, Thermal.headroom(Float.POSITIVE_INFINITY))
    assertEquals(null, Thermal.headroom(Float.NEGATIVE_INFINITY))
    assertEquals(0.0, Thermal.headroom(0f), "0 is no throttling, a reading")
    assertEquals(null, Thermal.headroom(null))
    // A status past the platform's 0 to 6 is no reading, so it sheds nothing.
    val sample = DeviceReadings.sample(raw(status = 9, headroom = Float.NaN), ChargeDrain())
    assertEquals(null, sample.thermalStatus)
    assertEquals(null, sample.thermalHeadroom)
    assertEquals(null, sample.shed)
    assertEquals(ShedStep.ENCODE, DeviceReadings.sample(raw(status = 4), ChargeDrain()).shed)
  }

  @Test
  fun `carry 5 the capture time is the frame's pts placed on the wall clock`() {
    // The frame was captured 40 ms before now (now 10 000 000 µs, pts 9 960 000 µs): wall 1 790 000 000 000 − 40.
    assertEquals(1_789_999_999_960, CaptureClock.epochMs(ptsUs = 9_960_000, monoNowUs = 10_000_000, wallNowMs = 1_790_000_000_000))
  }

  @Test
  fun `charging is the plug, not the battery's own flag`() {
    val sample = DeviceReadings.sample(RawDevice(1, 0.5f, 81, 2_000_000, plugged = true), ChargeDrain())
    assertEquals(true, sample.charging)
    assertEquals(81, sample.batteryPercent)
    assertEquals(null, sample.shed)
  }

  @Test
  fun `D2 a battery percent outside 0 to 100, or unread, is null and never 0, so the beat sends no battery`() {
    val percents = listOf(-1, 0, 100, 101, null).map { DeviceReadings.sample(raw(percent = it), ChargeDrain()).batteryPercent }
    assertEquals(listOf(null, 0, 100, null, null), percents)
    assertEquals(null, BeatBattery.of(DeviceReadings.sample(raw(percent = null), ChargeDrain())))
    assertEquals(null, BeatBattery.of(DeviceReadings.sample(raw(percent = -1), ChargeDrain())))
    assertEquals(null, BeatBattery.of(DeviceReadings.sample(raw(plugged = null), ChargeDrain())), "an unread plug is no battery either")
  }
}
