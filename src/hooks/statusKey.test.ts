import { describe, expect, it } from 'vitest';
import type { Cause, LastEnd, NotReady, Readiness, Refusal } from '@/domain/session/Pairing';
import type { DegradeReason, SessionState } from '@/domain/session/SessionState';
import type { CameraState, EngineSnapshot, Telemetry } from '@/engine/CaptureEnginePort';
import { createFakeCaptureEngine } from '@/engine/FakeCaptureEngine';
import { IDLE_TELEMETRY } from '@/engine/unreported';
import {
  columnLineKey,
  selectHoldRemaining,
  selectHoldWindow,
  selectStatusKey,
  STATUS_LINE_BUDGET,
  type StatusKey,
} from '@/hooks/statusKey';
import en from '@/i18n/en.json';
import es from '@/i18n/es.json';
import fr from '@/i18n/fr.json';
import nl from '@/i18n/nl.json';
import { createTranslator } from '@/i18n/translate';

/** A level, any level: on air the level decides nothing (spec §4). */
const ARMED_OK: Partial<Telemetry> = { audioLevel: 0.4 };
const READY: Readiness = { camera: true, sound: true, network: true, held: true };
/** Plan B's `Snapshot.camera`: our own with a pairing, none without one. */
const ownCamera = (state: SessionState): CameraState | null =>
  state.kind === 'idle' || state.kind === 'ended' ? null : 'own';
const snap = (
  state: SessionState,
  telemetry: Partial<Telemetry> = ARMED_OK,
  camera: CameraState | null = ownCamera(state),
  ready: Partial<Readiness> = {},
): EngineSnapshot => ({
  state,
  telemetry: { ...IDLE_TELEMETRY, ...telemetry },
  pairing: null,
  broadcast: null,
  ready: { ...READY, ...ready },
  refusal: null,
  lastEnd: null,
  unpaired: null,
  codeEndedPending: false,
  camera,
  reportedAtMs: 0,
  survivesBackground: true,
});
/** What the engine really reports paired and ready: the fake's `paired-ready` scene. */
const PAIRED_READY: EngineSnapshot = (() => {
  const engine = createFakeCaptureEngine(() => 1_790_000_000_000);
  engine.scene('paired-ready');
  const reported = engine.getSnapshot();
  engine.dispose();
  return reported;
})();
/** A row of the amendment's table: `change` spread over the paired-ready snapshot. */
const paired = (change: Partial<EngineSnapshot>): EngineSnapshot => ({
  ...PAIRED_READY,
  ...change,
});
const PAIRED: SessionState = { kind: 'paired' };
const ARMING: SessionState = { kind: 'arming', cause: 'organiser', retrying: false };
const ARMED: SessionState = { kind: 'armed', cause: 'operator', notReady: 'sound' };
const { t } = createTranslator('en');
const line = (s: EngineSnapshot) => t(selectStatusKey(s), { remaining: 38, window: 183 });
const since = 1;
const LIVE: SessionState = { kind: 'publishing', transport: 'srt', sinceEpochMs: since };
const holding = (cause: 'uplink-lost' | 'video-stalled' | 'not-delivered'): SessionState => ({
  kind: 'reconnecting',
  cause,
  holdRemainingSeconds: 38,
  holdWindowSeconds: 183,
  sinceEpochMs: since,
});

describe('the status line (spec §4 and §5)', () => {
  it.each<[string, SessionState, string]>([
    ['holding', holding('uplink-lost'), 'Uplink lost — holding, 38 s of 183'],
    ['the video stalled', holding('video-stalled'), 'Video stalled — restarting, 38 s of 183'],
    [
      'restarting for viewers',
      holding('not-delivered'),
      'Viewers not receiving — restarting, 38 s of 183',
    ],
    [
      'fell back',
      { kind: 'degraded', transport: 'rtmps', reason: 'fell-back-to-rtmps', sinceEpochMs: since },
      'Switched to backup link (RTMPS)',
    ],
    [
      'the uplink is weak',
      { kind: 'degraded', transport: 'srt', reason: 'poor-uplink', sinceEpochMs: since },
      'Weak signal. Still live.',
    ],
    [
      'not delivered',
      { kind: 'degraded', transport: 'srt', reason: 'not-delivered', sinceEpochMs: since },
      'Viewers not receiving — restarting',
    ],
    [
      'camera taken',
      { kind: 'degraded', transport: 'srt', reason: 'camera-taken', sinceEpochMs: since },
      'Camera taken by another app — slate on air',
    ],
    [
      'mic silenced',
      { kind: 'degraded', transport: 'srt', reason: 'mic-silenced', sinceEpochMs: since },
      'Mic silenced by a call',
    ],
    ['idle', { kind: 'idle' }, 'Starting the camera…'],
    ['pairing', { kind: 'pairing' }, 'Pairing this phone…'],
    ['arming', ARMING, 'Going live — started by the organiser'],
    ['armed', ARMED, "Can't go live yet — the mic isn't available"],
    ['connecting', { kind: 'connecting', transport: 'srt' }, 'Opening the link.'],
    [
      'the operator stopped',
      { kind: 'ended', reason: 'operator-stopped', durationMs: 754_000 },
      'You stopped the broadcast.',
    ],
    [
      'a fatal error',
      { kind: 'ended', reason: 'fatal-error', durationMs: null },
      'Something failed. Your code is kept.',
    ],
  ])('says the spec’s sentence when %s', (_name, state, sentence) => {
    expect(line(snap(state))).toBe(sentence);
  });

  // A11: readiness is the chips' and the blocker's; the paired line says what it waits for.
  it('never names a pre-flight problem while paired: the chips and the blocker do', () => {
    const none: Readiness = { camera: false, sound: false, network: false, held: false };
    expect(selectStatusKey(paired({ ready: none }))).toBe('stream.status.waitingGoLive');
  });

  // Spec §4 (owner, 2026-10-06): the level decides nothing on air; a quiet room is plain Live.
  it.each([0, 0.01, 0.049, 0.05, 0.4])('says plain Live on air at level %s', (audioLevel) => {
    expect(line(snap(LIVE, { ...ARMED_OK, audioLevel }))).toBe(
      'Live. Sound and picture going out.',
    );
  });
  // The mic-silenced warning stays (spec §4): its line is the DEGRADED table's, unchanged.

  it('never lets a failing heartbeat change what it says (ruling 5)', () => {
    const heartbeat = {
      lastSentAtEpochMs: 1,
      lastResult: 'failed' as const,
      consecutiveFailures: 40,
      failures: 40,
    };
    const failing = { ...ARMED_OK, heartbeat };
    expect(selectStatusKey(snap(LIVE, failing))).toBe('stream.status.live');
    const pairedFailing = paired({});
    expect(
      selectStatusKey({
        ...pairedFailing,
        telemetry: { ...pairedFailing.telemetry, heartbeat },
      }),
    ).toBe('stream.status.waitingGoLive');
  });

  it('never mentions heat, which the status strip owns (AGENTS §8)', () => {
    const hot = { ...ARMED_OK, shed: 'viewer-feed' as const, thermalStatus: 'severe' as const };
    expect(selectStatusKey(snap(LIVE, hot))).toBe('stream.status.live');
  });

  it('reads no missing rate as trouble: native’s state decides (null is no reading)', () => {
    const noReadings: Partial<Telemetry> = {
      ...ARMED_OK,
      bitrateKbps: null,
      encodedVideoFps: null,
      audioPacketsPerSecond: null,
      deliveredLagMs: null,
      delivery: 'unknown',
    };
    expect(selectStatusKey(snap(LIVE, noReadings))).toBe('stream.status.live');
  });
});

/**
 * Amendment §2's lines, first match wins. Every row starts from what the fake
 * reports paired and ready (`paired`), and each key is written out by hand.
 */
describe('the paired and starting lines (amendment §2)', () => {
  const destination = (destinationName: string | null): Partial<EngineSnapshot> => ({
    pairing: PAIRED_READY.pairing === null ? null : { ...PAIRED_READY.pairing, destinationName },
  });
  const arming = (cause: Cause, retrying: boolean): Partial<EngineSnapshot> => ({
    state: { kind: 'arming', cause, retrying },
  });
  const armed = (cause: Cause, notReady: NotReady | null): Partial<EngineSnapshot> => ({
    state: { kind: 'armed', cause, notReady },
  });
  const REFUSED: readonly (readonly [Refusal, StatusKey])[] = [
    ['no_destination', 'stream.status.refusedDestination'],
    ['no_credit', 'stream.status.refusedCredit'],
    ['not_entitled', 'stream.status.refusedEntitlement'],
    ['unknown', 'stream.status.refusedUnknown'],
    ['start-failed', 'stream.status.startFailed'],
  ];
  const LAST_END: readonly (readonly [LastEnd, StatusKey])[] = [
    ['stopped-by-organiser', 'stream.status.stoppedOrganiser'],
    ['stopped-automatically', 'stream.status.stoppedMatch'],
    ['no-signal', 'stream.status.stoppedNoSignal'],
    ['destination-refused', 'stream.status.stoppedRefused'],
    ['max-duration', 'stream.status.stoppedMaxDuration'],
    ['phone-lost', 'stream.status.stoppedPhoneLost'],
    ['ended-by-seazn', 'stream.status.stoppedBySeazn'],
    ['hold-window-expired', 'stream.status.stoppedHoldWindow'],
    ['stopped', 'stream.status.stopped'],
  ];
  const GOING_LIVE: readonly (readonly [Cause, StatusKey])[] = [
    ['organiser', 'stream.status.goingLiveOrganiser'],
    ['automatic', 'stream.status.goingLiveMatch'],
    ['rejoin', 'stream.status.rejoining'],
    ['operator', 'stream.status.connecting'],
  ];
  const NOT_READY: readonly (readonly [NotReady, StatusKey])[] = [
    ['camera', 'stream.status.notReadyCamera'],
    ['sound', 'stream.status.notReadySound'],
    ['network', 'stream.status.notReadyNetwork'],
    ['held', 'stream.status.notReadyHeld'],
  ];
  const ROWS: readonly (readonly [string, Partial<EngineSnapshot>, StatusKey])[] = [
    ['pairing', { state: { kind: 'pairing' } }, 'stream.status.pairing'],
    ['paired, another app’s camera', { camera: 'taken' }, 'stream.status.cameraInUse'],
    [
      'paired, another app’s camera over a refusal',
      { camera: 'taken', refusal: 'no_credit' },
      'stream.status.cameraInUse',
    ],
    ...REFUSED.map(([refusal, key]) => [`paired, refused ${refusal}`, { refusal }, key] as const),
    ...LAST_END.map(([lastEnd, key]) => [`paired, last end ${lastEnd}`, { lastEnd }, key] as const),
    // A refused restart is the newer fact: native clears both at the next start.
    [
      'paired, a refusal over a last end',
      { refusal: 'no_credit', lastEnd: 'stopped-by-organiser' },
      'stream.status.refusedCredit',
    ],
    [
      'paired, a last end over a missing destination',
      { lastEnd: 'max-duration', ...destination(null) },
      'stream.status.stoppedMaxDuration',
    ],
    ['paired, no destination', destination(null), 'stream.status.waitingDestination'],
    // The wire forbids an empty name (minLength 1): read as none, as selectLabel reads an empty label.
    ['paired, an empty destination', destination(''), 'stream.status.waitingDestination'],
    ['paired, a destination', {}, 'stream.status.waitingGoLive'],
    ['arming, retrying', arming('organiser', true), 'stream.status.startRetrying'],
    ['arming, retrying an operator start', arming('operator', true), 'stream.status.startRetrying'],
    ...GOING_LIVE.map(([cause, key]) => [`arming, ${cause}`, arming(cause, false), key] as const),
    ...GOING_LIVE.map(
      ([cause, key]) => [`armed ready, ${cause}`, armed(cause, null), key] as const,
    ),
    ...NOT_READY.map(
      ([notReady, key]) =>
        [`armed, not ready ${notReady}`, armed('organiser', notReady), key] as const,
    ),
    // Starting names who started it, or what it waits for, over whose camera it is.
    [
      'arming, another app’s camera',
      { ...arming('automatic', false), camera: 'taken' },
      'stream.status.goingLiveMatch',
    ],
    [
      'armed, another app’s camera',
      { ...armed('organiser', 'camera'), camera: 'taken' },
      'stream.status.notReadyCamera',
    ],
    [
      'ended, the operator’s Stop',
      { state: { kind: 'ended', reason: 'operator-stopped', durationMs: 1 }, camera: null },
      'stream.status.endedOperator',
    ],
    [
      'ended, a permanent failure',
      { state: { kind: 'ended', reason: 'fatal-error', durationMs: null }, camera: null },
      'stream.status.endedFatal',
    ],
  ];

  it('sweeps every row of the table (PV12: zero rows is a failure)', () => {
    expect(ROWS).toHaveLength(40);
  });

  it.each(ROWS)('%s says %s', (_name, change, key) => {
    expect(selectStatusKey(paired(change))).toBe(key);
  });

  it('starts from a snapshot that is paired, ready, ours and named', () => {
    expect([
      PAIRED_READY.state.kind,
      PAIRED_READY.camera,
      PAIRED_READY.refusal,
      PAIRED_READY.lastEnd,
      PAIRED_READY.pairing?.destinationName,
    ]).toEqual(['paired', 'own', null, null, 'YouTube · Fake CC']);
  });

  it('says the same line for the same snapshot, report after report', () => {
    const snapshot = paired({ refusal: 'unknown' });
    expect([selectStatusKey(snapshot), selectStatusKey({ ...snapshot })]).toEqual([
      'stream.status.refusedUnknown',
      'stream.status.refusedUnknown',
    ]);
  });
});

/**
 * Carry 8: every wire string plan B's engine can send reaches a sentence.
 * The literals are plan B's `.wire` values, copied by hand: a TypeScript-side
 * rename leaves one of them without a line. A Kotlin-side rename leaves these
 * literals green; plan C's contract test is what catches that drift.
 */
describe('every native reason has a line', () => {
  const KEYS = new Set(Object.keys(en));
  it.each(['not-delivered', 'camera-taken', 'mic-silenced', 'poor-uplink', 'fell-back-to-rtmps'])(
    'degraded %s',
    (reason) => {
      const state = { kind: 'degraded', transport: 'srt', reason, sinceEpochMs: 1 };
      expect(KEYS.has(selectStatusKey(snap(state as SessionState)))).toBe(true);
    },
  );
  it.each(['operator-stopped', 'fatal-error'])('ended %s', (reason) => {
    const state = { kind: 'ended', reason, durationMs: null };
    expect(KEYS.has(selectStatusKey(snap(state as SessionState)))).toBe(true);
  });
  it.each(['uplink-lost', 'video-stalled', 'not-delivered'])('reconnecting %s', (cause) => {
    const state = { ...holding('uplink-lost'), cause };
    expect(KEYS.has(selectStatusKey(snap(state as SessionState)))).toBe(true);
  });
  // The amendment's wire strings (Vocabulary.kt), copied by hand.
  it.each(['no_destination', 'no_credit', 'not_entitled', 'unknown', 'start-failed'])(
    'refused %s',
    (refusal) => {
      expect(KEYS.has(selectStatusKey(paired({ refusal: refusal as Refusal })))).toBe(true);
    },
  );
  it.each([
    'stopped-by-organiser',
    'stopped-automatically',
    'no-signal',
    'destination-refused',
    'max-duration',
    'phone-lost',
    'ended-by-seazn',
    'hold-window-expired',
    'stopped',
  ])('last end %s', (lastEnd) => {
    expect(KEYS.has(selectStatusKey(paired({ lastEnd: lastEnd as LastEnd })))).toBe(true);
  });
  it.each(['organiser', 'automatic', 'operator', 'rejoin'])('starting, cause %s', (cause) => {
    const state = { kind: 'armed', cause, notReady: null };
    expect(KEYS.has(selectStatusKey(paired({ state: state as SessionState })))).toBe(true);
  });
  it.each(['camera', 'sound', 'network', 'held'])('armed, not ready %s', (notReady) => {
    const state = { kind: 'armed', cause: 'operator', notReady };
    expect(KEYS.has(selectStatusKey(paired({ state: state as SessionState })))).toBe(true);
  });
});

describe('in every language', () => {
  const fill = (text: string) => text.replace('{remaining}', '38').replace('{window}', '183');
  it.each([
    ['en', en],
    ['es', es],
    ['fr', fr],
    ['nl', nl],
  ] as const)('%s says its own holding line, with both numbers', (lang, dictionary) => {
    const said = createTranslator(lang).t(selectStatusKey(snap(holding('uplink-lost'))), {
      remaining: 38,
      window: 183,
    });
    expect(said).toBe(fill(dictionary['stream.status.holding']));
    expect(said).not.toMatch(/[{}]/);
  });
});

/**
 * The camera ruling (fix round 1, replacing carry 11's "whatever the state"):
 * another app's take reads the slate line on air and a plain "in use" line
 * before it; our own reopen, resume or switch reads only on air; a hold's
 * countdown and an ending outrank the camera. One row per cell.
 */
describe('whose camera it is, by state (camera ruling)', () => {
  const TAKEN = 'Camera taken by another app — slate on air';
  const IN_USE = 'Camera in use by another app';
  const REOPENING = 'Camera reopening — picture back shortly';
  const CONNECTING: SessionState = { kind: 'connecting', transport: 'srt' };
  const degraded = (reason: DegradeReason): SessionState => ({
    kind: 'degraded',
    transport: 'srt',
    reason,
    sinceEpochMs: since,
  });
  const ON_AIR: readonly (readonly [string, SessionState])[] = [
    ['publishing', LIVE],
    ['degraded camera-taken', degraded('camera-taken')],
    ['degraded not-delivered', degraded('not-delivered')],
    ['degraded mic-silenced', degraded('mic-silenced')],
  ];
  const OURS = ['reopening', 'resuming', 'switching'] as const;
  const NOT_OWN = ['taken', ...OURS] as const;
  const cells = <A, B>(as: readonly A[], bs: readonly B[]) =>
    as.flatMap((a) => bs.map((b) => [a, b] as const));

  it.each(ON_AIR)('another app’s take on air reads the slate line while %s', (_, state) => {
    expect(line(snap(state, ARMED_OK, 'taken'))).toBe(TAKEN);
  });

  it.each<[string, SessionState]>([
    ['paired', PAIRED],
    ['connecting', CONNECTING],
  ])('another app’s take before air reads “in use”, with no slate claim, while %s', (_, state) => {
    const said = line(snap(state, ARMED_OK, 'taken'));
    expect(said).toBe(IN_USE);
    expect(said).not.toMatch(/slate/i);
  });

  // Amendment §2, Starting: who started it, or what it still needs. A camera
  // taken while Armed blocks as notReady camera, which says so (Task 28).
  it.each<[string, SessionState, string]>([
    ['arming', ARMING, 'Going live — started by the organiser'],
    ['armed', ARMED, "Can't go live yet — the mic isn't available"],
  ])('another app’s take while Starting keeps the %s line', (_, state, said) => {
    expect(line(snap(state, ARMED_OK, 'taken'))).toBe(said);
  });

  it.each(cells(OURS, ON_AIR))(
    'our own %s reads the reopening line on air (%j)',
    (camera, [, state]) => {
      const said = line(snap(state, ARMED_OK, camera));
      expect(said).toBe(REOPENING);
      expect(said).not.toMatch(/slate/i);
    },
  );

  it.each(OURS)(
    'our own %s before air says no reopening: paired says what it waits for',
    (camera) => {
      expect(selectStatusKey(paired({ camera }))).toBe('stream.status.waitingGoLive');
    },
  );

  it.each(OURS)('our own %s before air says no reopening: connecting opens the link', (camera) => {
    expect(line(snap(CONNECTING, ARMED_OK, camera))).toBe('Opening the link.');
  });

  it.each(
    cells(NOT_OWN, [
      ['uplink-lost', 'Uplink lost — holding, 38 s of 183'],
      ['video-stalled', 'Video stalled — restarting, 38 s of 183'],
      ['not-delivered', 'Viewers not receiving — restarting, 38 s of 183'],
    ] as const),
  )('the hold’s countdown outranks a %s camera (%j)', (camera, [cause, said]) => {
    expect(line(snap(holding(cause), ARMED_OK, camera))).toBe(said);
  });

  it.each(
    cells(NOT_OWN, [
      ['operator-stopped', 'You stopped the broadcast.'],
      ['fatal-error', 'Something failed. Your code is kept.'],
    ] as const),
  )('an ending says how it ended over a %s camera (%j)', (camera, [reason, said]) => {
    const ended: SessionState = { kind: 'ended', reason, durationMs: null };
    expect(line(snap(ended, ARMED_OK, camera))).toBe(said);
  });

  // Contract-excluded (plan B: no session, no camera), so pinned rather than trusted.
  it.each(NOT_OWN)('names no %s camera before a session', (camera) => {
    expect(line(snap({ kind: 'idle' }, ARMED_OK, camera))).toBe('Starting the camera…');
  });

  // Pairing has no camera line: the dialog or the claim is what it waits on.
  it.each(NOT_OWN)('names no %s camera while pairing', (camera) => {
    expect(line(snap({ kind: 'pairing' }, ARMED_OK, camera))).toBe('Pairing this phone…');
  });

  it('leaves every line alone while the camera is our own', () => {
    expect(line(snap(CONNECTING, ARMED_OK, 'own'))).toBe('Opening the link.');
    expect(line(snap(degraded('camera-taken'), ARMED_OK, 'own'))).toBe(TAKEN);
    expect(line(snap(degraded('not-delivered'), ARMED_OK, 'own'))).toBe(
      'Viewers not receiving — restarting',
    );
  });

  it.each([
    ['reopening', LIVE, 'switching'],
    ['in-use', PAIRED, 'taken'],
  ] as const)('says the %s line in every language, within the column', (_, state, camera) => {
    for (const lang of ['en', 'es', 'fr', 'nl'] as const) {
      const said = createTranslator(lang).t(selectStatusKey(snap(state, ARMED_OK, camera)));
      expect({
        lang,
        fits: said.length <= STATUS_LINE_BUDGET,
        key: said.startsWith('stream.'),
      }).toEqual({ lang, fits: true, key: false });
    }
  });
});

describe('the hold countdown', () => {
  it('reads native’s remaining and window while reconnecting', () => {
    const s = snap(holding('video-stalled'));
    expect([selectHoldRemaining(s), selectHoldWindow(s)]).toEqual([38, 183]);
  });

  it('is absent otherwise', () => {
    expect([selectHoldRemaining(snap(LIVE)), selectHoldWindow(snap(LIVE))]).toEqual([null, null]);
  });
});

/**
 * Ruling I2: Back's line on air stands in only for a calm on-air line. Every
 * outage or fault line outranks it, so it can never hide one.
 */
describe('Back’s line on air (ruling I2)', () => {
  // Task 28: the three Starting lines that name who started it stand in, as
  // "Opening the link." does; a not-ready or retrying line outranks Back's.
  it.each([
    'stream.status.connecting',
    'stream.status.live',
    'stream.status.goingLiveOrganiser',
    'stream.status.goingLiveMatch',
    'stream.status.rejoining',
  ] as const)('stands in for the calm line %s', (key) => {
    expect(columnLineKey(key, true)).toBe('stream.leaveOnAir');
  });

  it.each([
    'stream.status.weakSignal',
    'stream.status.fellBack',
    'stream.status.notDelivered',
    'stream.status.cameraTaken',
    'stream.status.cameraReopening',
    // N2: reachable on air as connecting with the camera taken, then Back.
    'stream.status.cameraInUse',
    'stream.status.micSilenced',
    'stream.status.holding',
    'stream.status.holdingStalled',
    'stream.status.holdingNotDelivered',
    'stream.status.startRetrying',
    'stream.status.notReadyHeld',
  ] as const)('is outranked by the fault line %s', (key) => {
    expect(columnLineKey(key, true)).toBe(key);
  });

  // N2: built from the dictionary, so a status line added later is covered
  // without anyone remembering this list. Only the five calm lines yield.
  it('is outranked by every other status line in the dictionary', () => {
    const calm = [
      'stream.status.connecting',
      'stream.status.live',
      'stream.status.goingLiveOrganiser',
      'stream.status.goingLiveMatch',
      'stream.status.rejoining',
    ];
    const others = Object.keys(en).filter(
      (key) => key.startsWith('stream.status.') && !calm.includes(key),
    ) as Parameters<typeof columnLineKey>[0][];
    expect(others.length).toBeGreaterThan(20);
    for (const key of others) {
      expect({ key, shown: columnLineKey(key, true) }).toEqual({ key, shown: key });
    }
  });

  it('is not shown without a refused Back', () => {
    expect(columnLineKey('stream.status.live', false)).toBe('stream.status.live');
  });
});
