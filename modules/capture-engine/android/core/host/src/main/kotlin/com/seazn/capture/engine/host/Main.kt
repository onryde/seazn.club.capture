package com.seazn.capture.engine.host

import java.io.FileDescriptor
import java.io.FileOutputStream
import java.io.PrintStream
import kotlin.system.exitProcess

/**
 * The JVM host (plan C, CD8): NDJSON on stdin and stdout, nothing else on stdout. Reads until `exit`
 * or the end of stdin, lets the work already due finish, so the last intent's ack is written, and
 * exits 0.
 */
fun main() {
  val out = PrintStream(FileOutputStream(FileDescriptor.out), true, Charsets.UTF_8)
  val lock = Any()
  val scheduler = ExecutorScheduler()
  val host = Host(scheduler) { line -> synchronized(lock) { out.println(line) } }
  val input = System.`in`.bufferedReader(Charsets.UTF_8)
  while (true) {
    val line = input.readLine() ?: break
    if (!host.handle(line)) break
  }
  scheduler.drain()
  host.shutdown()
  scheduler.shutdown()
  out.flush()
  exitProcess(0)
}
