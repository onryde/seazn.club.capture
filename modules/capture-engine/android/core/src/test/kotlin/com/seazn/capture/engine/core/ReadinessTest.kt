package com.seazn.capture.engine.core

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull

class ReadinessTest {
  private val ready = Readiness(cameraFrames = true, audioPeak = 0.42, pose = Pose.Held(Side.RIGHT))

  @Test
  fun `A11 the floor is the one JS draws its notch at`() {
    assertEquals(Shared.read("wire/audio-floor.json").getDouble("floor"), Readiness.AUDIO_FLOOR)
  }

  @Test
  fun `A11 ready needs camera, sound, network and the phone held sideways, named in that order`() {
    assertNull(ready.notReady(CameraState.OWN, networkValidated = true))
    assertEquals(NotReady.CAMERA, ready.copy(cameraFrames = false, audioPeak = 0.0).notReady(CameraState.OWN, true))
    assertEquals(NotReady.CAMERA, ready.notReady(CameraState.TAKEN, true))
    assertEquals(NotReady.SOUND, ready.copy(audioPeak = 0.049).notReady(CameraState.OWN, false))
    assertEquals(NotReady.NETWORK, ready.copy(pose = Pose.NotHeld).notReady(CameraState.OWN, false))
    assertEquals(NotReady.HELD, ready.copy(pose = Pose.NotHeld).notReady(CameraState.OWN, true))
  }

  @Test
  fun `A11 a level exactly at the floor is sound, and a level that is no number is not`() {
    assertNull(ready.copy(audioPeak = 0.05).notReady(CameraState.OWN, true))
    assertEquals(NotReady.SOUND, ready.copy(audioPeak = Double.NaN).notReady(CameraState.OWN, true))
  }

  @Test
  fun `A11 no accelerometer never blocks, and encodes as ROTATION_90`() {
    val blind = ready.copy(pose = Pose.NoSensor)
    assertNull(blind.notReady(CameraState.OWN, true))
    assertEquals(Side.LEFT, blind.side)
    assertEquals(90, blind.side.rotationDegrees)
  }

  @Test
  fun `A11 before the platform's first reading nothing is ready`() {
    val unknown = Readiness.UNKNOWN
    assertEquals(NotReady.CAMERA, unknown.notReady(CameraState.OWN, networkValidated = true))
    assertFalse(unknown.sound)
    assertFalse(unknown.held)
  }

  @Test
  fun `A11 the encoded side is the side held`() {
    assertEquals(Side.RIGHT, ready.side)
    assertEquals(270, ready.side.rotationDegrees)
  }
}
