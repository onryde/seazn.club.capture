/*
 * Copyright (C) 2024 Thibault B.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 *
 * Adapted for Seazn Capture from StreamPack 3.2.0's SrtSink (see NOTICE.md beside this file).
 */
package com.seazn.capture.engine.srt

import com.seazn.capture.engine.adapter.AttemptSignals
import com.seazn.capture.engine.adapter.SrtOpt
import com.seazn.capture.engine.adapter.SrtPlan
import com.seazn.capture.engine.core.Input
import com.seazn.capture.engine.core.LinkCounters
import com.seazn.capture.engine.srt.connect.SrtConnection
import com.seazn.capture.engine.srt.connect.SrtSocketPort
import io.github.thibaultbee.srtdroid.core.enums.Boundary
import io.github.thibaultbee.srtdroid.core.enums.SockOpt
import io.github.thibaultbee.srtdroid.core.enums.Transtype
import io.github.thibaultbee.srtdroid.core.models.MsgCtrl
import io.github.thibaultbee.srtdroid.ktx.CoroutineSrtSocket
import io.github.thibaultbee.streampack.core.configuration.mediadescriptor.MediaDescriptor
import io.github.thibaultbee.streampack.core.elements.endpoints.ClosedException
import io.github.thibaultbee.streampack.core.elements.endpoints.MediaSinkType
import io.github.thibaultbee.streampack.core.elements.endpoints.composites.data.Packet
import io.github.thibaultbee.streampack.core.elements.endpoints.composites.data.SrtPacket
import io.github.thibaultbee.streampack.core.elements.endpoints.composites.sinks.AbstractSink
import io.github.thibaultbee.streampack.core.elements.endpoints.composites.sinks.SinkConfiguration
import java.net.InetSocketAddress
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.withContext

/**
 * Our SRT sink (CD14). StreamPack's SrtSink sets MAXBW 0 and INPUTBW in bits, where libsrt reads
 * bytes (F-P5-11). This one sets every option from [SrtPlan] (`SrtOptions.plan`), resolves the host
 * first on its IO dispatcher (F-P5-1), takes its secrets as socket options and never in a URL, and
 * reports one drop per attempt from the socket's completion (R3), through [SrtConnection], which core's
 * tests run (C6 I-2). It logs nothing: a failure leaves as an [Input] through [AttemptSignals], whose
 * `toString` masks the platform's text (m7), and the record masks the secrets in it (CD6).
 */
class SeaznSrtSink(
  private val dispatcher: CoroutineDispatcher,
  signals: AttemptSignals,
  report: (Input) -> Unit,
) : AbstractSink() {
  override val supportedSinkTypes: List<MediaSinkType> = listOf(MediaSinkType.SRT)

  private val connection = SrtConnection(signals, report)
  override val isOpenFlow = connection.isOpen

  @Volatile private var socket: CoroutineSrtSocket? = null

  @Volatile private var pending: Pair<SrtPlan, Int>? = null

  @Volatile private var attemptId: Int? = null

  /** Set by the streamer adapter before `startStream`; the descriptor it passes carries host and port only. */
  fun next(plan: SrtPlan, attemptId: Int) {
    pending = plan to attemptId
  }

  /** INPUTBW and MAXBW come from the plan, never from the encoder's bitrate (F-P5-11). */
  override fun configure(config: SinkConfiguration) = Unit

  override suspend fun openImpl(mediaDescriptor: MediaDescriptor) =
    withContext(dispatcher) {
      val (plan, id) = pending ?: throw IllegalStateException("no SRT plan for this connect")
      val address = connection.resolve(plan.host) // F-P5-1: UnknownHostException → UNRESOLVED
      val opened = CoroutineSrtSocket(dispatcher) // 1.10.0: CoroutineSrtSocket(CoroutineDispatcher)
      opened.setSockFlag(SockOpt.PAYLOADSIZE, PAYLOAD_SIZE)
      for ((option, value) in plan.before) opened.setSockFlag(sockOpt(option), flagValue(option, value)) // 1.10.0: setSockFlag(SockOpt, Any)
      connection.connect(Port(opened), id, InetSocketAddress(address, plan.port)) {
        opened.setSockFlag(SockOpt.MAXBW, plan.maxBwBytesPerSecond) // F-P5-11: after connect, in bytes per second
        socket = opened
        attemptId = id
      }
    }

  override suspend fun startStream() {
    val held = socket ?: throw ClosedException("SRT socket not open")
    if (!held.isConnected) throw ClosedException("SRT socket not connected") // 1.10.0: isConnected: Boolean
  }

  override suspend fun write(packet: Packet): Int {
    connection.ended?.let { throw ClosedException(it) }
    val held = socket ?: throw ClosedException("SRT socket not open")
    if (packet.ts != 0L && held.connectionTime > packet.ts) return -1 // as SrtSink: older than the connection
    return held.send(packet.buffer, msgCtrl(packet)) // 1.10.0: suspend send(ByteBuffer, MsgCtrl): Int
  }

  override suspend fun stopStream() = Unit

  override suspend fun close() {
    socket?.close()
    socket = null
    attemptId = null
    connection.closed()
  }

  fun setMaxBw(forAttempt: Int, bytesPerSecond: Long) {
    if (attemptId == forAttempt) socket?.setSockFlag(SockOpt.MAXBW, bytesPerSecond)
  }

  /** One reading for the Link poller (CD12): a quick JNI call, allowed on the scheduler thread. */
  fun counters(forAttempt: Int): LinkCounters? {
    if (attemptId != forAttempt) return null
    val stats = socket?.bistats(clear = false, instantaneous = true) ?: return null // 1.10.0: bistats(Boolean, Boolean): Stats
    // 1.10.0 Stats: byteSentTotal and pktSentTotal Long; pktRetransTotal, pktSndDropTotal, pktSndLossTotal, msSndBuf Int; msRTT, mbpsBandwidth Double (N4).
    return LinkCounters(
      stats.byteSentTotal,
      stats.pktSentTotal,
      stats.pktRetransTotal.toLong(),
      stats.pktSndDropTotal.toLong(),
      stats.pktSndLossTotal.toLong(),
      stats.msRTT.toInt(),
      stats.msSndBuf.takeIf { it >= 0 },
      (stats.mbpsBandwidth * 1_000_000).toLong(),
    )
  }

  /** srtdroid has no `TRANSTYPE_LIVE` (javap, 1.9.5 and 1.10.0): it is `TRANSTYPE` set to `Transtype.LIVE`. */
  private fun sockOpt(option: SrtOpt): SockOpt = if (option == SrtOpt.TRANSTYPE_LIVE) SockOpt.TRANSTYPE else SockOpt.valueOf(option.name)

  private fun flagValue(option: SrtOpt, value: Any): Any = if (option == SrtOpt.TRANSTYPE_LIVE) Transtype.LIVE else value

  /** Copied from StreamPack's SrtSink.buildMsgCtrl. */
  private fun msgCtrl(packet: Packet): MsgCtrl {
    val boundary =
      (packet as? SrtPacket)?.let {
        when {
          it.isFirstPacketFrame && it.isLastPacketFrame -> Boundary.SOLO
          it.isFirstPacketFrame -> Boundary.FIRST
          it.isLastPacketFrame -> Boundary.LAST
          else -> Boundary.SUBSEQUENT
        }
      }
    return when {
      packet.ts == 0L && boundary == null -> MsgCtrl()
      packet.ts == 0L -> MsgCtrl(boundary = boundary!!)
      boundary == null -> MsgCtrl(srcTime = packet.ts)
      else -> MsgCtrl(srcTime = packet.ts, boundary = boundary)
    }
  }

  /** srtdroid 1.10.0's socket, as the connection's port. */
  private class Port(private val socket: CoroutineSrtSocket) : SrtSocketPort {
    override suspend fun connect(address: InetSocketAddress) = socket.connect(address) // 1.10.0: suspend connect(InetSocketAddress)

    override fun onEnd(handler: (Throwable?) -> Unit) {
      socket.socketContext.invokeOnCompletion(handler) // 1.10.0: socketContext: CompletableJob; close() completes it synchronously
    }
  }

  companion object {
    private const val PAYLOAD_SIZE = 1316
  }
}
