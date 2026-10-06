import { describe, expect, it } from 'vitest';
import type { EngineSnapshot, Telemetry } from '@/engine/CaptureEnginePort';
import { IDLE_TELEMETRY } from '@/engine/unreported';
import type { SessionState } from '@/domain/session/SessionState';
import {
  ADVISORY_KEY,
  selectCharging,
  selectKeepOpen,
  selectShedding,
  topAdvisory,
} from '@/hooks/advisory';
import en from '@/i18n/en.json';

const QUIET = {
  shed: false,
  overlayFailed: false,
  paired: false,
  overlayOn: true,
  charging: true,
  keepOpen: false,
} as const;

describe('topAdvisory (D17: one caption at a time, most important first)', () => {
  it('says nothing when there is nothing to say', () => {
    expect(topAdvisory(QUIET)).toBeNull();
  });

  it('puts heat first: preview paused, still live (AGENTS §8)', () => {
    expect(topAdvisory({ ...QUIET, shed: true, overlayFailed: true, charging: false })).toBe(
      'shed',
    );
  });

  it('says the score preview failed, over the rest', () => {
    expect(topAdvisory({ ...QUIET, overlayFailed: true, paired: true, charging: false })).toBe(
      'overlayFailed',
    );
  });

  it('says nothing of a failed preview the operator has turned off', () => {
    expect(topAdvisory({ ...QUIET, overlayFailed: true, overlayOn: false })).toBeNull();
  });

  // Ruling M6 (overrides D17/D18): a device advisory outranks the score note,
  // which shows while paired (framing a shot, before any broadcast) only when nothing else is up.
  it('puts a device advisory before the score note while paired', () => {
    expect(topAdvisory({ ...QUIET, paired: true, charging: false })).toBe('notCharging');
    expect(topAdvisory({ ...QUIET, paired: true, shed: true })).toBe('shed');
  });

  it.each([[true], [null]] as const)(
    'tells the operator, while paired, that the score runs ahead when nothing else is up (charging %s)',
    (charging) => {
      expect(topAdvisory({ ...QUIET, paired: true, charging })).toBe('scoreAhead');
    },
  );

  it('drops the score note once not paired, leaving the charging warning', () => {
    expect(topAdvisory({ ...QUIET, paired: false })).toBeNull();
    expect(topAdvisory({ ...QUIET, paired: false, charging: false })).toBe('notCharging');
  });

  it('does not mention the score with the preview off', () => {
    expect(topAdvisory({ ...QUIET, paired: true, overlayOn: false })).toBeNull();
  });

  it('warns when not charging; unknown is not a warning', () => {
    expect(topAdvisory({ ...QUIET, charging: false })).toBe('notCharging');
    expect(topAdvisory({ ...QUIET, charging: null })).toBeNull();
  });
});

describe('the advisory copy', () => {
  it('is the spec’s shed sentence, with no prefix (carry 7, spec §4)', () => {
    expect(en[ADVISORY_KEY.shed]).toBe('Preview paused — still live');
  });
});

// CD18: a phone that would not survive the background must say so before
// anything else, since leaving the app is what would end the capture.
describe('topAdvisory: keep the app open (CD18)', () => {
  it('outranks every other caption', () => {
    const base = {
      shed: true,
      overlayFailed: true,
      paired: true,
      overlayOn: true,
      charging: false,
    };
    expect(topAdvisory({ ...base, keepOpen: true })).toBe('keepOpen');
    expect(
      topAdvisory({
        shed: false,
        overlayFailed: false,
        paired: true,
        overlayOn: true,
        charging: null,
        keepOpen: false,
      }),
    ).toBe('scoreAhead');
  });

  it('says it alone when nothing else is up', () => {
    expect(topAdvisory({ ...QUIET, keepOpen: true })).toBe('keepOpen');
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

describe('selectShedding (AGENTS §8: any step down the ladder sheds the overlay first)', () => {
  it.each([
    [null, false],
    ['overlay-preview', true],
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
