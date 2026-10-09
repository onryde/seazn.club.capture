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
data class Ids(val attempt: Int = 1, val descriptor: Int = 1, val beat: Int = 1, val playlist: Int = 1, val start: Int = 1)

/**
 * One pairing (A5): what `pair` brought, and what the server has said since. Held from Pairing until
 * Idle or Ended, with each broadcast's [Session] inside it. The token is the request's: never printed.
 */
data class PairingState(
  val request: PairRequest,
  val phone: PhoneFacts,
  /** The claim the next beat carries: the request's kind until the first 2xx (A9); `resume` again while not current (G0-d). */
  val claim: Claim?,
  val automatic: Boolean,
  val language: String,
  val heartbeat: HeartbeatState,
  val waiting: WaitingFields = WaitingFields.UNKNOWN,
  /** The platform's last readiness facts (A11); the network is the phase's own fact. */
  val readiness: Readiness = Readiness.UNKNOWN,
  /** I3: the camera while no broadcast is held (CD37 opens it on the viewfinder). A broadcast starts from it. */
  val camera: CameraState = CameraState.OWN,
  /** A17: this code and slot's stopped record, until delivered. */
  val stopped: StoppedRecord? = null,
  /** The stopped sid the beat in flight carried, so its answer can deliver it. */
  val stoppedInFlight: String? = null,
  /** Sids this pairing never starts or rejoins: refused starts (_Start failures_) and stopped ones (A17). */
  val refused: Set<String> = emptySet(),
  val starts: StartAsks = StartAsks(),
  val refusal: Refusal? = null,
  val startFailed: StartFailure? = null,
  val lastEnd: LastEnd? = null,
  /** A 401 heard while a broadcast is held: the pairing ends with the broadcast (the 401 deferral). */
  val codeEndedPending: Boolean = false,
  /** The last `heartbeat` line's fields, message aside: a paired line is written only when they change. */
  val lastBeatLine: List<Pair<String, Any?>>? = null,
  /** Plan D §3.4: every beat sent this pairing, summarised for the record ([BeatLog]). */
  val beatLog: BeatLog = BeatLog(),
  /** Final review I-2b: this pairing has had its `waiting-unreadable` line, whichever answer brought it. */
  val waitingUnreadableSaid: Boolean = false,
) {
  val name: PairingName
    get() = request.name

  val token: String
    get() = request.token
}

/** What one broadcast carries from Armed to its end, inside its pairing. */
data class Session(
  val pairing: PairingState,
  val sid: String,
  val cause: Cause,
  val broadcast: BroadcastDescriptor,
  /** The publish plan, built from [broadcast] at Arming; plan B's transports read it unchanged. */
  val config: SessionConfig,
  /** The side the broadcast encodes, read once when Armed turns to Connecting (A11). */
  val side: Side = Side.LEFT,
  val fallback: FallbackPolicy,
  val regulation: Regulation,
  val delivery: DeliveryWatch,
  val nextAttemptId: Int = 1,
  val descriptor: DescriptorAsks = DescriptorAsks(),
  /** Seeded at arm from the last network fact, which outlives the session before it (final review I-1). */
  val networkValidated: Boolean = false,
  /** Set by the first encoded frame, and kept across drops: the HUD's elapsed time never resets. */
  val liveSinceEpochMs: Long? = null,
  val notDelivered: Boolean = false,
  val camera: CameraState = CameraState.OWN,
  /** Seeded at arm from the last mic fact, which outlives the session before it, as the network's does (review 18 I1). */
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
 * The aggregate's phases (amendment, _The phases_): idle → pairing → paired → arming → armed →
 * connecting ⇄ on air, and ended. Each carries only what is true in it, so an attempt without a
 * watchdog, or an ended session with a transport, cannot be written down.
 */
sealed interface Phase {
  val name: String

  /**
   * Unpaired: before the first pairing, and after a reset or an unpair. [networkValidated] and
   * [micSilenced] are the last network and mic facts (final review I-1, review 18 I1). [unpaired] says
   * why the engine left a pairing the operator did not end.
   */
  data class Idle(
    val ids: Ids = Ids(),
    val networkValidated: Boolean = false,
    val micSilenced: Boolean = false,
    val unpaired: Unpaired? = null,
  ) : Phase {
    override val name = "idle"
  }

  /** `pair` heard; the camera and microphone permissions are being asked. No beat, no service yet. */
  data class Pairing(val pairing: PairingState, val ids: Ids, val networkValidated: Boolean, val micSilenced: Boolean) : Phase {
    override val name = "pairing"
  }

  /** Paired and waiting for a Go live (A5): beating, the service and the wake lock held. */
  data class Paired(val pairing: PairingState, val ids: Ids, val networkValidated: Boolean, val micSilenced: Boolean) : Phase {
    override val name = "paired"
  }

  /**
   * A broadcast [sid] to start or rejoin, the code being fetched for its credentials (A5). [asks]
   * spaces the fetches as plan B's descriptor asks; [notBeforeMs] holds a 429's Retry-After;
   * [notCurrent] waits for a `resume` claim's answer before fetching again (G0-d); [retrying] is set
   * by an answer that was no answer, for the status line.
   */
  data class Arming(
    val pairing: PairingState,
    val sid: String,
    val cause: Cause,
    val ids: Ids,
    val networkValidated: Boolean,
    val micSilenced: Boolean,
    val asks: DescriptorAsks,
    val notBeforeMs: Long = 0,
    val notCurrent: Boolean = false,
    val retrying: Boolean = false,
  ) : Phase {
    override val name = "arming"
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
   * The pairing is over. [durationMs] is how long the broadcast was live, from its first encoded frame
   * to its end (final review M-3); null if it never was. [networkValidated] and [micSilenced] are the
   * last network and mic facts, kept for the next pairing (final review I-1, review 18 I1). [pairing]
   * and [sid] are kept for the snapshot and the final beat.
   */
  data class Ended(
    val reason: EndReason,
    val ids: Ids,
    val durationMs: Long?,
    val networkValidated: Boolean,
    val micSilenced: Boolean,
    val pairing: PairingState? = null,
    val sid: String? = null,
    /** A8: the final beat in flight, whose answer (or [Heartbeat.TIMEOUT_MS]) releases the service. */
    val finalBeatId: Int? = null,
    val finalBeatAtMs: Long = 0,
  ) : Phase {
    override val name = "ended"
  }
}

val Phase.session: Session?
  get() =
    when (this) {
      is Phase.Armed -> session
      is Phase.Connecting -> session
      is Phase.OnAir -> session
      is Phase.Idle, is Phase.Pairing, is Phase.Paired, is Phase.Arming, is Phase.Ended -> null
    }

/** The pairing in any phase that has one; Ended keeps it for the snapshot and the final beat. */
val Phase.pairing: PairingState?
  get() =
    when (this) {
      is Phase.Pairing -> pairing
      is Phase.Paired -> pairing
      is Phase.Arming -> pairing
      is Phase.Armed -> session.pairing
      is Phase.Connecting -> session.pairing
      is Phase.OnAir -> session.pairing
      is Phase.Ended -> pairing
      is Phase.Idle -> null
    }

/** The pairing that beats: Paired to On air. Not while permissions are asked, not once Ended. */
val Phase.beating: PairingState?
  get() = if (this is Phase.Pairing || this is Phase.Ended) null else pairing

/** The sid the engine holds, from Arming to On air. */
val Phase.heldSid: String?
  get() =
    when (this) {
      is Phase.Arming -> sid
      else -> session?.sid
    }

val Phase.holdsBroadcast: Boolean
  get() = heldSid != null

/**
 * The foreground service is held: Hold went at the permission grant, so from Paired until the pairing
 * ends. Release goes only where this is true (review C0b M4); Ended's final beat keeps its own.
 */
val Phase.holdsService: Boolean
  get() = this is Phase.Paired || holdsBroadcast

/**
 * I3: the camera as the engine knows it: the session's while a broadcast is held, the pairing's
 * otherwise. Ended holds none: the end stopped capture.
 */
val Phase.camera: CameraState?
  get() = if (this is Phase.Ended) null else session?.camera ?: pairing?.camera

fun Phase.withPairing(pairing: PairingState): Phase =
  when (this) {
    is Phase.Pairing -> copy(pairing = pairing)
    is Phase.Paired -> copy(pairing = pairing)
    is Phase.Arming -> copy(pairing = pairing)
    is Phase.Ended -> copy(pairing = pairing)
    is Phase.Idle -> this
    is Phase.Armed -> copy(session = session.copy(pairing = pairing))
    is Phase.Connecting -> copy(session = session.copy(pairing = pairing))
    is Phase.OnAir -> copy(session = session.copy(pairing = pairing))
  }

/** The ids the next request of each kind takes, in any phase. */
val Phase.ids: Ids
  get() =
    when (this) {
      is Phase.Idle -> ids
      is Phase.Ended -> ids
      is Phase.Pairing -> ids.copy(beat = pairing.heartbeat.nextId, start = pairing.starts.nextId)
      is Phase.Paired -> ids.copy(beat = pairing.heartbeat.nextId, start = pairing.starts.nextId)
      is Phase.Arming -> ids.copy(beat = pairing.heartbeat.nextId, start = pairing.starts.nextId, descriptor = asks.nextId)
      is Phase.Armed -> session.ids
      is Phase.Connecting -> session.ids
      is Phase.OnAir -> session.ids
    }

/** The attempt a platform failure can come from: the one in flight or, with none in flight, the next. */
val Phase.attemptInHand: Int
  get() =
    when (this) {
      is Phase.OnAir -> attemptId
      is Phase.Connecting -> (step as? ConnectStep.Requested)?.attemptId ?: ids.attempt
      is Phase.Idle, is Phase.Pairing, is Phase.Paired, is Phase.Arming, is Phase.Armed, is Phase.Ended -> ids.attempt
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
      is Phase.Pairing -> networkValidated
      is Phase.Paired -> networkValidated
      is Phase.Arming -> networkValidated
      is Phase.Armed -> session.networkValidated
      is Phase.Connecting -> session.networkValidated
      is Phase.OnAir -> session.networkValidated
    }

/** This phase with [validated] as the network fact, in the session or, with none, kept for the next. */
fun Phase.withNetwork(validated: Boolean): Phase =
  when (this) {
    is Phase.Idle -> copy(networkValidated = validated)
    is Phase.Ended -> copy(networkValidated = validated)
    is Phase.Pairing -> copy(networkValidated = validated)
    is Phase.Paired -> copy(networkValidated = validated)
    is Phase.Arming -> copy(networkValidated = validated)
    is Phase.Armed -> copy(session = session.copy(networkValidated = validated))
    is Phase.Connecting -> copy(session = session.copy(networkValidated = validated))
    is Phase.OnAir -> copy(session = session.copy(networkValidated = validated))
  }

/**
 * The last mic fact (`isClientSilenced` for our recording, F-P5-8), in any phase. The watch reports a
 * change only, and keeps its last word for the process, so the engine keeps the fact between sessions
 * the way it keeps the network's, and each session is seeded with it at arm (review 18 I1).
 */
val Phase.micSilenced: Boolean
  get() =
    when (this) {
      is Phase.Idle -> micSilenced
      is Phase.Ended -> micSilenced
      is Phase.Pairing -> micSilenced
      is Phase.Paired -> micSilenced
      is Phase.Arming -> micSilenced
      is Phase.Armed -> session.micSilenced
      is Phase.Connecting -> session.micSilenced
      is Phase.OnAir -> session.micSilenced
    }

/** This phase with [silenced] as the mic fact, in the session or, with none, kept for the next. */
fun Phase.withMic(silenced: Boolean): Phase =
  when (this) {
    is Phase.Idle -> copy(micSilenced = silenced)
    is Phase.Ended -> copy(micSilenced = silenced)
    is Phase.Pairing -> copy(micSilenced = silenced)
    is Phase.Paired -> copy(micSilenced = silenced)
    is Phase.Arming -> copy(micSilenced = silenced)
    is Phase.Armed -> copy(session = session.copy(micSilenced = silenced))
    is Phase.Connecting -> copy(session = session.copy(micSilenced = silenced))
    is Phase.OnAir -> copy(session = session.copy(micSilenced = silenced))
  }

/**
 * The phase a session ends in, from any phase: the ids and the network and mic facts carry on to the next
 * session. The duration counts from the first encoded frame on the wall clock, outages included, as
 * the HUD's elapsed clock does (final review M-3); a wall clock set back past that frame reads 0. An
 * ended session ended again stays as it ended: its reason and duration stand (final review N-2).
 */
fun Phase.ended(reason: EndReason, now: Now): Phase.Ended {
  if (this is Phase.Ended) return this
  val durationMs = session?.liveSinceEpochMs?.let { (now.wallMs - it).coerceAtLeast(0) }
  return Phase.Ended(reason, ids, durationMs, networkValidated, micSilenced, pairing, heldSid)
}

val Session.ids: Ids
  get() =
    Ids(
      attempt = nextAttemptId,
      descriptor = descriptor.nextId,
      beat = pairing.heartbeat.nextId,
      playlist = delivery.nextRequestId,
      start = pairing.starts.nextId,
    )

fun Phase.withSession(session: Session): Phase =
  when (this) {
    is Phase.Armed -> copy(session = session)
    is Phase.Connecting -> copy(session = session)
    is Phase.OnAir -> copy(session = session)
    is Phase.Idle, is Phase.Pairing, is Phase.Paired, is Phase.Arming, is Phase.Ended -> this
  }
