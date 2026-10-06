package com.seazn.capture.engine.adapter

import com.seazn.capture.engine.core.Pose
import com.seazn.capture.engine.core.Readiness
import com.seazn.capture.engine.core.Side
import kotlin.test.Test
import kotlin.test.assertEquals

class EncoderKeysTest {
  @Test
  fun `P5 B-frames are off on every supported phone`() {
    // MediaFormat.KEY_MAX_B_FRAMES is "max-bframes" (API 29+, javap on android-36's android.jar); minSdk is 31
    // (CD34), so it is always asked for.
    assertEquals(mapOf("max-bframes" to 0), EncoderKeys.VIDEO)
  }

  @Test
  fun `F-P5-6 A11 the encoded rotation is the side the accelerometer read`() {
    // Fixed for the broadcast is held elsewhere: the machine orients only as Armed turns to Connecting
    // (Command.Orient, Task 5), and the glue never calls setTargetRotation (GlueRulesTest).
    // Surface.ROTATION_90 = 1, ROTATION_270 = 3 (javap, android-36). Live Stream is landscape either way (ruling 4).
    assertEquals(1, EncoderKeys.surfaceRotation(Side.LEFT))
    assertEquals(3, EncoderKeys.surfaceRotation(Side.RIGHT))
    // No accelerometer: Readiness.side defaults to LEFT (Task 4), so the usual landscape.
    assertEquals(1, EncoderKeys.surfaceRotation(Readiness(true, 0.4, Pose.NoSensor).side))
  }
}
