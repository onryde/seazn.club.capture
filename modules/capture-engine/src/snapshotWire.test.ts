import { describe, expect, it } from 'vitest';
import type { EngineSnapshot } from './CaptureEnginePort';
import { WIRE_VOCABULARY, createWireCache, toEngineSnapshot } from './snapshotWire';
import vectors from './wire/snapshot-vectors.json';
import { vectorWire } from './wire/vectorWire';

type Expected = Omit<EngineSnapshot, 'telemetry'>;

/**
 * Written by hand from `wire/snapshot-vectors.json`'s bases (AGENTS §10): never read back from
 * `toEngineSnapshot`. `scheduledStart` crosses as epoch seconds (1790003600) and reads as a Date.
 */
const PAIRING = {
  code: 'fx42hmnp7k2q',
  slot: 1,
  tokenTag: 'c980ff38',
  automatic: true,
  label: 'Example Town v Sample CC',
  venueTimezone: 'Europe/London',
  scheduledStart: new Date('2026-09-21T15:13:20Z'),
  autoAllowed: true,
  destinationName: 'YouTube · Example Town CC',
  pollSeconds: 10,
  stageLabel: null,
};
// W28: the pairing of the case that carries a round line, by hand from its override { stageLabel: 'Open · QF' }.
const PAIRING_STAGED = { ...PAIRING, stageLabel: 'Open · QF' };
const BROADCAST = {
  sid: 'sess_42',
  cause: 'organiser',
  playbackUrl:
    'https://customer-x.cloudflarestream.com/a1b2c3d4e5f60718293a4b5c6d7e8f90/manifest/video.m3u8',
  label: 'Example Town v Sample CC',
  holdWindowSeconds: { srt: 183, rtmps: 180 },
  maxDurationMinutes: 300,
  scoreUpdates: 'realtime',
  srtOffered: true,
} as const;
const READY = { camera: true, sound: true, network: true, held: true };
const NOT_READY = { camera: false, sound: false, network: false, held: false };
const REST = { refusal: null, lastEnd: null, unpaired: null, codeEndedPending: false } as const;

const EXPECTED: Readonly<Record<string, Expected>> = {
  idle: {
    ...REST,
    state: { kind: 'idle' },
    pairing: null,
    broadcast: null,
    ready: NOT_READY,
    camera: null,
    reportedAtMs: 1_790_000_000_000,
    survivesBackground: false,
  },
  'idle-unpaired-replaced': {
    ...REST,
    state: { kind: 'idle' },
    pairing: null,
    broadcast: null,
    ready: NOT_READY,
    unpaired: { reason: 'replaced', code: 'fx42hmnp7k2q', slot: 1, tokenTag: 'c980ff38' },
    camera: null,
    reportedAtMs: 1_790_000_000_500,
    survivesBackground: false,
  },
  // R6 of the D3 findings design: the shade's Forget. JS drops the saved code on this reason, the whole name matching.
  'idle-unpaired-forgotten': {
    ...REST,
    state: { kind: 'idle' },
    pairing: null,
    broadcast: null,
    ready: NOT_READY,
    unpaired: { reason: 'forgotten', code: 'fx42hmnp7k2q', slot: 1, tokenTag: 'c980ff38' },
    camera: null,
    reportedAtMs: 1_790_000_000_700,
    survivesBackground: false,
  },
  pairing: {
    ...REST,
    state: { kind: 'pairing' },
    pairing: {
      ...PAIRING,
      label: '',
      venueTimezone: '',
      scheduledStart: null,
      autoAllowed: false,
      destinationName: null,
    },
    broadcast: null,
    ready: { ...NOT_READY, network: true },
    camera: 'own',
    reportedAtMs: 1_790_000_001_000,
    survivesBackground: false,
  },
  'paired-after-organiser-stop': {
    ...REST,
    state: { kind: 'paired' },
    pairing: { ...PAIRING, pollSeconds: 60 },
    broadcast: null,
    ready: { camera: true, sound: false, network: true, held: false },
    lastEnd: 'stopped-by-organiser',
    camera: 'own',
    reportedAtMs: 1_790_000_002_000,
    survivesBackground: true,
  },
  'paired-refused-no-destination': {
    ...REST,
    state: { kind: 'paired' },
    pairing: { ...PAIRING, destinationName: null, automatic: false },
    broadcast: null,
    ready: READY,
    refusal: 'no_destination',
    camera: 'own',
    reportedAtMs: 1_790_000_003_000,
    survivesBackground: true,
  },
  'arming-retrying': {
    ...REST,
    state: { kind: 'arming', cause: 'automatic', retrying: true },
    pairing: PAIRING,
    broadcast: null,
    ready: READY,
    camera: 'own',
    reportedAtMs: 1_790_000_004_000,
    survivesBackground: true,
  },
  'armed-not-held-rtmps-only': {
    ...REST,
    state: { kind: 'armed', cause: 'rejoin', notReady: 'held' },
    pairing: PAIRING,
    broadcast: {
      ...BROADCAST,
      cause: 'rejoin',
      holdWindowSeconds: { rtmps: 180 },
      srtOffered: false,
    },
    ready: { ...READY, held: false },
    camera: 'own',
    reportedAtMs: 1_790_000_005_000,
    survivesBackground: true,
  },
  'armed-gate-open': {
    ...REST,
    state: { kind: 'armed', cause: 'operator', notReady: null },
    pairing: PAIRING,
    broadcast: { ...BROADCAST, cause: 'operator' },
    ready: READY,
    camera: 'own',
    reportedAtMs: 1_790_000_005_500,
    survivesBackground: true,
  },
  'connecting-unknown-score-updates': {
    ...REST,
    state: { kind: 'connecting', transport: 'srt' },
    pairing: PAIRING,
    broadcast: { ...BROADCAST, scoreUpdates: null },
    ready: READY,
    camera: 'own',
    reportedAtMs: 1_790_000_006_000,
    survivesBackground: true,
  },
  'degraded-two-reasons': {
    ...REST,
    state: {
      kind: 'degraded',
      transport: 'srt',
      reason: 'not-delivered',
      sinceEpochMs: 1_790_000_001_000,
    },
    pairing: PAIRING,
    broadcast: BROADCAST,
    ready: READY,
    camera: 'own',
    reportedAtMs: 1_790_000_060_000,
    survivesBackground: true,
  },
  'reconnecting-code-ended-pending': {
    ...REST,
    state: {
      kind: 'reconnecting',
      cause: 'uplink-lost',
      holdRemainingSeconds: 38,
      holdWindowSeconds: 183,
      sinceEpochMs: 1_790_000_001_000,
    },
    pairing: PAIRING,
    broadcast: BROADCAST,
    ready: { ...READY, network: false },
    codeEndedPending: true,
    camera: 'own',
    reportedAtMs: 1_790_000_146_000,
    survivesBackground: true,
  },
  // N29's rejoin (R10 of the D3 findings design): the hold has run out, so it reads 0 of 0, and the clock carries the
  // broadcast's first live time, not the rejoin's.
  'reconnecting-hold-expired': {
    ...REST,
    state: {
      kind: 'reconnecting',
      cause: 'hold-expired',
      holdRemainingSeconds: 0,
      holdWindowSeconds: 0,
      sinceEpochMs: 1_790_000_001_000,
    },
    pairing: PAIRING,
    broadcast: { ...BROADCAST, cause: 'rejoin' },
    ready: READY,
    camera: 'own',
    reportedAtMs: 1_790_000_400_000,
    survivesBackground: true,
  },
  'ended-operator-stopped': {
    ...REST,
    state: { kind: 'ended', reason: 'operator-stopped', durationMs: 2_700_000 },
    pairing: PAIRING,
    broadcast: null,
    ready: { ...READY, camera: false },
    camera: null,
    reportedAtMs: 1_790_002_700_000,
    survivesBackground: false,
  },
  'ended-pair-refused-never-live': {
    ...REST,
    state: { kind: 'ended', reason: 'fatal-error', durationMs: null },
    pairing: null,
    broadcast: null,
    ready: NOT_READY,
    camera: null,
    reportedAtMs: 1_790_000_000_200,
    survivesBackground: false,
  },
  'live-telemetry': {
    ...REST,
    state: { kind: 'publishing', transport: 'srt', sinceEpochMs: 1_790_000_001_000 },
    pairing: PAIRING,
    broadcast: BROADCAST,
    ready: READY,
    camera: 'own',
    reportedAtMs: 1_790_000_061_000,
    survivesBackground: true,
  },
  'paired-with-stage-label': {
    ...REST,
    state: { kind: 'paired' },
    pairing: PAIRING_STAGED,
    broadcast: null,
    ready: READY,
    camera: 'own',
    reportedAtMs: 1_790_000_007_000,
    survivesBackground: true,
  },
};

describe('carries 2-6: the snapshot wire, as native writes it (Task 12)', () => {
  // The file's count, so an emptied or truncated file cannot pass by sweeping nothing (PV12).
  it('has an expectation for each of the 17 cases, and a case for every expectation', () => {
    expect(vectors.cases).toHaveLength(17);
    expect(vectors.cases.map((c) => c.name).sort()).toEqual(Object.keys(EXPECTED).sort());
  });

  it.each(vectors.cases.map((c) => c.name))('%s', (name) => {
    const wire = vectorWire(name);
    const snapshot = toEngineSnapshot(wire);
    expect(snapshot).not.toBeNull();
    const { telemetry, ...rest } = snapshot as EngineSnapshot;
    expect(rest).toEqual(EXPECTED[name]);
    // Handed through as native wrote it: the vectors pin every key (snapshotVocabulary.test.ts).
    expect(telemetry).toEqual(wire.telemetry);
  });

  it('carry 6 knows each of the 17 vocabularies native writes, every word and no other', () => {
    const keys = Object.keys(vectors.vocabulary).sort();
    expect(keys).toHaveLength(17);
    expect(Object.keys(WIRE_VOCABULARY).sort()).toEqual(keys);
    for (const [key, words] of Object.entries(vectors.vocabulary)) {
      const known = WIRE_VOCABULARY[key as keyof typeof WIRE_VOCABULARY];
      expect({ key, words: [...known].sort() }).toEqual({ key, words: [...words].sort() });
    }
  });

  it('hands back the same pairing and broadcast while their JSON is unchanged', () => {
    const cache = createWireCache();
    const live = vectorWire('live-telemetry');
    const first = toEngineSnapshot(live, cache) as EngineSnapshot;
    const second = toEngineSnapshot(
      { ...live, reportedAtMs: live.reportedAtMs + 1000 },
      cache,
    ) as EngineSnapshot;
    expect(second.pairing).toBe(first.pairing);
    expect(second.broadcast).toBe(first.broadcast);
    const relabelled = toEngineSnapshot(
      { ...live, pairing: { ...live.pairing, label: 'X' } },
      cache,
    ) as EngineSnapshot;
    expect(relabelled.pairing).not.toBe(first.pairing);
    expect(relabelled.pairing?.label).toBe('X');
    expect(relabelled.broadcast).toBe(first.broadcast);
  });

  // Final review I-2: the pair intent carries no waiting fields, so a pairing has no label until the first answer.
  it('reads a pairing before its first answer, its label empty', () => {
    const cache = createWireCache();
    const paired = vectorWire('paired-after-organiser-stop');
    const before = toEngineSnapshot(
      { ...paired, pairing: { ...paired.pairing, label: '' } },
      cache,
    ) as EngineSnapshot;
    expect(before.pairing).toMatchObject({ label: '' });
  });

  it('never caches a malformed pairing: the next good one is read, not the last good one', () => {
    const cache = createWireCache();
    const live = vectorWire('live-telemetry');
    const first = toEngineSnapshot(live, cache) as EngineSnapshot;
    expect(
      toEngineSnapshot({ ...live, pairing: { ...live.pairing, slot: '1' } }, cache),
    ).toBeNull();
    const again = toEngineSnapshot(live, cache) as EngineSnapshot;
    expect(again.pairing).toBe(first.pairing);
  });

  // W28: the round line is text or null, and nothing else, because the pairing is read whole or not at all.
  it('reads a pairing whose stageLabel is not text or null as no snapshot, and one without the key likewise', () => {
    const staged = vectorWire('paired-with-stage-label');
    expect(toEngineSnapshot(staged)?.pairing?.stageLabel).toBe('Open · QF');
    let refused = 0;
    for (const stageLabel of [7, true, {}, ['QF']]) {
      expect(
        toEngineSnapshot({ ...staged, pairing: { ...staged.pairing, stageLabel } }),
      ).toBeNull();
      refused += 1;
    }
    const { stageLabel: _gone, ...without } = staged.pairing as Record<string, unknown>;
    expect(toEngineSnapshot({ ...staged, pairing: without })).toBeNull();
    refused += 1;
    expect(refused).toBe(5);
  });

  const idle = () => vectorWire('idle');
  const live = () => vectorWire('live-telemetry');
  /** The live vector with its telemetry changed by [patch]. */
  const withTelemetry = (
    patch: (telemetry: Record<string, unknown>) => Record<string, unknown>,
  ) => {
    const wire = live();
    return { ...wire, telemetry: patch({ ...(wire.telemetry as Record<string, unknown>) }) };
  };
  const beat = (telemetry: Record<string, unknown>) =>
    telemetry.heartbeat as Record<string, unknown>;

  it('reads armed with notReady null: the gate about to open, not a malformed word', () => {
    const wire = { ...idle(), state: { kind: 'armed', cause: 'organiser', notReady: null } };
    expect(toEngineSnapshot(wire)?.state).toEqual({
      kind: 'armed',
      cause: 'organiser',
      notReady: null,
    });
  });

  // Ledger, ruling I2 (Task 12), carry T25: scoreUpdates is the descriptor schema's closed enum, and a
  // word outside it is null for that field only. The snapshot is kept, as native's own reader keeps it.
  it.each([
    ['an unknown word', 'pushed'],
    ['a number', 7],
  ])('reads a scoreUpdates that is %s as null, and keeps the snapshot', (_why, word) => {
    const wire = live();
    const snapshot = toEngineSnapshot({
      ...wire,
      broadcast: { ...wire.broadcast, scoreUpdates: word },
    });
    expect(snapshot?.state.kind).toBe('publishing');
    expect(snapshot?.broadcast).toEqual({ ...BROADCAST, scoreUpdates: null });
  });

  it.each([
    ['an unknown state', () => ({ ...idle(), state: { kind: 'exploded' } })],
    [
      'armed with an unknown cause',
      () => ({ ...idle(), state: { kind: 'armed', cause: 'boss', notReady: null } }),
    ],
    [
      'armed with an unknown readiness check',
      () => ({ ...idle(), state: { kind: 'armed', cause: 'organiser', notReady: 'tripod' } }),
    ],
    ['no telemetry', () => ({ ...idle(), telemetry: undefined })],
    ['no report time', () => ({ ...idle(), reportedAtMs: undefined })],
    ['an unknown camera', () => ({ ...idle(), camera: 'borrowed' })],
    ['an unknown refusal', () => ({ ...idle(), refusal: 'nope' })],
    ['an unknown last end', () => ({ ...idle(), lastEnd: 'gone' })],
    ['codeEndedPending in text', () => ({ ...idle(), codeEndedPending: 'false' })],
    [
      'an unpaired with no code',
      () => ({ ...idle(), unpaired: { reason: 'replaced', slot: 1, tokenTag: 't' } }),
    ],
    [
      'a pairing with a slot in text',
      () => ({ ...idle(), pairing: { ...vectors.pairingBase, slot: '1' } }),
    ],
    [
      'a pairing with scheduledStart in text',
      () => ({ ...idle(), pairing: { ...vectors.pairingBase, scheduledStart: '1790003600' } }),
    ],
    [
      'a broadcast with a hold window in text',
      () => ({
        ...live(),
        broadcast: { ...vectors.broadcastBase, holdWindowSeconds: { srt: '183' } },
      }),
    ],
    [
      'a ready missing a check',
      () => ({ ...idle(), ready: { camera: true, sound: true, network: true } }),
    ],
    [
      'ended with a duration in text',
      () => ({ ...idle(), state: { kind: 'ended', reason: 'fatal-error', durationMs: '0' } }),
    ],
    ['not an object', () => 'idle'],
    // Review C4c M-9: the selectors read telemetry unguarded, so its shape is checked too.
    ['telemetry with no heartbeat', () => withTelemetry(({ heartbeat: _gone, ...rest }) => rest)],
    ['a heartbeat that is null', () => withTelemetry((t) => ({ ...t, heartbeat: null }))],
    [
      'a heartbeat with its failures in text',
      () => withTelemetry((t) => ({ ...t, heartbeat: { ...beat(t), failures: '0' } })),
    ],
    [
      'a heartbeat with an unknown last result',
      () => withTelemetry((t) => ({ ...t, heartbeat: { ...beat(t), lastResult: 'maybe' } })),
    ],
    [
      'a heartbeat with its last send in text',
      () => withTelemetry((t) => ({ ...t, heartbeat: { ...beat(t), lastSentAtEpochMs: '0' } })),
    ],
    [
      'a heartbeat with no consecutive failures',
      () => withTelemetry((t) => ({ ...t, heartbeat: { ...beat(t), consecutiveFailures: null } })),
    ],
    ['telemetry missing a key', () => withTelemetry(({ dataUsedBytes: _gone, ...rest }) => rest)],
  ])('reads %s as malformed, never as a state', (_why, wire) => {
    expect(toEngineSnapshot(wire())).toBeNull();
  });
});
