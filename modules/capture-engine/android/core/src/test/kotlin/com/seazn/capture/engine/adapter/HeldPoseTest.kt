package com.seazn.capture.engine.adapter

import com.seazn.capture.engine.core.Pose
import com.seazn.capture.engine.core.Readiness
import com.seazn.capture.engine.core.Shared
import com.seazn.capture.engine.core.Side
import kotlin.math.cos
import kotlin.math.sin
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull
import org.json.JSONArray
import org.json.JSONObject

class HeldPoseTest {
  private val shared = Shared.read("wire/pose-vectors.json")

  private fun JSONObject.word(key: String): String? = if (isNull(key)) null else getString(key)

  private fun gravity(g: JSONArray) = Triple(g.getDouble(0), g.getDouble(1), g.getDouble(2))

  @Test
  fun `A11 every shared row, with its side`() {
    val rows = shared.getJSONArray("rows")
    // The file's count, so an emptied or truncated file cannot pass by sweeping nothing (PV12).
    assertEquals(24, rows.length())
    for (i in 0 until rows.length()) {
      val row = rows.getJSONObject(i)
      val (x, y, z) = gravity(row.getJSONArray("g"))
      val read = HeldPose.classify(x, y, z)
      assertEquals(row.word("physical"), read?.physical?.wire, row.getString("why"))
      assertEquals(row.word("side"), read?.side?.wire, row.getString("why"))
    }
    assertEquals(shared.getLong("holdMs"), HeldPose.HOLD_MS)
  }

  @Test
  fun `A11 every shared track, step by step, with its side`() {
    val tracks = shared.getJSONArray("tracks")
    assertEquals(8, tracks.length())
    for (i in 0 until tracks.length()) {
      val track = tracks.getJSONObject(i)
      val steps = track.getJSONArray("steps")
      val tracker = PoseTracker()
      for (s in 0 until steps.length()) {
        val step = steps.getJSONObject(s)
        val (x, y, z) = gravity(step.getJSONArray("g"))
        tracker.sample(x, y, z, step.getLong("atMs"))
        val label = "${track.getString("why")}, at ${step.getLong("atMs")} ms"
        assertEquals(step.getString("settled"), tracker.settled.physical.wire, label)
        assertEquals(step.word("side"), tracker.settled.side?.wire, label)
      }
    }
  }

  @Test
  fun `a reading settles after 300 ms, and a brief swing through the dead band does not flip it`() {
    val tracker = PoseTracker()
    assertEquals(Pose.NotHeld, tracker.pose, "nothing settled yet reads not held (A11's unknown)")
    assertNull(tracker.sample(1.0, 0.0, 0.0, 0))
    assertNull(tracker.sample(1.0, 0.0, 0.0, 299), "299 ms is not yet settled")
    assertEquals(Pose.Held(Side.LEFT), tracker.sample(1.0, 0.0, 0.0, 300))
    assertNull(tracker.sample(1.0, 0.0, 0.0, 400), "no change, no report")
    assertNull(tracker.sample(0.707, 0.707, 0.0, 500), "the dead band, for less than 300 ms: still held")
    assertNull(tracker.sample(0.0, 1.0, 0.0, 600), "upright, not yet settled: the settled side stands")
    assertNull(tracker.sample(0.0, 1.0, 0.0, 899), "the dead band restarted the hold")
    assertEquals(Pose.NotHeld, tracker.sample(0.0, 1.0, 0.0, 900))
  }

  @Test
  fun `PV17 a dip into the dead band restarts the hold, so returning to the same reading waits a full hold again`() {
    val tracker = PoseTracker()
    assertNull(tracker.sample(1.0, 0.0, 0.0, 0))
    assertNull(tracker.sample(0.707, 0.707, 0.0, 200), "45 degrees: the dead band")
    // Without the restart, 300 ms after the first reading would settle here.
    assertNull(tracker.sample(1.0, 0.0, 0.0, 300), "the hold runs from 300 now, not from 0")
    // Without the candidate's reset, the hold would run from the dip: 399 ms would settle here.
    assertNull(tracker.sample(1.0, 0.0, 0.0, 599), "299 ms of the new hold")
    assertEquals(Pose.Held(Side.LEFT), tracker.sample(1.0, 0.0, 0.0, 600))
  }

  private fun held(pose: Pose) = Readiness(cameraFrames = true, audioPeak = 1.0, pose = pose).held

  /** Gravity for a phone turned [deg] from upright in the screen's plane, as JS's orientation test builds it. */
  private fun tilted(deg: Double) = Math.toRadians(deg).let { Triple(sin(it), cos(it), 0.0) }

  private fun PoseTracker.at(g: Triple<Double, Double, Double>, monoMs: Long) = sample(g.first, g.second, g.third, monoMs)

  private val sideways = tilted(90.0)
  private val deadBand = tilted(45.0)

  /** Settled on its left side at 300 ms. */
  private fun settledLeft() = PoseTracker().apply {
    at(sideways, 0)
    assertEquals(Pose.Held(Side.LEFT), at(sideways, 300))
  }

  @Test
  fun `A11 knocked into the dead band, held drops only after 300 ms there`() {
    val tracker = settledLeft()
    assertNull(tracker.at(deadBand, 400), "knocked to 45 degrees in the screen's plane")
    assertNull(tracker.at(deadBand, 699), "299 ms in the dead band: still held")
    assertEquals(true, held(tracker.pose))
    assertEquals(Pose.NotHeld, tracker.at(deadBand, 700), "300 ms in the dead band: not held (A11)")
    assertEquals(false, held(tracker.pose))
    assertEquals(PoseReading(Physical.LANDSCAPE, Side.LEFT), tracker.settled, "the settled reading is JS's, and stands")
  }

  @Test
  fun `A11 back out of the dead band, held returns only after 300 ms out, settled sideways`() {
    val tracker = settledLeft()
    tracker.at(deadBand, 400)
    assertEquals(Pose.NotHeld, tracker.at(deadBand, 700))
    assertNull(tracker.at(sideways, 750), "back on its side")
    assertNull(tracker.at(sideways, 1_049), "299 ms out: still not held")
    assertEquals(false, held(tracker.pose))
    assertEquals(Pose.Held(Side.LEFT), tracker.at(sideways, 1_050), "300 ms out, still settled left: held")
    assertEquals(true, held(tracker.pose))
    // Reclined on the tripod into the flat dead band (0.9 / |(0.4, 0, 0.9)| = 0.914 of gravity through
    // the screen) for 300 ms, then out upright: out, but settled upright, so never held again.
    tracker.sample(0.4, 0.0, 0.9, 1_100)
    assertEquals(Pose.NotHeld, tracker.sample(0.4, 0.0, 0.9, 1_400))
    assertNull(tracker.sample(0.0, 1.0, 0.0, 1_450))
    assertNull(tracker.sample(0.0, 1.0, 0.0, 1_750), "300 ms out and upright settled: not held, nothing to report")
    assertEquals(Physical.PORTRAIT, tracker.settled.physical)
  }

  @Test
  fun `N1 a wobble across the 60 degree edge flips held only on runs of 300 ms`() {
    val tracker = settledLeft()
    // 59.9 degrees from upright is the dead band; 60.1 is sideways, the left side. One sample every
    // 60 ms (SENSOR_DELAY_UI). A run of n samples spans (n - 1) × 60 ms, so it takes 6 to reach 300 ms.
    val inBand = tilted(59.9)
    val out = tilted(60.1)
    var t = 300L
    val reports = mutableListOf<Pose>()
    fun run(g: Triple<Double, Double, Double>, samples: Int) = repeat(samples) {
      t += 60
      tracker.at(g, t)?.let(reports::add)
    }
    // 60 s alternating every sample, the reviewer's mount: 1000 samples, no run longer than 1.
    repeat(500) { run(inBand, 1); run(out, 1) }
    assertEquals(0, reports.size, "60 s of one-sample wobble flips nothing")
    // Ten runs of 5 each way: 240 ms each, short of 300.
    repeat(10) { run(inBand, 5); run(out, 5) }
    assertEquals(0, reports.size, "runs of 240 ms flip nothing")
    // Ten runs of 6 each way: each reaches 300 ms on its sixth sample, so each flips once: 20 reports.
    repeat(10) { run(inBand, 6); run(out, 6) }
    assertEquals(List(10) { listOf(Pose.NotHeld, Pose.Held(Side.LEFT)) }.flatten(), reports)
    assertEquals(PoseReading(Physical.LANDSCAPE, Side.LEFT), tracker.settled)
  }

  @Test
  fun `settled sideways and still sideways stays held, with nothing to report`() {
    val tracker = PoseTracker()
    tracker.sample(-1.0, 0.0, 0.0, 0)
    assertEquals(Pose.Held(Side.RIGHT), tracker.sample(-1.0, 0.0, 0.0, 300))
    assertNull(tracker.sample(-1.0, 0.0, 0.0, 400))
    assertNull(tracker.sample(-0.9, 0.1, 0.4, 5_000), "still sideways, tilted back on the tripod")
    assertEquals(Pose.Held(Side.RIGHT), tracker.pose)
    assertEquals(true, held(tracker.pose))
  }

  @Test
  fun `no sensor never blocks, and nothing settled yet does`() {
    assertEquals(true, held(Pose.NoSensor))
    assertEquals(false, held(PoseTracker().pose))
  }

  @Test
  fun `turning from one side to the other is a new pose`() {
    val tracker = PoseTracker()
    tracker.sample(1.0, 0.0, 0.0, 0)
    tracker.sample(1.0, 0.0, 0.0, 300)
    tracker.sample(-1.0, 0.0, 0.0, 400)
    assertEquals(Pose.Held(Side.RIGHT), tracker.sample(-1.0, 0.0, 0.0, 700))
  }

  @Test
  fun `flat is not held, so the blocker shows`() {
    val tracker = PoseTracker()
    tracker.sample(1.0, 0.0, 0.0, 0)
    assertEquals(Pose.Held(Side.LEFT), tracker.sample(1.0, 0.0, 0.0, 300), "held sideways first")
    assertNull(tracker.sample(0.0, 0.0, 1.0, 400), "laid on the table: not yet settled")
    assertEquals(Pose.NotHeld, tracker.sample(0.0, 0.0, 1.0, 700), "flat, settled: a change from held, reported")
    assertEquals(Pose.NotHeld, tracker.pose)
    assertEquals(Physical.FLAT, tracker.settled.physical)
  }

  @Test
  fun `a settled reading that leaves the pose as it was reports nothing`() {
    val tracker = PoseTracker()
    tracker.sample(0.0, 1.0, 0.0, 0)
    assertNull(tracker.sample(0.0, 1.0, 0.0, 300), "upright settles, but not held before is not held after")
    assertEquals(Physical.PORTRAIT, tracker.settled.physical)
    tracker.sample(0.0, 0.0, 1.0, 400)
    assertNull(tracker.sample(0.0, 0.0, 1.0, 700), "upright to flat: still not held")
    assertEquals(Physical.FLAT, tracker.settled.physical)
  }

  @Test
  fun `a reading that is not finite is the dead band, never a pose`() {
    val nan = Double.NaN
    val inf = Double.POSITIVE_INFINITY
    // Without the guard, (∞, 0, 0) would read landscape and (0, ∞, 0) portrait, as JS's classify does.
    val readings =
      listOf(
        Triple(nan, 0.0, 0.0), Triple(0.0, nan, 0.0), Triple(0.0, 0.0, nan),
        Triple(inf, 0.0, 0.0), Triple(-inf, 0.0, 0.0), Triple(0.0, inf, 0.0), Triple(0.0, 0.0, inf),
      )
    for ((x, y, z) in readings) assertNull(HeldPose.classify(x, y, z), "($x, $y, $z)")
    // As the dead band, it restarts a hold in progress: settled 300 ms after the next real reading.
    val tracker = PoseTracker()
    tracker.sample(1.0, 0.0, 0.0, 0)
    tracker.sample(inf, 0.0, 0.0, 100)
    assertNull(tracker.sample(1.0, 0.0, 0.0, 300))
    assertEquals(Pose.Held(Side.LEFT), tracker.sample(1.0, 0.0, 0.0, 600))
  }

  @Test
  fun `no accelerometer is the no-accelerometer record line`() {
    assertEquals("no-accelerometer", HeldPose.NO_SENSOR.kind)
    assertEquals(emptyList(), HeldPose.NO_SENSOR.fields)
  }
}
