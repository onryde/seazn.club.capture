package com.seazn.capture.engine.watch

import android.content.Context
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities
import com.seazn.capture.engine.core.Input

/**
 * The network pre-flight (AGENTS §6): the default network's VALIDATED capability, reported on a change
 * only. Not reachable is the start, so the first validated network is told. The callbacks come on
 * ConnectivityManager's one thread, in order.
 */
class NetworkWatch(private val context: Context, private val report: (Input) -> Unit) {
  @Volatile
  var reachable = false
    private set

  fun start() {
    val manager = context.getSystemService(ConnectivityManager::class.java) ?: return
    manager.registerDefaultNetworkCallback(
      object : ConnectivityManager.NetworkCallback() {
        override fun onCapabilitiesChanged(network: Network, caps: NetworkCapabilities) = changed(caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_VALIDATED))

        override fun onLost(network: Network) = changed(false)
      },
    )
  }

  private fun changed(validated: Boolean) {
    if (validated == reachable) return
    reachable = validated
    report(Input.Network(validated))
  }
}
