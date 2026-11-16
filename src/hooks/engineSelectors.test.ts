import { describe, expect, it } from 'vitest';
import type { EngineStatus } from '@/domain/mode/reopen';
import type { SessionState } from '@/domain/session/SessionState';
import type { BroadcastInfo, PairingInfo, Unpaired } from '@/domain/session/Pairing';
import type { EngineSnapshot, Telemetry } from '@/engine/CaptureEnginePort';
import { FAKE_PAIRING } from '@/engine/FakeCaptureEngine';
import { IDLE_TELEMETRY } from '@/engine/unreported';
import { toEngineSnapshot } from '@/engine/snapshotWire';
import vectors from '@/engine/wire/snapshot-vectors.json';
import { vectorWire } from '@/engine/wire/vectorWire';
import {
  METER_SEGMENTS,
  selectBitrateKbps,
  selectEngineStatus,
  selectHeldCode,
  selectHeldName,
  selectHeldSlot,
  selectHeldTokenTag,
  selectAutomaticOn,
  selectBroadcastHeld,
  selectCodeEndedPending,
  selectCourt,
  selectCourtMatchKey,
  selectDelivery,
  selectDestination,
  selectEndReason,
  selectHoldsOrientation,
  selectLabel,
  selectMeterSegments,
  selectNextLabel,
  selectCourtWaiting,
  selectNextStartMs,
  selectPlaybackUrl,
  selectScheduledStartMs,
  selectRoundLine,
  selectUnpairedKey,
  selectUnpairedReason,
  selectVenueZone,
} from '@/hooks/engineSelectors';
import { NO_NAME } from '@/domain/mode/codeName';

const NOW = 1_700_000_000_000;

function snapshot(
  state: SessionState,
  overrides: Partial<Telemetry> = {},
  held: { pairing?: PairingInfo | null; broadcast?: BroadcastInfo | null } = {},
): EngineSnapshot {
  return {
    state,
    telemetry: { ...IDLE_TELEMETRY, ...overrides },
    pairing: held.pairing ?? null,
    broadcast: held.broadcast ?? null,
    ready: { camera: true, sound: true, network: true, held: true },
    refusal: null,
    lastEnd: null,
    unpaired: null,
    codeEndedPending: false,
    // Plan B's `Snapshot.camera`: our own with a pairing, none without one.
    camera: state.kind === 'idle' || state.kind === 'ended' ? null : 'own',
    reportedAtMs: NOW,
    survivesBackground: false,
  };
}

const LIVE: SessionState = { kind: 'publishing', transport: 'srt', sinceEpochMs: NOW };
const PAIRING: SessionState = { kind: 'pairing' };
const PAIRED: SessionState = { kind: 'paired' };
const ARMING: SessionState = { kind: 'arming', cause: 'organiser', retrying: false };
const ARMED: SessionState = { kind: 'armed', cause: 'operator', notReady: 'sound' };

describe('selectEngineStatus', () => {
  it.each<[SessionState, EngineStatus]>([
    [{ kind: 'idle' }, 'idle'],
    [PAIRING, 'paired'],
    [PAIRED, 'paired'],
    // A broadcast held, never a pairing to unpair or a code to adopt.
    [ARMING, 'live'],
    [ARMED, 'live'],
    [{ kind: 'connecting', transport: 'srt' }, 'live'],
    [{ kind: 'publishing', transport: 'srt', sinceEpochMs: 1 }, 'live'],
    [{ kind: 'degraded', transport: 'rtmps', reason: 'poor-uplink', sinceEpochMs: 1 }, 'live'],
    [
      {
        kind: 'reconnecting',
        cause: 'uplink-lost',
        holdRemainingSeconds: 30,
        holdWindowSeconds: 183,
        sinceEpochMs: 1,
      },
      'live',
    ],
    [{ kind: 'ended', reason: 'operator-stopped', durationMs: null }, 'stopped'],
    [{ kind: 'ended', reason: 'operator-stopped', durationMs: 1 }, 'stopped'],
    [{ kind: 'ended', reason: 'fatal-error', durationMs: null }, 'failed'],
  ])('%j is %s', (state, status) => {
    expect(selectEngineStatus(snapshot(state))).toBe(status);
  });
});

describe('selectDelivery (spec §9: the word the viewer layer waits on)', () => {
  it('reads native’s delivery word, each of the three, off the telemetry', () => {
    const words: readonly Telemetry['delivery'][] = ['ok', 'stalled', 'unknown'];
    const read = words.map((delivery) => selectDelivery(snapshot(LIVE, { delivery })));
    expect(read).toEqual(['ok', 'stalled', 'unknown']);
    expect(read).toHaveLength(3);
  });

  it('reads the word whatever the state is: a hold, a pairing and an idle engine carry one too', () => {
    const states: readonly SessionState[] = [{ kind: 'idle' }, PAIRING, PAIRED, ARMING, LIVE];
    for (const state of states)
      expect([state.kind, selectDelivery(snapshot(state, { delivery: 'stalled' }))]).toEqual([
        state.kind,
        'stalled',
      ]);
    expect(states).toHaveLength(5);
  });
});

describe('selectHoldsOrientation', () => {
  it.each<[SessionState, boolean]>([
    [{ kind: 'idle' }, false],
    // CD37: the camera is open while paired, so the lock holds from Pairing on.
    [PAIRING, true],
    [PAIRED, true],
    [ARMING, true],
    [ARMED, true],
    [{ kind: 'connecting', transport: 'srt' }, true],
    [{ kind: 'publishing', transport: 'srt', sinceEpochMs: 1 }, true],
    [{ kind: 'degraded', transport: 'rtmps', reason: 'poor-uplink', sinceEpochMs: 1 }, true],
    [
      {
        kind: 'reconnecting',
        cause: 'video-stalled',
        holdRemainingSeconds: 30,
        holdWindowSeconds: 183,
        sinceEpochMs: 1,
      },
      true,
    ],
    [{ kind: 'ended', reason: 'operator-stopped', durationMs: null }, false],
    [{ kind: 'ended', reason: 'fatal-error', durationMs: null }, false],
  ])('%j holds the lock: %s', (state, holds) => {
    expect(selectHoldsOrientation(snapshot(state))).toBe(holds);
  });
});

describe('selectBroadcastHeld', () => {
  // Q3 (owner) + F16: Home and Settings turn unless a broadcast is held. Paired and Pairing hold no broadcast and
  // no open camera once the viewfinder is covered, so only Arming onward holds. Written per state kind, from the
  // phase table in BridgeCore (`phase.holdsBroadcast`), never from the selector.
  const STATES: readonly (readonly [SessionState, boolean])[] = [
    [{ kind: 'idle' }, false],
    [PAIRING, false],
    [PAIRED, false],
    [ARMING, true],
    [ARMED, true],
    [{ kind: 'connecting', transport: 'srt' }, true],
    [{ kind: 'publishing', transport: 'srt', sinceEpochMs: 1 }, true],
    [{ kind: 'degraded', transport: 'rtmps', reason: 'poor-uplink', sinceEpochMs: 1 }, true],
    [
      {
        kind: 'reconnecting',
        cause: 'uplink-lost',
        holdRemainingSeconds: 30,
        holdWindowSeconds: 183,
        sinceEpochMs: 1,
      },
      true,
    ],
    [{ kind: 'ended', reason: 'operator-stopped', durationMs: null }, false],
    [{ kind: 'ended', reason: 'fatal-error', durationMs: null }, false],
  ];

  it.each(STATES)('%j holds a broadcast: %s', (state, held) => {
    expect(selectBroadcastHeld(snapshot(state))).toBe(held);
  });

  it('differs from the orientation hold exactly at Pairing and Paired, and nowhere else', () => {
    const differing = STATES.filter(
      ([state]) => selectBroadcastHeld(snapshot(state)) !== selectHoldsOrientation(snapshot(state)),
    ).map(([state]) => state.kind);
    expect(differing).toEqual(['pairing', 'paired']);
    // Anti-vacuity: every kind of the state union is in the table (ten kinds, eleven states).
    expect(new Set(STATES.map(([state]) => state.kind)).size).toBe(10);
    expect(STATES).toHaveLength(11);
  });
});

const BROADCAST: BroadcastInfo = {
  sid: 'fake-sid-1',
  cause: 'operator',
  playbackUrl: 'https://video.example/fake/manifest/video.m3u8',
  label: 'Seazn XI v Fake CC (broadcast)',
  holdWindowSeconds: { srt: 183, rtmps: 183 },
  maxDurationMinutes: 300,
  scoreUpdates: 'polled',
  srtOffered: true,
};

describe('the pairing and broadcast selectors (D8: the snapshot carries no secret)', () => {
  it('read the pairing alone while paired', () => {
    const paired = snapshot(PAIRED, {}, { pairing: FAKE_PAIRING });
    expect({
      playback: selectPlaybackUrl(paired),
      label: selectLabel(paired),
      zone: selectVenueZone(paired),
    }).toEqual({
      playback: null,
      label: 'Seazn XI v Fake CC',
      zone: 'Europe/London',
    });
  });

  it('read the broadcast over the pairing while one is held', () => {
    const live = snapshot(LIVE, {}, { pairing: FAKE_PAIRING, broadcast: BROADCAST });
    expect({
      playback: selectPlaybackUrl(live),
      label: selectLabel(live),
    }).toEqual({
      playback: 'https://video.example/fake/manifest/video.m3u8',
      label: 'Seazn XI v Fake CC (broadcast)',
    });
  });

  it('read null with nothing held', () => {
    const idle = snapshot({ kind: 'idle' });
    expect([selectPlaybackUrl(idle), selectLabel(idle), selectVenueZone(idle)]).toEqual([
      null,
      null,
      null,
    ]);
  });

  it('read an empty label or zone (a claim not yet answered) as none', () => {
    const pairing = { ...FAKE_PAIRING, label: '', venueTimezone: '' };
    const early = snapshot(PAIRING, {}, { pairing });
    expect([selectLabel(early), selectVenueZone(early)]).toEqual([null, null]);
  });
});

describe('the held name (amendment, Identity rules)', () => {
  it('reads the pairing three ways, each a stable scalar, and once whole', () => {
    const paired = snapshot(PAIRED, {}, { pairing: FAKE_PAIRING });
    expect([selectHeldCode(paired), selectHeldSlot(paired), selectHeldTokenTag(paired)]).toEqual([
      'fx42hmnp7k2q',
      1,
      'b24bb97b',
    ]);
    expect(selectHeldName(paired)).toEqual({ code: 'fx42hmnp7k2q', slot: 1, tokenTag: 'b24bb97b' });
  });

  it('names nothing with no pairing', () => {
    const idle = snapshot({ kind: 'idle' });
    expect([selectHeldCode(idle), selectHeldSlot(idle), selectHeldTokenTag(idle)]).toEqual([
      null,
      null,
      null,
    ]);
    expect(selectHeldName(idle)).toBe(NO_NAME);
  });
});

/** Amendment §2, Viewfinder paired: what the column shows beside the chips. */
describe('the waiting fields the viewfinder shows (Task 28)', () => {
  const withPairing = (change: Partial<PairingInfo>) =>
    snapshot(PAIRED, {}, { pairing: { ...FAKE_PAIRING, ...change } });

  // Court stream (spec 2026-11-14 §6.1, §6.2): the court and its next streamed match, as primitives.
  it('reads the court’s name, or null on a fixture’s code and with no pairing', () => {
    expect(selectCourt(withPairing({ court: 'Court 2' }))).toBe('Court 2');
    expect(selectCourt(withPairing({ court: null }))).toBeNull();
    expect(selectCourt(snapshot({ kind: 'idle' }))).toBeNull();
  });

  it('reads the next match’s label and start as primitives, or null with none', () => {
    const at = new Date('2026-11-14T14:00:00Z');
    const next = withPairing({ court: 'Court 2', next: { label: 'C v D', scheduledStart: at } });
    expect([selectNextLabel(next), selectNextStartMs(next)]).toEqual(['C v D', 1_794_664_800_000]);
    const unscheduled = withPairing({ next: { label: 'C v D', scheduledStart: null } });
    expect([selectNextLabel(unscheduled), selectNextStartMs(unscheduled)]).toEqual(['C v D', null]);
    // An empty input: a court with no next streamed match, and no pairing at all.
    const none = withPairing({ court: 'Court 2', next: null });
    expect([selectNextLabel(none), selectNextStartMs(none)]).toEqual([null, null]);
    const idle = snapshot({ kind: 'idle' });
    expect([selectNextLabel(idle), selectNextStartMs(idle)]).toEqual([null, null]);
  });

  // Court stream (spec 2026-11-14, the scoring stale guard): what names the match behind a court, as one string.
  it('names the court’s match as sid|label|next on a court code, and is empty on a fixture’s code', () => {
    const next = { label: 'C v D', scheduledStart: null };
    const courtLive = snapshot(
      LIVE,
      {},
      {
        pairing: { ...FAKE_PAIRING, court: 'Court 2', next },
        broadcast: BROADCAST,
      },
    );
    expect(selectCourtMatchKey(courtLive)).toBe('fake-sid-1|Seazn XI v Fake CC (broadcast)|C v D');
    // Waiting between matches: no sid, the pairing's label, no next. Stable: the same string every report.
    const courtWaiting = withPairing({ court: 'Court 2', next: null });
    expect(selectCourtMatchKey(courtWaiting)).toBe('|Seazn XI v Fake CC|');
    expect(selectCourtMatchKey({ ...courtWaiting })).toBe('|Seazn XI v Fake CC|');
    // A fixture's code never moves its key, whatever it holds.
    const fixtureLive = snapshot(
      LIVE,
      {},
      { pairing: { ...FAKE_PAIRING, next }, broadcast: BROADCAST },
    );
    expect(selectCourtMatchKey(fixtureLive)).toBe('');
    expect(selectCourtMatchKey(snapshot({ kind: 'idle' }))).toBe('');
  });

  it('reads the scheduled start as epoch ms, a primitive, or null with none', () => {
    const at = new Date('2026-10-03T13:30:00Z');
    expect(selectScheduledStartMs(withPairing({ scheduledStart: at }))).toBe(1_791_034_200_000);
    expect(selectScheduledStartMs(withPairing({ scheduledStart: null }))).toBeNull();
    expect(selectScheduledStartMs(snapshot({ kind: 'idle' }))).toBeNull();
  });

  // A4: AUTO shows only when automatic mode is on at both ends.
  it.each<[boolean, boolean, boolean]>([
    [true, true, true],
    [true, false, false],
    [false, true, false],
    [false, false, false],
  ])('AUTO with the organiser’s %s and the phone’s %s: %s', (autoAllowed, automatic, on) => {
    expect(selectAutomaticOn(withPairing({ autoAllowed, automatic }))).toBe(on);
  });

  it('shows no AUTO with no pairing', () => {
    expect(selectAutomaticOn(snapshot({ kind: 'idle' }))).toBe(false);
  });

  it('reads the destination’s name, an empty one as none, and none with no pairing', () => {
    expect(selectDestination(withPairing({ destinationName: 'YouTube · Fake CC' }))).toBe(
      'YouTube · Fake CC',
    );
    expect(selectDestination(withPairing({ destinationName: null }))).toBeNull();
    expect(selectDestination(withPairing({ destinationName: '' }))).toBeNull();
    expect(selectDestination(snapshot({ kind: 'idle' }))).toBeNull();
  });

  it('reads how a session ended only once it has', () => {
    expect([
      selectEndReason(snapshot({ kind: 'ended', reason: 'operator-stopped', durationMs: 1 })),
      selectEndReason(snapshot({ kind: 'ended', reason: 'fatal-error', durationMs: null })),
      selectEndReason(snapshot(LIVE)),
      selectEndReason(snapshot(PAIRED)),
    ]).toEqual(['operator-stopped', 'fatal-error', null, null]);
  });
});

describe('the round line selector (spec §2)', () => {
  const paired = (over: Partial<PairingInfo>) =>
    snapshot(PAIRED, {}, { pairing: { ...FAKE_PAIRING, ...over } });

  it('selectRoundLine is the pairing’s stage label, only while a match label is known, and null otherwise', () => {
    expect(selectRoundLine(paired({ label: 'A v B', stageLabel: 'Open · QF' }))).toBe('Open · QF');
    expect(selectRoundLine(paired({ label: '', stageLabel: 'Open · QF' }))).toBeNull();
    expect(selectRoundLine(paired({ label: 'A v B', stageLabel: null }))).toBeNull();
    expect(selectRoundLine(paired({ label: 'A v B', stageLabel: 'x'.repeat(41) }))).toBeNull();
    expect(selectRoundLine(snapshot(PAIRED, {}, { pairing: null }))).toBeNull();
  });

  // Court stream (spec 2026-11-14 §6.2): the court leads the round line, and stands alone with no stage.
  it('selectRoundLine leads with the court on a court code, with or without a stage', () => {
    expect(selectRoundLine(paired({ court: 'Court 2', stageLabel: 'Semi-final' }))).toBe(
      'Court 2 · Semi-final',
    );
    expect(selectRoundLine(paired({ court: 'Court 2', stageLabel: null }))).toBe('Court 2');
    // An empty input: no match label yet drops the stage but keeps the court.
    expect(selectRoundLine(paired({ court: 'Court 2', label: '', stageLabel: 'Semi-final' }))).toBe(
      'Court 2',
    );
    expect(selectRoundLine(paired({ court: null, stageLabel: 'Semi-final' }))).toBe('Semi-final');
  });

  it('selectCourtWaiting is a court code that is paired, and nothing else (I4)', () => {
    expect(selectCourtWaiting(paired({ court: 'Court 2' }))).toBe(true);
    expect(selectCourtWaiting(paired({ court: null }))).toBe(false);
    const arming = snapshot(
      { kind: 'arming', cause: 'operator', retrying: false },
      {},
      { pairing: { ...FAKE_PAIRING, court: 'Court 2' } },
    );
    expect(selectCourtWaiting(arming)).toBe(false);
    expect(selectCourtWaiting(snapshot(PAIRED, {}, { pairing: null }))).toBe(false);
  });

  // The seam, driven through its real producer: the wire native sends (the shared vector), read by the real
  // snapshot reader, then by the selector the status strip uses. The expected line is the vector's own.
  it('selectRoundLine reads the line a native snapshot carries: the shared vector, through toEngineSnapshot', () => {
    const named = (name: string) => vectors.cases.find((row) => row.name === name);
    const sent = named('paired-with-stage-label')?.wire.pairing?.stageLabel;
    // The vector really carries a line, and a paired case that carries none (the shared base) is its pair.
    expect(typeof sent).toBe('string');
    expect(sent).not.toBe('');
    expect(vectors.pairingBase.stageLabel).toBeNull();

    const read = toEngineSnapshot(vectorWire('paired-with-stage-label'));
    expect(read).not.toBeNull();
    expect(read?.pairing?.label).toBe(vectors.pairingBase.label);
    expect(selectRoundLine(read as EngineSnapshot)).toBe(sent);

    const bare = toEngineSnapshot(vectorWire('paired-after-organiser-stop'));
    expect(bare?.pairing?.label).toBe(vectors.pairingBase.label);
    expect(selectRoundLine(bare as EngineSnapshot)).toBeNull();
  });

  it('a known match label is the broadcast’s too: selectLabel reads it before the pairing’s', () => {
    const live = snapshot(
      LIVE,
      {},
      { pairing: { ...FAKE_PAIRING, label: '', stageLabel: 'Open · QF' }, broadcast: BROADCAST },
    );
    expect(selectRoundLine(live)).toBe('Open · QF');
  });
});

/** Amendment §2, Unpaired without asking: one primitive per unpair, each field in it (Task 29). */
describe('the unpair Home names', () => {
  const UNPAIRED: Unpaired = {
    reason: 'replaced',
    code: 'fx42hmnp7k2q',
    slot: 1,
    tokenTag: 'b24bb97b',
  };
  const idleWith = (unpaired: Unpaired | null) => ({ ...snapshot({ kind: 'idle' }), unpaired });

  it('keys an unpair by its reason, code, slot and tag, and reads its reason', () => {
    expect(selectUnpairedKey(idleWith(UNPAIRED))).toBe('replaced|fx42hmnp7k2q|1|b24bb97b');
    expect(selectUnpairedReason(idleWith(UNPAIRED))).toBe('replaced');
  });

  it('keys nothing with no unpair', () => {
    expect([selectUnpairedKey(idleWith(null)), selectUnpairedReason(idleWith(null))]).toEqual([
      null,
      null,
    ]);
  });

  // Each field alone moves the key, so a second unpair differing in one is a new panel.
  it.each<[string, Partial<Unpaired>]>([
    ['reason', { reason: 'taken' }],
    ['code', { code: 'fx42hmnp7k2r' }],
    ['slot', { slot: 2 }],
    ['tag', { tokenTag: 'b24bb97c' }],
  ])('gives another key for another %s', (_field, change) => {
    const key = selectUnpairedKey(idleWith({ ...UNPAIRED, ...change }));
    expect(key).not.toBeNull();
    expect(key).not.toBe('replaced|fx42hmnp7k2q|1|b24bb97b');
  });
});

describe('no reading is null, never zero (plan B reports null off air)', () => {
  it('passes a null egress through', () => {
    expect(selectBitrateKbps(snapshot(LIVE, { bitrateKbps: null }))).toBeNull();
    expect(selectBitrateKbps(snapshot(LIVE, { bitrateKbps: 2840 }))).toBe(2840);
  });
});

/**
 * Spec §4: six segments. A segment lights once the level reaches into its
 * sixth of 0..1, so any sound at all shows: a faint mic is one segment, never
 * an empty meter beside a ready mic chip. The segments' colour is the mic's
 * availability, not the level (Hud.test.tsx).
 */
describe('selectMeterSegments', () => {
  it('has six segments', () => {
    expect(METER_SEGMENTS).toBe(6);
  });

  it.each([
    [0, 0],
    [0.01, 1],
    [0.05, 1],
    [0.16, 1],
    [0.17, 2],
    [0.42, 3],
    [0.99, 6],
    [1, 6],
    [1.5, 6],
    [-1, 0],
    [Number.NaN, 0],
  ])('level %d lights %i', (audioLevel, lit) => {
    expect(selectMeterSegments(snapshot(LIVE, { audioLevel }))).toBe(lit);
  });
});

/**
 * Spec §5, F14 a: the Stream ended card says the code has ended when the Ended snapshot still carries the 401
 * deferral. The flag is the snapshot's own, read as it is in every state.
 */
describe('selectCodeEndedPending', () => {
  const ENDED: SessionState = { kind: 'ended', reason: 'operator-stopped', durationMs: 1 };

  it.each<[SessionState]>([[{ kind: 'idle' }], [PAIRED], [LIVE], [ENDED]])(
    'reads the flag as the snapshot has it, in %j',
    (state) => {
      expect(selectCodeEndedPending({ ...snapshot(state), codeEndedPending: true })).toBe(true);
      expect(selectCodeEndedPending({ ...snapshot(state), codeEndedPending: false })).toBe(false);
    },
  );
});
