package com.seazn.capture.engine.adapter

import com.seazn.capture.engine.core.Side

/** The encoder's fixed keys, and the encoded rotation. */
object EncoderKeys {
  /**
   * P5: B-frames off. `MediaFormat.KEY_MAX_B_FRAMES` is `"max-bframes"` (API 29+); minSdk is 31 (CD34),
   * so every supported phone is asked. The glue uses the constant, and Task 36 checks it with javap.
   */
  val VIDEO: Map<String, Int> = mapOf("max-bframes" to 0)

  /**
   * F-P5-6, A11: the side the accelerometer read when Armed turned to Connecting (`Command.Orient`),
   * fixed for the broadcast, as a `Surface` rotation: `ROTATION_90` (1) for LEFT, `ROTATION_270` (3) for
   * RIGHT. The display's rotation is never read for the encode.
   */
  fun surfaceRotation(side: Side): Int = side.rotationDegrees / 90
}
