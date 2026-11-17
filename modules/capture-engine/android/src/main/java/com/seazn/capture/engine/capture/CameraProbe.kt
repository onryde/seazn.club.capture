package com.seazn.capture.engine.capture

import android.annotation.SuppressLint
import android.hardware.camera2.CameraAccessException
import android.hardware.camera2.CameraDevice
import android.hardware.camera2.CameraManager
import com.seazn.capture.engine.capture.run.Probe
import java.util.concurrent.Executor
import java.util.concurrent.atomic.AtomicReference
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.withTimeoutOrNull

/**
 * N45 I1 (fix round 1): whether our camera opens now, asked of Camera2 itself while the slate is up and StreamPack
 * holds no camera source. It is opened and closed at once, and answered only once closed, so the reopen that follows
 * never meets this open of ours. An app that outranks us (the top app outranks our foreground service) refuses it with
 * Camera2's busy codes and keeps its camera. Bounded by [Probe.BOUND_MS]. Review R1-M2: Camera2 cannot cancel an open
 * it was asked for, so a probe that times out waits, bounded by [Probe.SETTLE_MS], for that open's close before the
 * capture's queue moves on, where a reopen would make a second open of our camera beside it. An open later still is
 * closed as it comes. Re-review 2 (R2-M2 ruling): Stop and unpair cancel the wait (`CaptureRun.abandonProbe`), and
 * the callbacks below still close what the open asked brings.
 */
@SuppressLint("MissingPermission") // CD37: on air only, long after CAMERA was granted
internal class CameraProbe(private val manager: CameraManager, private val executor: Executor) {
  suspend fun open(id: String): Probe {
    val closed = CompletableDeferred<Probe>()
    val found = AtomicReference<Probe?>(null)
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

        override fun onClosed(device: CameraDevice) {
          closed.complete(found.get() ?: Probe.Refused("closed"))
        }
      }
    try {
      manager.openCamera(id, executor, callback)
    } catch (e: CameraAccessException) {
      return Probe.refusedOnAccess(e.reason)
    } catch (e: Exception) {
      return Probe.Refused(e.javaClass.simpleName) // a SecurityException or an unknown id: no open, no throw
    }
    withTimeoutOrNull(Probe.BOUND_MS) { closed.await() }?.let { return it }
    withTimeoutOrNull(Probe.SETTLE_MS) { closed.await() } // the open asked goes on: its close, before the queue moves
    return Probe.Refused("timeout")
  }
}
