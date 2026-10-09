package com.seazn.capture.engine.core

import java.net.URI
import kotlin.test.Test
import kotlin.test.assertEquals

/**
 * Plan D spec §3.5: the test fakes name the paths the web serves, `GET {origin}/api/v1/capture/codes/{code}`,
 * `…/beats` and `…/start` (spec §2), never one it does not. The engine reads its URLs from the descriptor, so this
 * is for the next reader of a test, who should not learn a path from a fake that the server never answered.
 */
class ConfigsTest {
  @Test
  fun `the fakes' URLs are the web's capture paths`() {
    val request = Configs.pairRequest()
    assertEquals(
      listOf(
        "/api/v1/capture/codes/fx42hmnp7k2q",
        "/api/v1/capture/codes/fx42hmnp7k2q/beats",
        "/api/v1/capture/codes/fx42hmnp7k2q/start",
        "/api/v1/capture/codes/fx42hmnp7k2q/beats",
      ),
      listOf(request.codeUrl, request.heartbeatUrl, request.startUrl, Configs.valid().heartbeatUrl).map { URI(it).path },
    )
  }
}
