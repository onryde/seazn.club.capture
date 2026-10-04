package com.seazn.capture.engine.host

import com.seazn.capture.engine.core.Cancellable
import com.seazn.capture.engine.core.Scheduler
import java.math.BigDecimal
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue
import org.json.JSONObject

class ProtocolTest {
  @Test
  fun `numbers cross as doubles, as they do through Expo`() {
    val wire = Protocol.toWire(JSONObject("""{"kind":"pair","slot":2,"nested":{"n":2000},"claim":null,"at":1790000600000,"ms":2.25,"list":[1,{"m":3}]}"""))
    assertEquals(2.0, wire["slot"])
    assertEquals(2000.0, (wire["nested"] as Map<*, *>)["n"])
    assertEquals(null, wire["claim"])
    assertTrue(wire.containsKey("claim"))
    // Task 11 gap 2: org.json reads a large whole number as a Long and a fraction as a BigDecimal.
    assertEquals(1_790_000_600_000.0, wire["at"])
    assertEquals(2.25, wire["ms"])
    assertEquals(listOf(1.0, mapOf("m" to 3.0)), wire["list"])
    assertEquals(4.5, Protocol.toWire(JSONObject().put("big", BigDecimal("4.5")))["big"])
  }

  @Test
  fun `an event is one line`() {
    val line = Protocol.encode("record", mapOf("line" to "{\"a\":1}\n"))
    assertFalse('\n' in line)
    assertEquals("{\"a\":1}\n", JSONObject(line).getString("line"))
    assertEquals("record", JSONObject(line).getString("ev"))
  }

  @Test
  fun `CD8 P7 the refused pair's snapshot is written before that intent's ack`() {
    val out = mutableListOf<String>()
    val executor = ExecutorScheduler()
    val host = Host(executor) { synchronized(out) { out += it } }
    host.handle("""{"op":"send","seq":1,"intent":{"kind":"pair"}}""")
    executor.drain()
    val events = synchronized(out) { out.map(::JSONObject) }
    val ack = events.indexOfFirst { it.getString("ev") == "ack" }
    val ended = events.indexOfFirst { it.getString("ev") == "snapshot" && it.getJSONObject("body").getJSONObject("state").getString("kind") == "ended" }
    assertTrue(ended in 0 until ack, "the refused pair's ended snapshot comes before its ack: $events")
    assertEquals(1, events[ack].getInt("seq"))
    executor.shutdown()
  }

  @Test
  fun `no line the host writes carries the made-up token or a URL`() {
    val out = mutableListOf<String>()
    val executor = ExecutorScheduler()
    val host = Host(executor) { synchronized(out) { out += it } }
    host.handle("""{"op":"send","seq":1,"intent":${ScriptedServer.PAIR}}""")
    // Paired once the grant is heard, so the start is posted rather than ignored.
    executor.drain()
    host.handle("""{"op":"send","seq":2,"intent":{"kind":"start"}}""")
    executor.drain()
    val all = synchronized(out) { out.toList() }
    assertTrue(all.none { ScriptedServer.TOKEN in it })
    // PV23: the request events alone, each checked, and at least the claim beat and the start's.
    val requests = all.map(::JSONObject).filter { it.getString("ev") == "request" }
    assertEquals(setOf("beat", "start"), requests.map { it.getString("path") }.toSet() - "code", "the requests the pair and the start sent")
    for (request in requests) assertFalse("https://" in request.toString(), "a request event carries the body only: $request")
    // The body parsed back to an object, so the kit reads its fields: the beat's and the start's phone.
    for (path in listOf("beat", "start")) assertEquals(Host.PHONE_ID, requests.first { it.getString("path") == path }.getJSONObject("body").getString("phone"), path)
    executor.shutdown()
  }

  @Test
  fun `the ready line is the first the host writes, before the start's first snapshot`() {
    val out = mutableListOf<String>()
    // Runs each task at once, so a snapshot the start publishes would land before a ready written after it.
    val inline =
      object : Scheduler {
        override fun schedule(delayMs: Long, task: () -> Unit): Cancellable {
          if (delayMs == 0L) task()
          return Cancellable {}
        }
      }
    Host(inline) { out += it }
    val ready = JSONObject(out.first())
    assertEquals("ready", ready.getString("ev"))
    assertEquals("idle", ready.getJSONObject("current").getJSONObject("state").getString("kind"))
    assertTrue(out.drop(1).any { JSONObject(it).getString("ev") == "snapshot" }, "the start published, after it: $out")
  }
}
