package com.seazn.capture.engine.capture

import android.annotation.SuppressLint
import android.hardware.camera2.CameraAccessException
import android.hardware.camera2.CameraDevice
import android.hardware.camera2.CameraManager
import com.seazn.capture.engine.capture.run.Probe
import java.util.concurrent.Executor
import java.util.concurrent.atomic.AtomicReference
import kotlin.coroutines.resume
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withTimeoutOrNull

/**
 * N45 I1 (fix round 1): whether our camera opens now, asked of Camera2 itself while the slate is up and StreamPack
 * holds no camera source. It is opened and closed at once, and answered only once closed, so the reopen that follows
 * never meets this open of ours. An app that outranks us (the top app outranks our foreground service) refuses it with
 * Camera2's busy codes and keeps its camera. Bounded by [Probe.BOUND_MS]: an open that comes after is closed as it comes.
 */
@SuppressLint("MissingPermission") // CD37: on air only, long after CAMERA was granted
internal class CameraProbe(private val manager: CameraManager, private val executor: Executor) {
  suspend fun open(id: String): Probe = withTimeoutOrNull(Probe.BOUND_MS) { attempt(id) } ?: Probe.Refused("timeout")

  private suspend fun attempt(id: String): Probe =
    suspendCancellableCoroutine { asked ->
      val found = AtomicReference<Probe?>(null)

      fun answer(probe: Probe) {
        if (asked.isActive) asked.resume(probe)
      }

      val callback =
        object : CameraDevice.StateCallback() {
          override fun onOpened(device: CameraDevice) {
            found.compareAndSet(null, Probe.Opened(id))
            device.close()
          }

          override fun onDisconnected(device: CameraDevice) {
            found.compareAndSet(null, Probe.Refused("disconnected"))
            device.close()
          }

          override fun onError(device: CameraDevice, error: Int) {
            found.compareAndSet(null, Probe.refusedOnError(error))
            device.close()
          }

          override fun onClosed(device: CameraDevice) = answer(found.get() ?: Probe.Refused("closed"))
        }
      try {
        manager.openCamera(id, executor, callback)
      } catch (e: CameraAccessException) {
        answer(Probe.refusedOnAccess(e.reason))
      } catch (e: Exception) {
        answer(Probe.Refused(e.javaClass.simpleName)) // a SecurityException or an unknown id: no open, no throw
      }
    }
}
