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
import kotlin.test.assertTrue
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

  private fun held(pose: Pose) = Readiness(cameraFrames = true, micAvailable = true, pose = pose).held

  /** Gravity for a phone turned [deg] from upright in the screen's plane, as JS's orientation test builds it. */
  private fun tilted(deg: Double) = Math.toRadians(deg).let { Triple(sin(it), cos(it), 0.0) }

  private fun PoseTracker.at(g: Triple<Double, Double, Double>, monoMs: Long) = sample(g.first, g.second, g.third, monoMs)

  private val sideways = tilted(90.0)
  private val deadBand = tilted(45.0)
  private val upright = Triple(0.0, 1.0, 0.0)
  private val flat = Triple(0.0, 0.0, 1.0)

  /** One sample every 60 ms (SENSOR_DELAY_UI). */
  private val sensorMs = 60L

  /** Held on its left side at 0 ms. */
  private fun heldLeft() = PoseTracker().apply { assertEquals(Pose.Held(Side.LEFT), at(sideways, 0)) }

  @Test
  fun `the out-of-position window is the owner's 1 s (2026-10-05)`() {
    assertEquals(1_000L, PoseTracker.OUT_MS)
  }

  // JS's settle is the turn card's, unchanged (the shared tracks above); held no longer waits on it.
  @Test
  fun `JS's reading settles after 300 ms, and held is at the first sideways reading`() {
    val tracker = PoseTracker()
    assertEquals(Pose.NotHeld, tracker.pose, "nothing read yet is not held (A11's unknown)")
    assertEquals(Pose.Held(Side.LEFT), tracker.sample(1.0, 0.0, 0.0, 0), "held at once (owner, 2026-10-05)")
    assertEquals(Physical.UNKNOWN, tracker.settled.physical, "JS's reading has not settled yet")
    assertNull(tracker.sample(1.0, 0.0, 0.0, 299))
    assertEquals(Physical.UNKNOWN, tracker.settled.physical, "299 ms is not yet settled")
    assertNull(tracker.sample(1.0, 0.0, 0.0, 300), "settling changes no pose")
    assertEquals(PoseReading(Physical.LANDSCAPE, Side.LEFT), tracker.settled)
  }

  @Test
  fun `PV17 a dip into the dead band restarts JS's settle, so returning to the same reading waits a full hold again`() {
    val tracker = PoseTracker()
    tracker.sample(1.0, 0.0, 0.0, 0)
    tracker.sample(0.707, 0.707, 0.0, 200)
    // Without the restart, 300 ms after the first reading would settle here.
    tracker.sample(1.0, 0.0, 0.0, 300)
    assertEquals(Physical.UNKNOWN, tracker.settled.physical, "the hold runs from 300 now, not from 0")
    // Without the candidate's reset, the hold would run from the dip: 399 ms would settle here.
    tracker.sample(1.0, 0.0, 0.0, 599)
    assertEquals(Physical.UNKNOWN, tracker.settled.physical, "299 ms of the new hold")
    tracker.sample(1.0, 0.0, 0.0, 600)
    assertEquals(PoseReading(Physical.LANDSCAPE, Side.LEFT), tracker.settled)
    assertEquals(Pose.Held(Side.LEFT), tracker.pose, "held throughout: the dip was in the dead band")
  }

  @Test
  fun `out of position, held drops only once a full window has passed out`() {
    val tracker = heldLeft()
    val outFrom = 400L
    assertNull(tracker.at(upright, outFrom), "stood upright: out of position, the window starts")
    assertNull(tracker.at(upright, outFrom + PoseTracker.OUT_MS - 1), "a moment short of the window: still held")
    assertEquals(true, held(tracker.pose))
    assertEquals(Pose.NotHeld, tracker.at(upright, outFrom + PoseTracker.OUT_MS), "a full window out: not held")
    assertNull(tracker.at(upright, outFrom + PoseTracker.OUT_MS + sensorMs), "and it stays so, with nothing to report")
  }

  @Test
  fun `back in position after a drop, held at once`() {
    val tracker = heldLeft()
    tracker.at(upright, 100)
    assertEquals(Pose.NotHeld, tracker.at(upright, 100 + PoseTracker.OUT_MS))
    assertEquals(Pose.Held(Side.LEFT), tracker.at(sideways, 100 + PoseTracker.OUT_MS + sensorMs), "re-entry: held at once")
  }

  @Test
  fun `one reading back in position starts the window again`() {
    val tracker = heldLeft()
    tracker.at(upright, 100)
    assertNull(tracker.at(sideways, 100 + PoseTracker.OUT_MS - sensorMs), "back on its side near the window's end")
    assertNull(tracker.at(upright, 100 + PoseTracker.OUT_MS), "out again: the window runs from here")
    assertNull(tracker.at(upright, 100 + 2 * PoseTracker.OUT_MS - 1))
    assertEquals(Pose.NotHeld, tracker.at(upright, 100 + 2 * PoseTracker.OUT_MS))
  }

  /**
   * The edges are HeldPose's own: in at more than 60 degrees from upright, out at under 30 (or flat
   * past 0.94 of gravity through the screen). Between, the dead band keeps what was. 60.1 and 59.9
   * sit either side of the way in; 30.1 and 29.9 either side of the way out.
   */
  @Test
  fun `hysteresis - the dead band never makes held, and never ends it`() {
    val notYet = PoseTracker()
    var t = 0L
    var samples = 0
    for (deg in listOf(59.9, 45.0, 30.1)) {
      repeat(100) {
        assertNull(notYet.at(tilted(deg), t), "$deg degrees from not held: still not held")
        t += sensorMs
        samples += 1
      }
    }
    assertEquals(Pose.Held(Side.LEFT), notYet.at(tilted(60.1), t), "past 60 degrees: in")
    for (deg in listOf(59.9, 45.0, 30.1)) {
      repeat(100) {
        t += sensorMs
        assertNull(notYet.at(tilted(deg), t), "$deg degrees from held: still held")
        samples += 1
      }
    }
    assertEquals(600, samples, "the sweep's own count, each band 6 s long, past the window")
    t += sensorMs
    assertNull(notYet.at(tilted(29.9), t), "under 30 degrees: out, and the window starts")
    assertEquals(Pose.NotHeld, notYet.at(tilted(29.9), t + PoseTracker.OUT_MS))
  }

  @Test
  fun `a jitter across the way out for less than the window flips nothing, and one run of a window flips it once`() {
    val tracker = heldLeft()
    val out = tilted(29.9)
    val inBand = tilted(30.1)
    var t = 0L
    val reports = mutableListOf<Pose>()
    fun run(g: Triple<Double, Double, Double>, samples: Int) = repeat(samples) {
      t += sensorMs
      tracker.at(g, t)?.let(reports::add)
    }
    // A run of n samples spans (n - 1) x 60 ms; the longest run short of the window.
    val shortRun = ((PoseTracker.OUT_MS - 1) / sensorMs + 1).toInt()
    assertTrue((shortRun - 1) * sensorMs < PoseTracker.OUT_MS && shortRun * sensorMs >= PoseTracker.OUT_MS, "the run is the longest short of a window")
    repeat(500) { run(out, 1); run(inBand, 1) }
    assertEquals(0, reports.size, "60 s of one-sample jitter flips nothing")
    repeat(20) { run(out, shortRun); run(inBand, 1) }
    assertEquals(0, reports.size, "runs a sample short of the window flip nothing")
    run(out, shortRun + 1)
    assertEquals(listOf<Pose>(Pose.NotHeld), reports, "a run of a full window drops it")
    repeat(20) { run(inBand, 3); run(out, 3) }
    assertEquals(listOf<Pose>(Pose.NotHeld), reports, "and the dead band never brings it back")
  }

  @Test
  fun `N1 a wobble across the 60 degree edge while held flips nothing`() {
    val tracker = heldLeft()
    val inBand = tilted(59.9)
    val out = tilted(60.1)
    var t = 0L
    var samples = 0
    repeat(1_000) { n ->
      t += sensorMs
      assertNull(tracker.at(if (n % 2 == 0) inBand else out, t))
      samples += 1
    }
    assertEquals(1_000, samples, "the reviewer's mount, 60 s of it")
    assertEquals(Pose.Held(Side.LEFT), tracker.pose)
  }

  @Test
  fun `settled sideways and still sideways stays held, with nothing to report`() {
    val tracker = PoseTracker()
    assertEquals(Pose.Held(Side.RIGHT), tracker.sample(-1.0, 0.0, 0.0, 0))
    assertNull(tracker.sample(-1.0, 0.0, 0.0, 400))
    assertNull(tracker.sample(-0.9, 0.1, 0.4, 5_000), "still sideways, tilted back on the tripod")
    assertEquals(Pose.Held(Side.RIGHT), tracker.pose)
    assertEquals(true, held(tracker.pose))
  }

  @Test
  fun `no sensor never blocks, and nothing read yet does`() {
    assertEquals(true, held(Pose.NoSensor))
    assertEquals(false, held(PoseTracker().pose))
  }

  @Test
  fun `turning from one side to the other is the new side at once`() {
    val tracker = heldLeft()
    assertEquals(Pose.Held(Side.RIGHT), tracker.sample(-1.0, 0.0, 0.0, 400))
  }

  @Test
  fun `flat is out of position, so the blocker shows once it has lasted the window`() {
    val tracker = heldLeft()
    assertNull(tracker.at(flat, 400), "laid on the table: the window starts")
    assertNull(tracker.at(flat, 400 + PoseTracker.OUT_MS - 1))
    assertEquals(Pose.NotHeld, tracker.at(flat, 400 + PoseTracker.OUT_MS), "flat for the window: not held, reported")
    assertEquals(Physical.FLAT, tracker.settled.physical)
  }

  @Test
  fun `a phone with no weight on it, under 0_3 g, is out of position`() {
    val tracker = heldLeft()
    assertNull(tracker.sample(0.1, 0.0, 0.0, 400))
    assertEquals(Pose.NotHeld, tracker.sample(0.1, 0.0, 0.0, 400 + PoseTracker.OUT_MS))
  }

  @Test
  fun `a reading that leaves the pose as it was reports nothing`() {
    val tracker = PoseTracker()
    tracker.sample(0.0, 1.0, 0.0, 0)
    assertNull(tracker.sample(0.0, 1.0, 0.0, 300), "upright settles, but not held before is not held after")
    assertEquals(Physical.PORTRAIT, tracker.settled.physical)
    tracker.sample(0.0, 0.0, 1.0, 400)
    assertNull(tracker.sample(0.0, 0.0, 1.0, 400 + PoseTracker.OUT_MS), "upright to flat: still not held")
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
    assertEquals(null, PoseTracker().sample(inf, 0.0, 0.0, 0), "never held by a reading that is not finite")
    // As the dead band, it restarts JS's settle in progress: settled 300 ms after the next real reading.
    val tracker = PoseTracker()
    tracker.sample(1.0, 0.0, 0.0, 0)
    tracker.sample(inf, 0.0, 0.0, 100)
    tracker.sample(1.0, 0.0, 0.0, 300)
    assertEquals(Physical.UNKNOWN, tracker.settled.physical)
    tracker.sample(1.0, 0.0, 0.0, 600)
    assertEquals(PoseReading(Physical.LANDSCAPE, Side.LEFT), tracker.settled)
  }

  @Test
  fun `no accelerometer is the no-accelerometer record line`() {
    assertEquals("no-accelerometer", HeldPose.NO_SENSOR.kind)
    assertEquals(emptyList(), HeldPose.NO_SENSOR.fields)
  }
}
