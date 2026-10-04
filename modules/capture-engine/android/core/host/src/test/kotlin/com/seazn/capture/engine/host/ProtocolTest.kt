package com.seazn.capture.engine.host

import com.seazn.capture.engine.adapter.HttpRequest
import com.seazn.capture.engine.core.Cancellable
import com.seazn.capture.engine.core.Scheduler
import java.math.BigDecimal
import java.util.concurrent.CountDownLatch
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

  /** Waits, on the host's real clock, for a line [wanted] picks: at most [ms]. */
  private fun await(out: MutableList<String>, ms: Long = 5_000, wanted: (JSONObject) -> Boolean) {
    val until = System.nanoTime() + ms * 1_000_000
    while (synchronized(out) { out.none { wanted(JSONObject(it)) } }) {
      assertTrue(System.nanoTime() < until, "no such line in $ms ms: ${synchronized(out) { out.toList() }}")
      Thread.sleep(10)
    }
  }

  @Test
  fun `no line the host writes carries the made-up token, the session's secrets or a URL`() {
    val out = mutableListOf<String>()
    val executor = ExecutorScheduler()
    val host = Host(executor) { synchronized(out) { out += it } }
    host.handle("""{"op":"send","seq":1,"intent":${ScriptedServer.PAIR}}""")
    // Paired once the grant is heard, and ready once sound has held (I-1), so the start is posted rather than refused.
    executor.drain()
    await(out) { it.getString("ev") == "record" && JSONObject(it.getString("line")).let { line -> line.getString("kind") == "readiness" && line.getBoolean("sound") } }
    host.handle("""{"op":"send","seq":2,"intent":{"kind":"start"}}""")
    executor.drain()
    // The code's answer, with the session's credentials, came back: the go-live armed on it.
    await(out) { it.getString("ev") == "snapshot" && it.getJSONObject("body").optJSONObject("broadcast") != null }
    val all = synchronized(out) { out.toList() }
    // Review C4a m-5: the token, and the SRT passphrase and RTMPS key the code's answer carried.
    for (secret in listOf(ScriptedServer.TOKEN, ScriptedServer.PASSPHRASE, ScriptedServer.STREAM_KEY)) assertTrue(all.none { secret in it }, secret)
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

  /** The host's events by name: `ack:n` for an ack, the state kind for a snapshot, `ev` otherwise. */
  private class Events {
    private val lines = mutableListOf<JSONObject>()

    fun add(line: String) = synchronized(lines) { lines += JSONObject(line) }

    fun names(): List<String> = synchronized(lines) { lines.map(::nameOf) }

    fun lastSnapshot(): JSONObject = synchronized(lines) { lines.last { it.getString("ev") == "snapshot" } }.getJSONObject("body")

    /** The last snapshot written before the event [name]: what the kit holds when that event reaches it. */
    fun snapshotBefore(name: String): JSONObject =
      synchronized(lines) {
        val at = lines.indexOfFirst { nameOf(it) == name }
        assertTrue(at >= 0, "no $name in ${lines.map(::nameOf)}")
        lines.subList(0, at).last { it.getString("ev") == "snapshot" }.getJSONObject("body")
      }

    /** Polls every 20 ms for [name], at most [timeoutMs]; fails with every event seen. */
    fun await(name: String, timeoutMs: Long = 3_000) = awaitThat("$name", timeoutMs) { name in names() }

    fun awaitThat(what: String, timeoutMs: Long = 3_000, seen: () -> Boolean) {
      val until = System.nanoTime() + timeoutMs * 1_000_000
      while (!seen()) {
        assertTrue(System.nanoTime() < until, "no $what in $timeoutMs ms: ${names()}")
        Thread.sleep(20)
      }
    }

    private fun nameOf(line: JSONObject): String =
      when (line.getString("ev")) {
        "ack" -> "ack:${line.getInt("seq")}"
        "snapshot" -> line.getJSONObject("body").getJSONObject("state").getString("kind")
        else -> line.getString("ev")
      }
  }

  /** A host over a real [ExecutorScheduler], as `Main` builds it, its events collected. */
  private fun hostWithEvents(): Pair<Host, Events> {
    val events = Events()
    return Host(ExecutorScheduler(), events::add) to events
  }

  /** The made-up go-live beat: the waiting fields, the host's own uuid sid (I3) and a cause. */
  private val goLive = JSONObject(ScriptedServer.WAITING.toString()).put("state", "go-live").put("sid", ScriptedServer.SID).put("startedBy", "organiser")

  @Test
  fun `a numbered script is acked after its path's next answer, once the host is quiet`() {
    val (host, events) = hostWithEvents()
    host.handle("""{"op":"send","seq":1,"intent":${ScriptedServer.PAIR}}""")
    events.await("ack:1")
    host.handle("""{"op":"script","seq":2,"path":"beat","status":200,"body":$goLive}""")
    events.await("ack:2", timeoutMs = 8_000)
    val names = events.names()
    // The whole chain, the beat's answer, the code's, Armed and the connect, ran before the ack.
    assertTrue(names.indexOf("connecting") in 0 until names.indexOf("ack:2"), "on air before the ack: $names")
    host.shutdown()
  }

  @Test
  fun `a numbered readiness is acked once quiet, and network reaches the core`() {
    val (host, events) = hostWithEvents()
    host.handle("""{"op":"send","seq":1,"intent":${ScriptedServer.PAIR}}""")
    events.await("ack:1")
    host.handle("""{"op":"readiness","seq":2,"network":false}""")
    events.await("ack:2")
    assertEquals(false, events.lastSnapshot().getJSONObject("ready").getBoolean("network"))
    host.shutdown()
  }

  // Review C4a N-3: the meter applies a level at its next readings and sound is held for 300 ms, so
  // a host with nothing due is not yet a host that has judged the level. The ack waits two periods.
  @Test
  fun `N-3 a numbered readiness that silences the mic is acked only once sound reads false`() {
    val (host, events) = hostWithEvents()
    host.handle("""{"op":"send","seq":1,"intent":${ScriptedServer.PAIR}}""")
    events.awaitThat("sound held") { events.names().contains("ack:1") && events.lastSnapshot().getJSONObject("ready").getBoolean("sound") }
    host.handle("""{"op":"readiness","seq":2,"audioPeak":0}""")
    events.await("ack:2")
    assertEquals(false, events.lastSnapshot().getJSONObject("ready").getBoolean("sound"))
    host.shutdown()
  }

  // PV28: the kit's send reads the engine once it is quiet, not at the intent's own ack.
  @Test
  fun `PV28 a quiet op is acked once the start's chain has run, so the start reads on air`() {
    val (host, events) = hostWithEvents()
    host.handle("""{"op":"send","seq":1,"intent":${ScriptedServer.PAIR}}""")
    events.awaitThat("sound held") { events.names().contains("ack:1") && events.lastSnapshot().getJSONObject("ready").getBoolean("sound") }
    host.handle("""{"op":"send","seq":2,"intent":{"kind":"start"}}""")
    host.handle("""{"op":"quiet","seq":3}""")
    events.await("ack:3")
    val names = events.names()
    assertTrue(names.indexOf("connecting") in 0 until names.indexOf("ack:3"), "on air before the quiet ack: $names")
    host.shutdown()
  }

  // A refusal leaves the state paired: the engine publishes it with the start's answer (review C4c I-1),
  // so the quiet ack, posted behind it, needs no tick to be read after it.
  @Test
  fun `PV28 a refusal that leaves the state paired is read at the quiet ack`() {
    val (host, events) = hostWithEvents()
    host.handle("""{"op":"send","seq":1,"intent":${ScriptedServer.PAIR}}""")
    events.awaitThat("sound held") { events.names().contains("ack:1") && events.lastSnapshot().getJSONObject("ready").getBoolean("sound") }
    host.handle("""{"op":"script","path":"start","status":402,"body":{"code":"no_credit","message":"m"}}""")
    host.handle("""{"op":"send","seq":2,"intent":{"kind":"start"}}""")
    host.handle("""{"op":"quiet","seq":3}""")
    events.await("ack:3")
    val last = events.lastSnapshot()
    assertEquals("paired" to "no_credit", last.getJSONObject("state").getString("kind") to last.getString("refusal"))
    host.shutdown()
  }

  // Review C4c I-1: the engine publishes an input's own field changes with it, so the kit reads them at
  // the ack. Here the pair's readiness and its claim beat's answer, which leave the state paired.
  @Test
  fun `I-1 a quiet ack after a pair follows the snapshot that shows its readiness, all four checks`() {
    val (host, events) = hostWithEvents()
    // Sound has held (review C4a I-1), so the pair hears all four checks passing at once.
    host.handle("""{"op":"readiness","seq":1}""")
    events.await("ack:1")
    host.handle("""{"op":"send","seq":2,"intent":${ScriptedServer.PAIR}}""")
    events.await("ack:2")
    host.handle("""{"op":"quiet","seq":3}""")
    events.await("ack:3")
    val seen = events.snapshotBefore("ack:3")
    val ready = seen.getJSONObject("ready")
    assertEquals(listOf("paired", "true", "true", "true", "true"), listOf(seen.getJSONObject("state").getString("kind")) + listOf("camera", "sound", "network", "held").map { ready.getBoolean(it).toString() })
    host.shutdown()
  }

  @Test
  fun `I-1 setAutomatic's snapshot is written before its own ack, though the state stays paired`() {
    val (host, events) = hostWithEvents()
    host.handle("""{"op":"send","seq":1,"intent":${ScriptedServer.PAIR}}""")
    host.handle("""{"op":"quiet","seq":2}""")
    events.await("ack:2")
    assertEquals(true, events.snapshotBefore("ack:2").getJSONObject("pairing").getBoolean("automatic"), "the pair's own switch, on")
    host.handle("""{"op":"send","seq":3,"intent":{"kind":"setAutomatic","on":false}}""")
    events.await("ack:3")
    val seen = events.snapshotBefore("ack:3")
    assertEquals("paired" to false, seen.getJSONObject("state").getString("kind") to seen.getJSONObject("pairing").getBoolean("automatic"))
    host.shutdown()
  }

  @Test
  fun `a quiet op waits while an answer is in flight, and is acked once it is handed over`() {
    val (host, events) = hostWithEvents()
    val beat = host.server.take(HttpRequest("POST", "${ScriptedServer.ORIGIN}/beats", emptyList(), "{}"))
    host.handle("""{"op":"quiet","seq":1}""")
    Thread.sleep(1_000)
    assertTrue("ack:1" !in events.names(), "acked with an answer in flight: ${events.names()}")
    host.server.handed(beat)
    events.await("ack:1")
    host.shutdown()
  }

  @Test
  fun `an unnumbered script is still acked by nothing, as before`() {
    val (host, events) = hostWithEvents()
    host.handle("""{"op":"script","path":"start","status":402,"body":{"code":"no_credit","message":"m"}}""")
    Thread.sleep(200)
    assertTrue(events.names().none { it.startsWith("ack") }, "${events.names()}")
    host.shutdown()
  }

  @Test
  fun `dueNow counts a task due now and the one running, never a task due later`() {
    val scheduler = ExecutorScheduler()
    val started = CountDownLatch(1)
    val gate = CountDownLatch(1)
    scheduler.schedule(0) {
      started.countDown()
      gate.await()
    }
    started.await()
    val before = scheduler.completed()
    scheduler.schedule(0) {}
    scheduler.schedule(60_000) {}
    scheduler.schedule(0) {}.cancel()
    assertEquals(2, scheduler.dueNow(), "the running task and the one due behind it")
    gate.countDown()
    scheduler.drain()
    assertEquals(0, scheduler.dueNow())
    assertEquals(before + 2, scheduler.completed(), "the running task and the one behind it, each once")
    scheduler.shutdown()
  }
}
