import { describe, expect, it } from 'vitest';
import type { Readiness } from '@/domain/session/Pairing';
import type { DegradeReason, SessionState } from '@/domain/session/SessionState';
import type { CameraState, EngineSnapshot, Telemetry } from '@/engine/CaptureEnginePort';
import { IDLE_TELEMETRY } from '@/engine/FakeCaptureEngine';
import {
  columnLineKey,
  selectHoldRemaining,
  selectHoldWindow,
  selectStatusKey,
  STATUS_LINE_BUDGET,
} from '@/hooks/statusKey';
import en from '@/i18n/en.json';
import es from '@/i18n/es.json';
import fr from '@/i18n/fr.json';
import nl from '@/i18n/nl.json';
import { createTranslator } from '@/i18n/translate';

/** A level well above the on-air floor: the display rule (D39) reads sound. */
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
    // Today's words on the new states; Task 28 gives them their own lines.
    ['pairing', { kind: 'pairing' }, 'Starting the camera…'],
    ['arming', ARMING, 'Opening the link.'],
    ['armed', ARMED, 'Opening the link.'],
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

  it.each<[string, Partial<Readiness>, string]>([
    ['no camera', { camera: false }, 'stream.status.noCamera'],
    ['no network', { network: false }, 'stream.status.noNetwork'],
    ['no sound', { sound: false }, 'stream.status.noSound'],
    ['everything ready', {}, 'stream.status.ready'],
    [
      'nothing ready, camera first',
      { camera: false, sound: false, network: false },
      'stream.status.noCamera',
    ],
    [
      'no network and no sound, network first',
      { network: false, sound: false },
      'stream.status.noNetwork',
    ],
  ])('names the first pre-flight problem when paired: %s', (_name, ready, key) => {
    expect(selectStatusKey(snap(PAIRED, ARMED_OK, 'own', ready))).toBe(key);
  });

  // A11: native's verdict, not the meter, says whether there is sound before air.
  it('reads sound from native while paired, whatever the level', () => {
    expect(selectStatusKey(snap(PAIRED, { audioLevel: 0 }))).toBe('stream.status.ready');
    expect(selectStatusKey(snap(PAIRED, { audioLevel: 0.9 }, 'own', { sound: false }))).toBe(
      'stream.status.noSound',
    );
  });

  it('says live with no sound when the level is under the floor on air (a display rule, D39)', () => {
    expect(line(snap(LIVE, { ...ARMED_OK, audioLevel: 0.01 }))).toBe(
      'Live with no sound. Check the mic now.',
    );
    expect(line(snap(LIVE))).toBe('Live. Sound and picture going out.');
  });

  it.each([
    ['just under the floor', 0.049, 'Live with no sound. Check the mic now.'],
    [
      'exactly at the floor, where the meter and Go Live call it sound',
      0.05,
      'Live. Sound and picture going out.',
    ],
  ])('draws the on-air floor where the meter does: %s', (_name, audioLevel, copy) => {
    expect(line(snap(LIVE, { ...ARMED_OK, audioLevel }))).toBe(copy);
  });

  it('never lets a failing heartbeat change what it says (ruling 5)', () => {
    const heartbeat = {
      lastSentAtEpochMs: 1,
      lastResult: 'failed' as const,
      consecutiveFailures: 40,
      failures: 40,
    };
    const failing = { ...ARMED_OK, heartbeat };
    expect(selectStatusKey(snap(LIVE, failing))).toBe('stream.status.live');
    expect(selectStatusKey(snap(PAIRED, failing))).toBe('stream.status.ready');
  });

  it('never mentions heat, which the top strip owns (AGENTS §8)', () => {
    const hot = { ...ARMED_OK, shed: 'overlay-preview' as const, thermalStatus: 'severe' as const };
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
    ['arming', ARMING],
    ['armed', ARMED],
    ['connecting', CONNECTING],
  ])('another app’s take before air reads “in use”, with no slate claim, while %s', (_, state) => {
    const said = line(snap(state, ARMED_OK, 'taken'));
    expect(said).toBe(IN_USE);
    expect(said).not.toMatch(/slate/i);
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
    'our own %s before air says no reopening: paired reads the camera chip',
    (camera) => {
      expect(line(snap(PAIRED, ARMED_OK, camera))).toBe('Camera not ready yet.');
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
    expect(line(snap({ kind: 'pairing' }, ARMED_OK, camera))).toBe('Starting the camera…');
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
  it.each(['stream.status.connecting', 'stream.status.live'] as const)(
    'stands in for the calm line %s',
    (key) => {
      expect(columnLineKey(key, true)).toBe('stream.leaveOnAir');
    },
  );

  it.each([
    'stream.status.liveNoSound',
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
  ] as const)('is outranked by the fault line %s', (key) => {
    expect(columnLineKey(key, true)).toBe(key);
  });

  // N2: built from the dictionary, so a status line added later is covered
  // without anyone remembering this list. Only the two calm lines yield.
  it('is outranked by every other status line in the dictionary', () => {
    const calm = ['stream.status.connecting', 'stream.status.live'];
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
