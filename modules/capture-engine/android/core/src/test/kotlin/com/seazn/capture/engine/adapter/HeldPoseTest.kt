package com.seazn.capture.engine.adapter

import com.seazn.capture.engine.core.Pose
import com.seazn.capture.engine.core.Shared
import com.seazn.capture.engine.core.Side
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
    assertEquals(23, rows.length())
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
    assertEquals(7, tracks.length())
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
  fun `a reading settles after 300 ms, and a swing through the dead band does not flip it`() {
    val tracker = PoseTracker()
    assertEquals(Pose.NotHeld, tracker.pose, "nothing settled yet reads not held (A11's unknown)")
    assertNull(tracker.sample(1.0, 0.0, 0.0, 0))
    assertNull(tracker.sample(1.0, 0.0, 0.0, 299), "299 ms is not yet settled")
    assertEquals(Pose.Held(Side.LEFT), tracker.sample(1.0, 0.0, 0.0, 300))
    assertNull(tracker.sample(1.0, 0.0, 0.0, 400), "no change, no report")
    assertNull(tracker.sample(0.707, 0.707, 0.0, 500), "the dead band")
    assertNull(tracker.sample(0.0, 1.0, 0.0, 600))
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
  fun `no accelerometer is a record line, never a reading`() {
    assertEquals("no-accelerometer", HeldPose.NO_SENSOR.kind)
    assertEquals(emptyList(), HeldPose.NO_SENSOR.fields)
  }
}
