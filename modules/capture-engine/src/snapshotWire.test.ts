import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { AutoRefusal } from '@/domain/session/Pairing';
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
  court: null,
  next: null,
  autoRefusal: null,
  starting: false,
};
// W28: the pairing of the case that carries a round line, by hand from its override { stageLabel: 'Open · QF' }.
const PAIRING_STAGED = { ...PAIRING, stageLabel: 'Open · QF' };
// Court stream (spec 2026-11-14 §6.1, §5.3): by hand from the court cases' overrides. 1793538000 s is 13:00 UTC.
const PAIRING_COURT = {
  ...PAIRING,
  court: 'Court 2',
  next: { label: 'Northside v Riverside', scheduledStart: new Date('2026-11-01T13:00:00Z') },
};
const PAIRING_COURT_NO_NEXT = { ...PAIRING, court: 'Court 2' };
// E2 (2026-11-17): by hand from the case's override { court: 'Court 2', autoRefusal: 'destination_in_use' }.
const PAIRING_COURT_REFUSED = {
  ...PAIRING_COURT_NO_NEXT,
  autoRefusal: 'destination_in_use' as AutoRefusal,
};
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
  'paired-court-with-next': {
    ...REST,
    state: { kind: 'paired' },
    pairing: PAIRING_COURT,
    broadcast: null,
    ready: READY,
    camera: 'own',
    reportedAtMs: 1_790_000_008_000,
    survivesBackground: true,
  },
  // Court stream (capture-start.v1): the start's no_match, said on the court's paired line until the next start.
  'paired-refused-no-match': {
    ...REST,
    refusal: 'no_match',
    state: { kind: 'paired' },
    pairing: PAIRING_COURT_NO_NEXT,
    broadcast: null,
    ready: READY,
    camera: 'own',
    reportedAtMs: 1_790_000_009_500,
    survivesBackground: true,
  },
  'paired-court-no-next': {
    ...REST,
    state: { kind: 'paired' },
    pairing: PAIRING_COURT_NO_NEXT,
    broadcast: null,
    ready: READY,
    camera: 'own',
    reportedAtMs: 1_790_000_009_000,
    survivesBackground: true,
  },
  // Court stream Task 13 (P2): the operator's Go live is in flight, waiting for POST start's answer.
  'paired-starting': {
    ...REST,
    state: { kind: 'paired' },
    pairing: { ...PAIRING, starting: true },
    broadcast: null,
    ready: READY,
    camera: 'own',
    reportedAtMs: 1_790_000_010_000,
    survivesBackground: true,
  },
  // E2 (2026-11-17): the server refused the court's automatic start; the phone says why while it stands.
  'paired-court-auto-refused': {
    ...REST,
    state: { kind: 'paired' },
    pairing: PAIRING_COURT_REFUSED,
    broadcast: null,
    ready: READY,
    camera: 'own',
    reportedAtMs: 1_790_000_011_000,
    survivesBackground: true,
  },
};

describe('carries 2-6: the snapshot wire, as native writes it (Task 12)', () => {
  // The file's count, so an emptied or truncated file cannot pass by sweeping nothing (PV12).
  it('has an expectation for each of the 22 cases, and a case for every expectation', () => {
    expect(vectors.cases).toHaveLength(22);
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

  it('carry 6 knows each of the 18 vocabularies native writes, every word and no other', () => {
    const keys = Object.keys(vectors.vocabulary).sort();
    expect(keys).toHaveLength(18);
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

  // Court stream (spec §3, Global Constraints): a malformed court is never no court, so the snapshot is malformed whole.
  it.each([
    ['an empty court', ''],
    ['a court of 81 characters', 'x'.repeat(81)],
    ['a court of 80 characters and an emoji', 'x'.repeat(80) + '🏸'],
    ['a court that is a number', 7],
    ['a court that is an object', { name: 'Court 2' }],
  ])('reads a pairing with %s as no snapshot', (_why, court) => {
    const wire = vectorWire('paired-court-with-next');
    expect(toEngineSnapshot({ ...wire, pairing: { ...wire.pairing, court } })).toBeNull();
  });

  it('reads a court of 80 characters, counted in code points, and a pairing without the key as no snapshot', () => {
    const wire = vectorWire('paired-court-no-next');
    const wide = 'x'.repeat(79) + '🏸';
    expect(
      toEngineSnapshot({ ...wire, pairing: { ...wire.pairing, court: wide } })?.pairing?.court,
    ).toBe(wide);
    const { court: _gone, ...without } = wire.pairing as Record<string, unknown>;
    expect(toEngineSnapshot({ ...wire, pairing: without })).toBeNull();
  });

  // Court stream Task 13 (P2): `starting` decides whether Go live can be held. A malformed one is never read as false
  // (a hold native would ignore) or true (Go live off for nothing): the snapshot is malformed whole, as a court is.
  it.each([
    ['a starting that is text', 'true'],
    ['a starting that is null', null],
    ['a starting that is a number', 1],
  ])('reads a pairing with %s as no snapshot', (_why, starting) => {
    const wire = vectorWire('paired-starting');
    expect(toEngineSnapshot({ ...wire, pairing: { ...wire.pairing, starting } })).toBeNull();
  });

  it('reads a pairing without the starting key as no snapshot, and each flag as sent', () => {
    const wire = vectorWire('paired-starting');
    expect(toEngineSnapshot(wire)?.pairing?.starting).toBe(true);
    const off = { ...wire, pairing: { ...wire.pairing, starting: false } };
    expect(toEngineSnapshot(off)?.pairing?.starting).toBe(false);
    const { starting: _gone, ...without } = wire.pairing as Record<string, unknown>;
    expect(toEngineSnapshot({ ...wire, pairing: without })).toBeNull();
  });

  // E2 (2026-11-17): the court's refused automatic start is display only, as next is: anything but one of the six words
  // native writes reads as none and the snapshot stands. The phone's own start refusals are not its words.
  it.each([
    ['an unknown word', 'nope'],
    ['a refusal of the phone’s own start', 'start-failed'],
    ['the start’s no_match', 'no_match'],
    ['an empty word', ''],
    ['a number', 5],
    ['an object', { word: 'no_credit' }],
    ['no autoRefusal key', undefined],
  ])('reads an autoRefusal that is %s as none, and keeps the snapshot', (_why, autoRefusal) => {
    const wire = vectorWire('paired-court-auto-refused');
    const pairing: Record<string, unknown> = { ...wire.pairing, autoRefusal };
    if (autoRefusal === undefined) delete pairing.autoRefusal;
    expect(toEngineSnapshot({ ...wire, pairing })?.pairing).toEqual(PAIRING_COURT_NO_NEXT);
  });

  // Fix round 1, M3: a re-vendor that adds a seventh word fails here, not silently as "no refusal" on the strip.
  it.each(['capture-beat.v1.json', 'capture-descriptor.v1.json'])(
    'knows every autoRefusal word of the vendored %s, and no other',
    (file) => {
      const schema: unknown = JSON.parse(
        readFileSync(new URL(`../../../contracts/${file}`, import.meta.url), 'utf8'),
      );
      const enums: unknown[] = [];
      const walk = (node: unknown): void => {
        if (Array.isArray(node)) return node.forEach(walk);
        if (typeof node !== 'object' || node === null) return;
        for (const [key, child] of Object.entries(node)) {
          if (
            key === 'autoRefusal' &&
            typeof child === 'object' &&
            child !== null &&
            'enum' in child
          )
            enums.push(child.enum);
          walk(child);
        }
      };
      walk(schema);
      expect(enums).toHaveLength(1);
      const words = [...(enums[0] as string[])].sort();
      expect(words).toHaveLength(6);
      expect([...vectors.vocabulary.autoRefusal].sort()).toEqual(words);
      expect([...WIRE_VOCABULARY.autoRefusal].sort()).toEqual(words);
    },
  );

  it('reads each of the six autoRefusal words as sent, and a null as none', () => {
    const wire = vectorWire('paired-court-auto-refused');
    // capture-beat.v1's enum, by hand.
    const words = [
      'no_destination',
      'no_credit',
      'not_entitled',
      'destination_in_use',
      'unavailable',
      'competition_frozen',
    ];
    for (const autoRefusal of words) {
      const read = toEngineSnapshot({ ...wire, pairing: { ...wire.pairing, autoRefusal } });
      expect(read?.pairing?.autoRefusal).toBe(autoRefusal);
    }
    const none = toEngineSnapshot({ ...wire, pairing: { ...wire.pairing, autoRefusal: null } });
    expect(none?.pairing?.autoRefusal).toBeNull();
  });

  // Court stream (spec §5.3): next is display only, so a bad one reads as none and the snapshot stands.
  it.each([
    ['a number', 5],
    ['an empty label', { label: '', scheduledStart: null }],
    ['a label of 201 characters', { label: 'x'.repeat(201), scheduledStart: null }],
    ['a label that is not text', { label: 7, scheduledStart: null }],
    ['a start in text', { label: 'A v B', scheduledStart: '1793538000' }],
    ['no start key', { label: 'A v B' }],
    ['no next key', undefined],
    // P1 review M5: native writes a whole number of seconds from 1 (Bodies), so anything else is no next.
    ['a start of 0', { label: 'A v B', scheduledStart: 0 }],
    ['a negative start', { label: 'A v B', scheduledStart: -1793538000 }],
    ['a start with a fraction', { label: 'A v B', scheduledStart: 1793538000.5 }],
    ['a start past 2^53 - 1', { label: 'A v B', scheduledStart: Number.MAX_SAFE_INTEGER + 1 }],
    ['a start no Date holds', { label: 'A v B', scheduledStart: 9_000_000_000_000 }],
  ])('reads a next that is %s as no next, and keeps the snapshot', (_why, next) => {
    const wire = vectorWire('paired-court-with-next');
    const pairing: Record<string, unknown> = { ...wire.pairing, next };
    if (next === undefined) delete pairing.next;
    const snapshot = toEngineSnapshot({ ...wire, pairing });
    expect(snapshot?.pairing).toEqual({ ...PAIRING_COURT, next: null });
  });

  it('reads a next with no start, and a label of 200 characters, counted in code points', () => {
    const wire = vectorWire('paired-court-with-next');
    const label = '🏸'.repeat(200);
    const read = toEngineSnapshot({
      ...wire,
      pairing: { ...wire.pairing, next: { label, scheduledStart: null } },
    });
    expect(read?.pairing?.next).toEqual({ label, scheduledStart: null });
  });

  it('reads a next at the lowest start native writes, 1 s after the epoch', () => {
    const wire = vectorWire('paired-court-with-next');
    const read = toEngineSnapshot({
      ...wire,
      pairing: { ...wire.pairing, next: { label: 'A v B', scheduledStart: 1 } },
    });
    expect(read?.pairing?.next).toEqual({ label: 'A v B', scheduledStart: new Date(1000) });
  });

  // Four questions (1): the same next twice is the same pairing object, so a selector over it does not re-render.
  it('hands back the same court pairing while its JSON is unchanged, and a new one when next goes', () => {
    const cache = createWireCache();
    const wire = vectorWire('paired-court-with-next');
    const first = toEngineSnapshot(wire, cache) as EngineSnapshot;
    const second = toEngineSnapshot({ ...wire, reportedAtMs: wire.reportedAtMs + 1000 }, cache);
    expect(second?.pairing).toBe(first.pairing);
    const cleared = toEngineSnapshot({ ...wire, pairing: { ...wire.pairing, next: null } }, cache);
    expect(cleared?.pairing?.next).toBeNull();
    expect(cleared?.pairing?.court).toBe('Court 2');
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
