package com.seazn.capture.engine.watch

import android.content.Context
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities
import com.seazn.capture.engine.core.Input
import com.seazn.capture.engine.core.RecordEntry

/**
 * The network pre-flight (AGENTS §6): the default network's VALIDATED capability, reported on a change
 * only. Not reachable is the start, so the first validated network is told. The callbacks come on
 * ConnectivityManager's one thread, in order.
 */
class NetworkWatch(private val context: Context, private val report: (Input) -> Unit, private val line: (RecordEntry) -> Unit) {
  @Volatile
  var reachable = false
    private set

  fun start() {
    val manager = context.getSystemService(ConnectivityManager::class.java) ?: return
    manager.registerDefaultNetworkCallback(
      object : ConnectivityManager.NetworkCallback() {
        override fun onCapabilitiesChanged(network: Network, caps: NetworkCapabilities) = guarded { changed(caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_VALIDATED)) }

        override fun onLost(network: Network) = guarded { changed(false) }
      },
    )
  }

  /** Review C7 M-8: a throw on ConnectivityManager's thread would end the process; it costs a line instead. */
  private fun guarded(block: () -> Unit) {
    try {
      block()
    } catch (e: Exception) {
      line(RecordEntry("watch-failed", listOf("action" to "network", "error" to e.javaClass.simpleName)))
    }
  }

  private fun changed(validated: Boolean) {
    if (validated == reachable) return
    reachable = validated
    report(Input.Network(validated))
  }
}
