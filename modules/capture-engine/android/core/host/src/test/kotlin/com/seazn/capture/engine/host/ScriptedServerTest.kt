package com.seazn.capture.engine.host

import com.seazn.capture.engine.adapter.HttpOutcome
import com.seazn.capture.engine.adapter.HttpRequest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import org.json.JSONObject

class ScriptedServerTest {
  private val server = ScriptedServer()

  private fun ask(url: String) = server.answer(HttpRequest("GET", url, emptyList(), null)) as HttpOutcome.Answered

  @Test
  fun `by default beats wait, the code is open, and a start names its sid`() {
    assertEquals("waiting", JSONObject(ask("${ScriptedServer.ORIGIN}/beats").body).getString("state"))
    assertEquals(ScriptedServer.SID, JSONObject(ask("${ScriptedServer.ORIGIN}?slot=0&phone=p").body).getString("sid"))
    assertEquals(ScriptedServer.SID, JSONObject(ask("${ScriptedServer.ORIGIN}/start").body).getString("sid"))
  }

  @Test
  fun `a script replaces one path's answer, status and body`() {
    server.script("start", 402, JSONObject("""{"code":"no_credit","message":"m"}"""))
    val refused = ask("${ScriptedServer.ORIGIN}/start")
    assertEquals(402, refused.status)
    assertEquals("no_credit", JSONObject(refused.body).getString("code"))
    assertEquals(200, ask("${ScriptedServer.ORIGIN}/beats").status, "other paths keep theirs")
  }

  @Test
  fun `a playlist is no evidence`() {
    assertEquals(HttpOutcome.Failed("scripted host: no network"), server.answer(HttpRequest("GET", "https://customer-x.cloudflarestream.com/v.m3u8", emptyList(), null)))
  }

  // PV25: a kit typo is refused, never a script that answers nothing.
  @Test
  fun `a script for an unknown path is refused, and every path keeps its answer`() {
    val error = assertFailsWith<IllegalArgumentException> { server.script("beats", 500, JSONObject()) }
    assertEquals("unknown path beats", error.message)
    assertEquals(200, ask("${ScriptedServer.ORIGIN}/beats").status)
    assertEquals(200, ask("${ScriptedServer.ORIGIN}/start").status)
    assertEquals(200, ask("${ScriptedServer.ORIGIN}?slot=0&phone=p").status)
  }
}
