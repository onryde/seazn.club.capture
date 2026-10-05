package com.seazn.capture.engine.debug

import com.seazn.capture.engine.adapter.HttpOutcome
import com.seazn.capture.engine.adapter.HttpRequest
import com.seazn.capture.engine.core.RecordEntry
import com.seazn.capture.engine.http.HttpPort
import java.io.File
import java.nio.file.Files
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.LinkedBlockingQueue
import java.util.concurrent.TimeUnit
import kotlin.test.AfterTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * The scripted code server (Task 34) on the JVM: it answers the code, its beats and its start from the
 * file, sends everything else to the real port, reads the file off the caller's thread, and writes a
 * record line that names the route and the status, never a body. Every value is made up.
 */
class ScriptedCodeServerTest {
  private val dir = Files.createTempDirectory("scripted").toFile()
  private val file = File(dir, ScriptedCodeServer.FILE)
  private val codes = "https://stg.seazn.club/api/v1/capture/codes/fx42hmnp7k2q"

  /** The network's stand-in: every request it is handed, answered at once. */
  private val sent = CopyOnWriteArrayList<HttpRequest>()
  private val real =
    object : HttpPort {
      override fun send(request: HttpRequest, answer: (HttpOutcome) -> Unit) {
        sent += request
        answer(HttpOutcome.Answered(200, "from the network", null))
      }
    }
  private val lines = CopyOnWriteArrayList<RecordEntry>()
  private val server = ScriptedCodeServer(file, real) { lines += it }

  /** Each answer with the thread it came on. */
  private val answers = LinkedBlockingQueue<Pair<HttpOutcome, String>>()

  @AfterTest
  fun clean() {
    dir.deleteRecursively()
  }

  private fun ask(method: String, url: String): HttpOutcome {
    server.send(HttpRequest(method, url, emptyList(), null)) { answers.put(it to Thread.currentThread().name) }
    val (outcome, thread) = answers.poll(10, TimeUnit.SECONDS) ?: error("no answer in 10 s")
    assertNull(answers.poll(100, TimeUnit.MILLISECONDS), "a request is answered once")
    assertEquals("scripted-http", thread, "answered on the server's own thread, never the caller's")
    return outcome
  }

  private fun script(text: String, modified: Long) {
    file.writeText(text)
    assertTrue(file.setLastModified(modified))
  }

  @Test
  fun `with no file every request goes to the network, and no line is written`() {
    assertEquals(HttpOutcome.Answered(200, "from the network", null), ask("POST", "$codes/beats"))
    assertEquals(listOf("$codes/beats"), sent.map { it.url })
    assertEquals(emptyList(), lines)
  }

  @Test
  fun `a scripted route is answered from the file, and a line names its route and status, never its body`() {
    script("""{"beat":[{"status":200,"body":{"state":"waiting","streamKey":"key-made-up-0002"}}]}""", 1_000)
    val answer = ask("POST", "$codes/beats") as HttpOutcome.Answered
    assertEquals(200, answer.status)
    assertTrue("key-made-up-0002" in answer.body)
    assertEquals(emptyList(), sent, "nothing reached the network")
    assertEquals(listOf(RecordEntry("scripted", listOf("action" to "beat", "status" to 200))), lines)
    assertFalse(lines.any { "key-made-up-0002" in it.toString() })
  }

  @Test
  fun `a request the script does not route goes to the network, script or not`() {
    script("""{"code":[{"status":200,"body":{}}]}""", 1_000)
    ask("GET", "https://customer-x.cloudflarestream.com/x/manifest/video.m3u8")
    assertEquals(1, sent.size)
    assertEquals(emptyList(), lines)
  }

  @Test
  fun `a no-answer, an unreadable script and an unscripted route each fail by a word, with a line`() {
    script("""{"start":[{"fail":true}]}""", 1_000)
    assertEquals(HttpOutcome.Failed("ScriptedFailure"), ask("POST", "$codes/start"))
    assertEquals(HttpOutcome.Failed("Unscripted"), ask("POST", "$codes/beats"))
    script("{nope", 2_000)
    assertEquals(HttpOutcome.Failed("ScriptUnreadable"), ask("POST", "$codes/start"))
    assertEquals(listOf("fail", "unscripted", "unreadable"), lines.map { it.fields.first().second })
    assertEquals(listOf(null, null, null), lines.map { it.fields[1].second })
    assertEquals(emptyList(), sent)
  }

  @Test
  fun `a replaced file starts its routes again, and an unchanged one keeps their places`() {
    val text = """{"beat":[{"status":200,"body":{"n":1}},{"status":200,"body":{"n":2}}]}"""
    script(text, 1_000)
    val bodies = mutableListOf<String>()
    repeat(2) { bodies += (ask("POST", "$codes/beats") as HttpOutcome.Answered).body }
    script(text, 2_000)
    bodies += (ask("POST", "$codes/beats") as HttpOutcome.Answered).body
    assertEquals(listOf("""{"n":1}""", """{"n":2}""", """{"n":1}"""), bodies)
  }

  /** A script that exists and cannot be read (here a folder by its name) is unreadable: still one answer. */
  @Test
  fun `a script that cannot be read is answered as unreadable, once`() {
    assertTrue(file.mkdir())
    assertEquals(HttpOutcome.Failed("ScriptUnreadable"), ask("POST", "$codes/beats"))
    assertEquals(listOf("unreadable"), lines.map { it.fields.first().second })
  }

  @Test
  fun `a file deleted mid-run sends the next request to the network`() {
    script("""{"beat":[{"status":200,"body":{}}]}""", 1_000)
    ask("POST", "$codes/beats")
    assertTrue(file.delete())
    ask("POST", "$codes/beats")
    assertEquals(1, sent.size)
  }
}
