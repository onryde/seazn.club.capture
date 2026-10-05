package com.seazn.capture.engine.debug

import com.seazn.capture.engine.adapter.HttpOutcome
import com.seazn.capture.engine.adapter.HttpRequest
import com.seazn.capture.engine.core.RecordEntry
import com.seazn.capture.engine.debug.ScriptAnswers.Result
import com.seazn.capture.engine.http.HttpPort
import java.io.File
import java.io.IOException
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean

/**
 * The device gate's stand-in for the web (debug builds only). Reads [file] on its own thread, never
 * on the scheduler thread (CD9). A record line names the route and the status, never the body: a
 * scripted body can hold a stream key or a passphrase. Every request is answered once, whatever its
 * handling throws, and the server keeps serving (C6 m-5). Pure JVM, beside the rules, so core's tests
 * run it; the Android installer lives one folder up.
 */
class ScriptedCodeServer(private val file: File, private val real: HttpPort, private val line: (RecordEntry) -> Unit) : HttpPort {
  private val answers = ScriptAnswers()
  private val io = Executors.newSingleThreadExecutor { task -> Thread(task, "scripted-http") }

  override fun send(request: HttpRequest, answer: (HttpOutcome) -> Unit) {
    val answered = AtomicBoolean(false)
    val once = { outcome: HttpOutcome -> if (answered.compareAndSet(false, true)) answer(outcome) }
    io.execute {
      try {
        serve(request, once)
      } catch (failure: Exception) {
        said("failed", null) { once(HttpOutcome.failed(failure)) } // by its class alone, as every failure is
      }
    }
  }

  private fun serve(request: HttpRequest, answer: (HttpOutcome) -> Unit) {
    when (val scripted = scripted(request)) {
      Result.Pass -> real.send(request, answer)
      Result.Fail -> said("fail", null) { answer(HttpOutcome.Failed("ScriptedFailure")) }
      Result.Unreadable -> said("unreadable", null) { answer(HttpOutcome.Failed("ScriptUnreadable")) }
      Result.Unscripted -> said("unscripted", null) { answer(HttpOutcome.Failed("Unscripted")) }
      is Result.Answer -> said(scripted.route, scripted.status) { answer(HttpOutcome.Answered(scripted.status, scripted.body, scripted.retryAfter)) }
    }
  }

  /** The script's answer, read now. A file that cannot be read is unreadable: every request is still answered. */
  private fun scripted(request: HttpRequest): Result =
    try {
      val script = file.takeIf { it.exists() }?.let { ScriptAnswers.Script(it.readText(), it.lastModified()) }
      answers.answer(request.method, request.url, script)
    } catch (_: IOException) {
      Result.Unreadable
    }

  private fun said(action: String, status: Int?, then: () -> Unit) {
    line(RecordEntry("scripted", listOf("action" to action, "status" to status)))
    then()
  }

  companion object {
    const val FILE = "scripted-code.json"
  }
}
