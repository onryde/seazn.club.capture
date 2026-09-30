package com.seazn.capture.engine.core

/**
 * Our camera, as the machine knows it. [slateOnAir]: the slate is on air in its place, so the stall
 * watchdog holds instead of rebuilding (F-P5-10). [shownTaken]: the snapshot says `camera-taken`.
 * A state other than [OWN] with no outage holds the session's LIVE state while frames pause: the
 * pause is another app's, or our own reopen or switch waiting for its camera's first frame. The
 * snapshot carries it as `camera` (B6 fix 2), so JavaScript can tell our own reopen or switch from a
 * camera another app has taken.
 */
enum class CameraState(override val wire: String, val slateOnAir: Boolean, val shownTaken: Boolean) : Wire {
  OWN("own", slateOnAir = false, shownTaken = false),

  /** Another app holds a camera (F-P5-9). */
  TAKEN("taken", slateOnAir = true, shownTaken = true),

  /** Released, and [Command.ReopenCamera] asked for; the slate stays up until the answer. */
  REOPENING("reopening", slateOnAir = true, shownTaken = true),

  /**
   * Reopened and the slate off, with no frame from the camera yet. Still shown as taken: the reopen
   * is not a frame (carry 6), and a camera that never delivers is rebuilt 3 s after the reopen.
   */
  RESUMING("resuming", slateOnAir = false, shownTaken = true),

  /**
   * The operator switched cameras, and the new one has not delivered a frame yet (ruling 14). LIVE
   * holds until 3 s after the switch when a frame came within one sample of it (B7 N3), otherwise 3 s
   * after the last frame before it (B6 fix 2), plus at most one tick; then the pipeline is rebuilt.
   * Past the last real frame that is at most 3.5 s with Frames readings every tick, and under 4 s
   * without (B7 ruling m1, amended).
   */
  SWITCHING("switching", slateOnAir = false, shownTaken = false),
}

/**
 * The next id of each kind of platform request. Carried from one session to the next — through
 * [Phase.Ended] and [Phase.Idle] — so an answer the last session asked for never matches one the
 * next session asks for (B6 review m3).
 */
data class Ids(val attempt: Int = 1, val descriptor: Int = 1, val beat: Int = 1, val playlist: Int = 1)

/** What one operator session carries from arm to its end. */
data class Session(
  val config: SessionConfig,
  val fallback: FallbackPolicy,
  val regulation: Regulation,
  val heartbeat: HeartbeatState,
  val delivery: DeliveryWatch,
  val nextAttemptId: Int = 1,
  val descriptor: DescriptorAsks = DescriptorAsks(),
  /** Seeded at arm from the last network fact, which outlives the session before it (final review I-1). */
  val networkValidated: Boolean = false,
  /** Set by the first encoded frame, and kept across drops: the HUD's elapsed time never resets. */
  val liveSinceEpochMs: Long? = null,
  val notDelivered: Boolean = false,
  val camera: CameraState = CameraState.OWN,
  val micSilenced: Boolean = false,
  val device: DeviceSample? = null,
  val dataUsedBytes: Long = 0,
)

/** A live session that is not publishing now. It lasts until encoded frames advance again. */
data class Outage(val hold: Hold, val cause: ReconnectCause)

sealed interface ConnectStep {
  /** Between attempts: the next connect goes at [connectAtMs]. */
  data class Waiting(val connectAtMs: Long) : ConnectStep

  /** Attempt [attemptId] was asked for at [atMs] and has not answered. */
  data class Requested(val attemptId: Int, val atMs: Long) : ConnectStep
}

/**
 * The aggregate's phases: idle → armed → connecting → on air ⇄ connecting → ended (spec §3). Each
 * carries only what is true in it, so an attempt without a watchdog, or an ended session with a
 * transport, cannot be written down.
 */
sealed interface Phase {
  val name: String

  /** Before the first session, and after a reset. [networkValidated] is the last network fact (final review I-1). */
  data class Idle(val ids: Ids = Ids(), val networkValidated: Boolean = false) : Phase {
    override val name = "idle"
  }

  data class Armed(val session: Session) : Phase {
    override val name = "armed"
  }

  data class Connecting(val session: Session, val transport: Transport, val step: ConnectStep, val outage: Outage?) : Phase {
    override val name = "connecting"
  }

  /**
   * Connected. LIVE only while [watchdog] says frames advance. [meter] has no default: it starts at
   * the connect's zero counters (carry 13), so the first reading counts from the connect.
   */
  data class OnAir(
    val session: Session,
    val attemptId: Int,
    val transport: Transport,
    val connectedAtMs: Long,
    val watchdog: StallWatchdog,
    val meter: LinkMeter,
    val srt: SrtTelemetry? = null,
    val egressBps: Long? = null,
    val outage: Outage?,
  ) : Phase {
    override val name = "on-air"
  }

  /**
   * The session is over. [durationMs] is how long it was live, from its first encoded frame to its end
   * (final review M-3); null if it never was. [networkValidated] is the last network fact, kept for the
   * next session (final review I-1).
   */
  data class Ended(val reason: EndReason, val ids: Ids, val durationMs: Long?, val networkValidated: Boolean) : Phase {
    override val name = "ended"
  }
}

val Phase.session: Session?
  get() =
    when (this) {
      is Phase.Armed -> session
      is Phase.Connecting -> session
      is Phase.OnAir -> session
      is Phase.Idle, is Phase.Ended -> null
    }

/** The ids the next request of each kind takes, in any phase. */
val Phase.ids: Ids
  get() =
    when (this) {
      is Phase.Idle -> ids
      is Phase.Ended -> ids
      is Phase.Armed -> session.ids
      is Phase.Connecting -> session.ids
      is Phase.OnAir -> session.ids
    }

/**
 * The last network fact (`NET_CAPABILITY_VALIDATED`), in any phase. The platform pushes it when it
 * changes, which can be before an arm or once for two sessions, so it is kept between sessions the
 * way [Ids] are, and each session is seeded with it at arm (final review I-1).
 */
val Phase.networkValidated: Boolean
  get() =
    when (this) {
      is Phase.Idle -> networkValidated
      is Phase.Ended -> networkValidated
      is Phase.Armed -> session.networkValidated
      is Phase.Connecting -> session.networkValidated
      is Phase.OnAir -> session.networkValidated
    }

/** This phase with [validated] as the network fact, in the session or, with none, kept for the next. */
fun Phase.withNetwork(validated: Boolean): Phase =
  when (this) {
    is Phase.Idle -> copy(networkValidated = validated)
    is Phase.Ended -> copy(networkValidated = validated)
    is Phase.Armed -> copy(session = session.copy(networkValidated = validated))
    is Phase.Connecting -> copy(session = session.copy(networkValidated = validated))
    is Phase.OnAir -> copy(session = session.copy(networkValidated = validated))
  }

/**
 * The phase a session ends in, from any phase: the ids and the network fact carry on to the next
 * session. The duration counts from the first encoded frame on the wall clock, outages included, as
 * the HUD's elapsed clock does (final review M-3); a wall clock set back past that frame reads 0. An
 * ended session ended again (the engine's fatal error) keeps the duration it had.
 */
fun Phase.ended(reason: EndReason, now: Now): Phase.Ended {
  if (this is Phase.Ended) return copy(reason = reason)
  val durationMs = session?.liveSinceEpochMs?.let { (now.wallMs - it).coerceAtLeast(0) }
  return Phase.Ended(reason, ids, durationMs, networkValidated)
}

val Session.ids: Ids
  get() = Ids(attempt = nextAttemptId, descriptor = descriptor.nextId, beat = heartbeat.nextId, playlist = delivery.nextRequestId)

fun Phase.withSession(session: Session): Phase =
  when (this) {
    is Phase.Armed -> copy(session = session)
    is Phase.Connecting -> copy(session = session)
    is Phase.OnAir -> copy(session = session)
    is Phase.Idle, is Phase.Ended -> this
  }
