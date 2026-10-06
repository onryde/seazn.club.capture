package com.seazn.capture.engine.http

import com.seazn.capture.engine.adapter.HttpOutcome
import com.seazn.capture.engine.adapter.HttpRequest

/**
 * One HTTP request, answered exactly once on any thread (Task 34). [HttpAdapter] is the network's. In
 * the HTTP folder, beside nothing Android, so core's tests compile it with the adapter.
 */
interface HttpPort {
  fun send(request: HttpRequest, answer: (HttpOutcome) -> Unit)
}
