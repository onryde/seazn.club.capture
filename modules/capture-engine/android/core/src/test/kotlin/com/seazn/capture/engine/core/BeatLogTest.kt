package com.seazn.capture.engine.core

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * Plan D spec §3.4: every beat sent, in the record, summarised (plan D1, D-3 and D-4): a `beat-interval` line when the
 * cadence changes, a `beats` line per minute a beat went. The minutes are worked by hand: the rig's wall clock starts
 * at 1_790_000_000_000 ms (2026-09-21T14:13:20.000Z) = 29_833_333 × 60_000 + 20_000, so 20 s into the minute that
 * starts at 1_789_999_980_000 (minute A).
 */
class BeatLogTest {
  private val minuteA = 1_789_999_980_000L

  /** [ms] after the rig's start, on both clocks. */
  private fun at(ms: Long) = Now(ms, 1_790_000_000_000L + ms)

  private fun interval(intervalMs: Long, sinceLastMs: Long?, held: Boolean) =
    RecordEntry("beat-interval", listOf("intervalMs" to intervalMs, "sinceLastMs" to sinceLastMs, "held" to held))

  private fun minute(minuteEpochMs: Long, sent: Int, failed: Int, word: String?) =
    RecordEntry("beats", listOf("minuteEpochMs" to minuteEpochMs, "sent" to sent, "failed" to failed, "word" to word))

  private fun beats(commands: List<Command>): List<RecordEntry> =
    commands.filterIsInstance<Command.Record>().map { it.entry }.filter { it.kind == "beats" }

  @Test
  fun `the first beat writes its interval, with no beat before it`() {
    val (log, lines) = BeatLog().send(1, 60_000, held = false, at(0))
    assertEquals(listOf(interval(60_000, null, false)), lines)
    assertEquals(1, log.sent)
  }

  @Test
  fun `a change of cadence is a line with the gap since the beat before, and the same cadence is none`() {
    val (first, _) = BeatLog().send(1, 60_000, held = false, at(0))
    // 60 s after the start is 20 s into the next minute: the closed minute's line, and no interval line.
    val (second, same) = first.send(2, 60_000, held = false, at(60_000))
    assertEquals(listOf("beats"), same.map { it.kind })
    val (_, changed) = second.send(3, 10_000, held = true, at(67_500))
    assertEquals(listOf(interval(10_000, 7_500, true)), changed)
  }

  @Test
  fun `a minute's beats are one line, written by the first beat of the next minute`() {
    var log = BeatLog()
    val lines = mutableListOf<RecordEntry>()
    // 0, 10, 20 and 30 s after the start are 20, 30, 40 and 50 s into minute A; the third beat's answer fails.
    for ((id, s) in listOf(0L, 10L, 20L, 30L).withIndex()) {
      val (sent, written) = log.send(id + 1, 10_000, held = false, at(s * 1_000))
      lines += written
      log = sent.heard("NoBroadcast", ok = s != 20L)
    }
    assertEquals(listOf(interval(10_000, null, false)), lines)
    val (_, next) = log.send(5, 10_000, held = false, at(40_000))
    assertEquals(listOf(minute(minuteA, sent = 4, failed = 1, word = "NoBroadcast")), next)
  }

  @Test
  fun `the A8 final beat goes off the cadence - no interval line, and the cadence it leaves stands`() {
    val (first, _) = BeatLog().send(1, 10_000, held = true, at(0))
    val (afterFinal, lines) = first.send(2, intervalMs = null, held = true, at(1_000))
    assertEquals(emptyList(), lines)
    // 11 s after the start is still minute A: a beat at the cadence before the final beat writes nothing.
    assertEquals(emptyList(), afterFinal.send(3, 10_000, held = true, at(11_000)).second)
  }

  @Test
  fun `a minute with no beat writes no line, and a log that sent nothing has none to write (an empty input)`() {
    val (first, _) = BeatLog().send(1, 60_000, held = false, at(0))
    // 130 s after the start is 30 s into the minute after next: the minute between had no beat.
    val (_, lines) = first.send(2, 60_000, held = false, at(130_000))
    assertEquals(listOf(minute(minuteA, sent = 1, failed = 0, word = null)), lines)
    assertNull(BeatLog().minuteLine())
  }

  @Test
  fun `three hours paired at 10 s are one interval line and one line a minute, counting every beat sent`() {
    val rig = MachineRig().paired()
    rig.beats = { HeartbeatResponse.Answered(200, BeatReply("waiting", null, null, null, Configs.waiting(10))) }
    rig.hear("waiting")
    rig.advance(3 * 60 * 60 * 1_000L)
    rig.send(Input.Unpair)
    // Before the first answer the cadence is BeatCadence.DEFAULT_POLL_S, 10 s, and the server keeps 10: one line.
    assertEquals(listOf(interval(10_000, null, false)), rig.records("beat-interval"))
    val minutes = rig.records("beats")
    assertEquals(rig.sent<Command.PostHeartbeat>().size, minutes.sumOf { it.field("sent") as Int })
    // 20 s into minute A to 20 s into minute A + 180: 181 minutes, the first (4 beats) and the last (3) partial.
    assertEquals(181, minutes.size)
    assertEquals(listOf(4, 3), listOf(minutes.first().field("sent"), minutes.last().field("sent")))
    assertTrue(minutes.drop(1).dropLast(1).all { it.field("sent") == 6 }, "a whole minute at 10 s is 6 beats")
    assertTrue(minutes.all { it.field("failed") == 0 && it.field("word") == "NoBroadcast" })
  }

  @Test
  fun `three hours of held beats at 10 s write at most 200 beat lines (N25)`() {
    val rig = MachineRig().armed()
    rig.beats = { HeartbeatResponse.Answered(200, BeatReply("go-live", "sess_42", "organiser", null, Configs.waiting(10))) }
    rig.advance(3 * 60 * 60 * 1_000L)
    // Armed holds sess_42 throughout, so every beat is a held one (held = heldSid != null), with no uplink to fake.
    assertTrue(rig.phase is Phase.Armed, rig.phase.name)
    // Worked by hand: 180 minutes, each closed by the next minute's first beat (180 `beats` lines); one interval line
    // (10 s throughout, held or not); and a `heartbeat` line only when the answer changes (the go-live that answered
    // the claim, then the first answer without a claim): 183, under the owner's bar of 200. A line per held beat
    // would add about 1,080.
    assertEquals(180, rig.records("beats").size)
    val lines = listOf("heartbeat", "beat-interval", "beats").sumOf { rig.records(it).size }
    assertTrue(lines <= 200, "$lines beat lines")
  }

  @Test
  fun `the open minute is written once when the operator unpairs, and never again (a second call)`() {
    val rig = MachineRig().paired()
    rig.hear("waiting")
    assertEquals(listOf(minute(minuteA, sent = 1, failed = 0, word = "NoBroadcast")), beats(rig.send(Input.Unpair)))
    assertEquals(emptyList(), beats(rig.send(Input.Unpair)))
  }

  @Test
  fun `an answer that comes twice is counted once (a second call)`() {
    val rig = MachineRig().paired()
    val answer = Input.HeartbeatAnswered(rig.phase.beating!!.heartbeat.inFlightId!!, HeartbeatResponse.Answered(503))
    rig.send(answer)
    rig.send(answer)
    assertEquals(1, beats(rig.send(Input.Unpair)).single().field("failed"))
  }

  @Test
  fun `a beat that never comes back counts as failed (after an interruption)`() {
    val rig = MachineRig().paired()
    // The claim at 0 is never answered: at 10 s it is given up (Heartbeat.TIMEOUT_MS) and the next beat goes.
    rig.advance(10_000)
    val line = beats(rig.send(Input.Unpair)).single()
    assertEquals(listOf<Any?>(2, 1), listOf(line.field("sent"), line.field("failed")))
  }

  @Test
  fun `a beat given up keeps the last word heard in the minute (after an interruption)`() {
    val rig = MachineRig().paired()
    rig.hear("waiting")
    // The beat at 10 s is never answered: at 20 s it is given up and the beat at 20 s goes, all in minute A. A beat
    // given up is no answer, so the word stays the last one heard; the beat at 20 s is sent and never answered.
    rig.advance(20_000)
    assertEquals(listOf(minute(minuteA, sent = 3, failed = 1, word = "NoBroadcast")), beats(rig.send(Input.Unpair)))
  }

  @Test
  fun `a Go live that shortens the cadence writes a held interval line`() {
    val rig = MachineRig().paired()
    rig.hear("waiting", pollSeconds = 60)
    // The next beat goes at 60 s, at the 60 s the server asked; its answer arms sess_42, whose code answers 10 s.
    rig.hear("go-live", sid = "sess_42", startedBy = "organiser", pollSeconds = 60)
    rig.advance(10_000)
    assertEquals(
      listOf(interval(10_000, null, false), interval(60_000, 60_000, false), interval(10_000, 10_000, true)),
      rig.records("beat-interval"),
    )
  }

  @Test
  fun `a pairing that never beat writes no minute (an empty input)`() {
    val rig = MachineRig()
    rig.permissions = null
    rig.send(Input.Pair(rig.request, Configs.PHONE, stopped = null))
    assertEquals(emptyList(), beats(rig.send(Input.Unpair)))
  }

  @Test
  fun `the answer that unpairs the phone counts in its minute - replaced`() {
    val rig = MachineRig().paired()
    // The claim at 0, 20 s into minute A, is answered `replaced`, a 2xx: the phone leaves the pairing on that answer.
    val lines = beats(rig.hear("replaced"))
    assertTrue(rig.phase is Phase.Idle, rig.phase.name)
    assertEquals(listOf(minute(minuteA, sent = 1, failed = 0, word = "Replaced")), lines)
  }

  @Test
  fun `the answer that unpairs the phone counts in its minute - taken`() {
    val rig = MachineRig().paired()
    val lines = beats(rig.hear("taken"))
    assertTrue(rig.phase is Phase.Idle, rig.phase.name)
    assertEquals(listOf(minute(minuteA, sent = 1, failed = 0, word = "Taken")), lines)
  }

  @Test
  fun `the answer that unpairs the phone counts in its minute - a 401 while paired`() {
    val rig = MachineRig().paired()
    // A 401 is no 2xx: the claim failed, and its word ends the code.
    val lines = beats(rig.hear(null, status = 401))
    assertTrue(rig.phase is Phase.Idle, rig.phase.name)
    assertEquals(listOf(minute(minuteA, sent = 1, failed = 1, word = "CodeEnded")), lines)
  }

  @Test
  fun `the answer that unpairs the phone counts in its minute - a 401 while arming`() {
    val rig = MachineRig().paired()
    rig.codes = null
    // The claim at 0 is answered go-live (Open) and arms sess_42, whose code never answers. The held beat at 10 s,
    // 30 s into minute A, goes from Arming; its 401 ends the code.
    rig.hear("go-live", sid = "sess_42", startedBy = "organiser")
    rig.advance(10_000)
    assertTrue(rig.phase is Phase.Arming, rig.phase.name)
    val lines = beats(rig.hear(null, status = 401))
    assertTrue(rig.phase is Phase.Idle, rig.phase.name)
    assertEquals(listOf(minute(minuteA, sent = 2, failed = 1, word = "CodeEnded")), lines)
  }

  @Test
  fun `a re-pair writes the old pairing's minute and starts its own log (another pairing)`() {
    val rig = MachineRig().paired()
    rig.hear("waiting")
    rig.send(Input.Pair(Configs.pairRequest(slot = 2), Configs.PHONE, stopped = null))
    assertEquals(listOf(minute(minuteA, sent = 1, failed = 0, word = "NoBroadcast")), rig.records("beats"))
    assertEquals(listOf(interval(10_000, null, false), interval(10_000, null, false)), rig.records("beat-interval"))
  }

  @Test
  fun `a Stop from air counts the final beat and writes the minute`() {
    val rig = MachineRig().live()
    val before = rig.sent<Command.PostHeartbeat>().size
    val stop = rig.send(Input.Stop)
    assertEquals(before + 1, rig.sent<Command.PostHeartbeat>().size, "the final beat (A8)")
    assertEquals(1, beats(stop).size)
    assertEquals(rig.sent<Command.PostHeartbeat>().size, rig.records("beats").sumOf { it.field("sent") as Int })
  }

  @Test
  fun `a Stop whose final beat opens a new minute writes the minute before it and its own`() {
    val rig = MachineRig().live()
    // No tick from 1 s to 45 s, so no beat at the cadence: the claim at 0, answered go-live (Open), is minute A's only
    // beat, and the final beat at 45 s (65 s into minute A) is the first of the next minute.
    rig.at(45_000)
    val stop = rig.send(Input.Stop)
    assertEquals(listOf(minute(minuteA, sent = 1, failed = 0, word = "Open"), minute(minuteA + 60_000, sent = 1, failed = 0, word = null)), beats(stop))
  }

  @Test
  fun `both lines pass the record's scrub as written`() {
    val written = mutableListOf<String>()
    val record = SessionRecord { written += it }
    record.append(1_790_000_000_000L, interval(10_000, 7_500, true))
    record.append(1_790_000_000_000L, minute(minuteA, sent = 6, failed = 1, word = "NoBroadcast"))
    assertEquals(
      listOf(
        """{"at":"2026-09-21T14:13:20.000Z","kind":"beat-interval","intervalMs":10000,"sinceLastMs":7500,"held":true}""",
        """{"at":"2026-09-21T14:13:20.000Z","kind":"beats","minuteEpochMs":1789999980000,"sent":6,"failed":1,"word":"NoBroadcast"}""",
      ),
      written,
    )
  }
}
