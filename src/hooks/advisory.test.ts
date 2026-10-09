import { describe, expect, it } from 'vitest';
import type { EngineSnapshot, Telemetry } from '@/engine/CaptureEnginePort';
import { IDLE_TELEMETRY } from '@/engine/unreported';
import type { SessionState } from '@/domain/session/SessionState';
import {
  ADVISORY_KEY,
  selectCharging,
  selectKeepOpen,
  selectPublishing,
  selectShedding,
  topAdvisory,
} from '@/hooks/advisory';
import en from '@/i18n/en.json';

describe('topAdvisory (D17, CD18, D2 §4.1)', () => {
  // Live (the plate LIVE), with What viewers see hidden as shipped (owner ruling, 2026-10-09).
  const calm = {
    shed: false,
    charging: true,
    keepOpen: false,
    live: true,
    viewerCheck: false,
  } as const;
  it.each([
    ['nothing up', calm, null],
    ['charging unknown', { ...calm, charging: null }, null],
    ['not charging', { ...calm, charging: false }, 'notCharging'],
    ['hot, live, the view hidden', { ...calm, shed: true }, 'hotLive'],
    ['hot before air, the view hidden', { ...calm, shed: true, live: false }, 'hot'],
    ['hot, live, the view built in', { ...calm, shed: true, viewerCheck: true }, 'shed'],
    // Unchanged with the view built in: final review m2 goes back to the owner with the view (progress ledger).
    [
      'hot before air, the view built in',
      { ...calm, shed: true, live: false, viewerCheck: true },
      'shed',
    ],
    ['heat over not charging', { ...calm, shed: true, charging: false }, 'hotLive'],
    [
      'heat over not charging, before air',
      { ...calm, shed: true, charging: false, live: false },
      'hot',
    ],
    ['keep open over all', { ...calm, shed: true, charging: false, keepOpen: true }, 'keepOpen'],
  ] as const)('%s', (_name, input, expected) => {
    expect(topAdvisory(input)).toBe(expected);
  });

  it('has five captions, each with its key', () => {
    expect(Object.keys(ADVISORY_KEY).sort()).toEqual([
      'hot',
      'hotLive',
      'keepOpen',
      'notCharging',
      'shed',
    ]);
  });
});

describe('the advisory copy', () => {
  it('is the spec’s shed sentence, with no prefix (carry 7, spec §4)', () => {
    expect(en[ADVISORY_KEY.shed]).toBe('Phone hot — viewer check off, still live');
  });

  // The controller's ruling implementing the owner's (2026-10-09): with the view hidden the caption does not name it,
  // and says "still live" only where it is.
  it('with the view hidden, is "Phone hot · still live" live and "Phone hot" before air', () => {
    expect(en[ADVISORY_KEY.hotLive]).toBe('Phone hot · still live');
    expect(en[ADVISORY_KEY.hot]).toBe('Phone hot');
  });
});

// CD18: a phone that would not survive the background must say so before
// anything else, since leaving the app is what would end the capture.
describe('topAdvisory: keep the app open (CD18)', () => {
  const phase = { live: true, viewerCheck: false } as const;
  it('outranks every other caption', () => {
    expect(topAdvisory({ ...phase, shed: true, charging: false, keepOpen: true })).toBe('keepOpen');
    expect(topAdvisory({ ...phase, shed: false, charging: false, keepOpen: true })).toBe(
      'keepOpen',
    );
  });

  it('says it alone when nothing else is up', () => {
    expect(topAdvisory({ ...phase, shed: false, charging: true, keepOpen: true })).toBe('keepOpen');
  });

  it('reads its line from the dictionary', () => {
    expect(en[ADVISORY_KEY.keepOpen]).toBe('Keep the app open — capture stops in the background');
  });
});

/**
 * CD18 from Pairing on: native's service runs from the pair (amendment §2),
 * so any held pairing that would not survive the background asks. Every kind,
 * written out; idle and ended hold nothing.
 */
const KEEP_OPEN: readonly (readonly [SessionState, boolean])[] = [
  [{ kind: 'idle' }, false],
  [{ kind: 'pairing' }, true],
  [{ kind: 'paired' }, true],
  [{ kind: 'arming', cause: 'operator', retrying: false }, true],
  [{ kind: 'armed', cause: 'operator', notReady: 'camera' }, true],
  [{ kind: 'connecting', transport: 'srt' }, true],
  [{ kind: 'publishing', transport: 'srt', sinceEpochMs: 1 }, true],
  [{ kind: 'degraded', transport: 'srt', reason: 'poor-uplink', sinceEpochMs: 1 }, true],
  [
    {
      kind: 'reconnecting',
      cause: 'uplink-lost',
      holdRemainingSeconds: 10,
      holdWindowSeconds: 30,
      sinceEpochMs: 1,
    },
    true,
  ],
  [{ kind: 'ended', reason: 'operator-stopped', durationMs: null }, false],
];

/**
 * The heat caption's "still live" is said beside a LIVE plate only (`tallyPlateFor`: Publishing). Native sends `shed`
 * from Armed on (Projection.kt:29); Armed and Connecting are before air, and Degraded and a reconnect hold read
 * TROUBLE, with urgent lines that keep the strip. Every kind, written out.
 */
const PUBLISHING: readonly (readonly [SessionState, boolean])[] = [
  [{ kind: 'idle' }, false],
  [{ kind: 'pairing' }, false],
  [{ kind: 'paired' }, false],
  [{ kind: 'arming', cause: 'operator', retrying: false }, false],
  [{ kind: 'armed', cause: 'operator', notReady: null }, false],
  [{ kind: 'connecting', transport: 'srt' }, false],
  [{ kind: 'publishing', transport: 'srt', sinceEpochMs: 1 }, true],
  [{ kind: 'degraded', transport: 'srt', reason: 'poor-uplink', sinceEpochMs: 1 }, false],
  [
    {
      kind: 'reconnecting',
      cause: 'uplink-lost',
      holdRemainingSeconds: 10,
      holdWindowSeconds: 30,
      sinceEpochMs: 1,
    },
    false,
  ],
  [{ kind: 'ended', reason: 'operator-stopped', durationMs: null }, false],
];

describe('selectPublishing (the heat caption’s "still live", 2026-10-09)', () => {
  it('checks all ten kinds (PV12: zero is a failure)', () => {
    expect(new Set(PUBLISHING.map(([state]) => state.kind)).size).toBe(10);
  });

  it.each(PUBLISHING)('%o: %s', (state, live) => {
    expect(selectPublishing({ ...snapshot({ shed: 'viewer-feed' }), state })).toBe(live);
  });
});

describe('selectKeepOpen (CD18)', () => {
  it('checks all ten kinds (PV12: zero is a failure)', () => {
    expect(new Set(KEEP_OPEN.map(([state]) => state.kind)).size).toBe(10);
  });

  it.each(KEEP_OPEN)('%o, not surviving the background: %s', (state, asks) => {
    expect(selectKeepOpen({ ...snapshot({}), state, survivesBackground: false })).toBe(asks);
  });

  it.each(KEEP_OPEN)('%o, surviving the background: never', (state) => {
    expect(selectKeepOpen({ ...snapshot({}), state, survivesBackground: true })).toBe(false);
  });
});

function snapshot(telemetry: Partial<Telemetry>): EngineSnapshot {
  return {
    state: { kind: 'publishing', transport: 'srt', sinceEpochMs: 1 },
    telemetry: { ...IDLE_TELEMETRY, ...telemetry },
    pairing: null,
    broadcast: null,
    ready: { camera: true, sound: true, network: true, held: true },
    refusal: null,
    lastEnd: null,
    unpaired: null,
    codeEndedPending: false,
    camera: 'own',
    reportedAtMs: 1,
    survivesBackground: false,
  };
}

describe('selectShedding (D2 §4.2: any step down the ladder reads as shedding)', () => {
  it.each([
    [null, false],
    ['viewer-feed', true],
    ['preview-framerate', true],
    ['encode', true],
  ] as const)('shed %s: %s', (shed, shedding) => {
    expect(selectShedding(snapshot({ shed }))).toBe(shedding);
  });
});

describe('selectCharging', () => {
  it.each([[true], [false], [null]] as const)('passes %s through', (charging) => {
    expect(selectCharging(snapshot({ charging }))).toBe(charging);
  });
});
