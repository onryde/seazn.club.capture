import { describe, expect, it } from 'vitest';
import { NO_NAME, type CodeName } from '@/domain/mode/codeName';
import {
  expiredModes,
  forgetsSaved,
  leaveRule,
  orphanedSession,
  reopenTarget,
  resumesAtColdStart,
  tapToPairMark,
  type EngineStatus,
  type SavedState,
} from '@/domain/mode/reopen';
import type { SavedCode } from '@/domain/mode/savedCode';
import { sampleWaiting } from '@/services/fakeCodePort';
import { savedStreamCode } from '../../../test/fixtures/savedStream';
import { FIXTURE_CODE, FIXTURE_TOKEN_TAG } from '../../../test/fixtures/wire';

const NOW = new Date('2026-10-03T13:00:00Z');
const EXPIRY = new Date('2026-10-03T18:40:00Z');
const AFTER_EXPIRY = new Date('2026-10-03T19:00:00Z');

const streamCode: SavedCode = savedStreamCode({ expiresAt: EXPIRY });

const inStream: SavedState = { active: 'stream', codes: { stream: streamCode } };
const nothing: SavedState = { active: null, codes: {} };

/** The fixture QR's name, written out: its code, slot 1, and its token's tag (T22, computed apart). */
const NAME: CodeName = { code: FIXTURE_CODE, slot: 1, tokenTag: FIXTURE_TOKEN_TAG };
const OTHER: CodeName = { ...NAME, slot: 2 };
const marked = savedStreamCode({
  expiresAt: EXPIRY,
  stream: { ...(streamCode.stream ?? fail()), tapToPair: true },
});

function fail(): never {
  throw new Error('the fixture has a stream part');
}

/**
 * The amendment's _Process death and reopen_: the re-pair runs once, at cold
 * start, on an Idle engine, with the active mode stream, a saved unexpired
 * code, not tapToPair, and no `unpaired` naming it.
 */
describe('the cold-start re-pair (Process death and reopen)', () => {
  type Facts = Parameters<typeof resumesAtColdStart>[0];
  const base: Facts = { engine: 'idle', unpaired: null, saved: inStream, now: NOW };
  it('runs on an Idle engine with the four conditions', () => {
    expect(resumesAtColdStart(base)).toBe(true);
  });
  it.each<[string, Partial<Facts>]>([
    ['the engine is paired', { engine: 'paired' }],
    ['the engine holds a broadcast', { engine: 'live' }],
    ['the engine is stopped', { engine: 'stopped' }],
    ['the engine failed', { engine: 'failed' }],
    ['another mode is active', { saved: { ...inStream, active: 'scoring' } }],
    ['no mode is active', { saved: { ...inStream, active: null } }],
    ['no code is saved', { saved: { active: 'stream', codes: {} } }],
    ['the code expired', { now: AFTER_EXPIRY }],
    ['the code expires this instant', { now: EXPIRY }],
    ['the code is tapToPair', { saved: { active: 'stream', codes: { stream: marked } } }],
    [
      'the code has no stream part',
      { saved: { active: 'stream', codes: { stream: { ...streamCode, stream: null } } } },
    ],
    ['a forget is still landing', { unpaired: NAME }],
    [
      'the saved code cannot be read',
      { saved: { active: 'stream', codes: { stream: { ...streamCode, raw: '{}' } } } },
    ],
  ])('does not run when %s', (_why, change) => {
    expect(resumesAtColdStart({ ...base, ...change })).toBe(false);
  });
  it('runs when unpaired names another code, or no code at all', () => {
    expect(resumesAtColdStart({ ...base, unpaired: OTHER })).toBe(true);
    expect(resumesAtColdStart({ ...base, unpaired: NO_NAME })).toBe(true);
  });
});

describe('reopenTarget', () => {
  it('returns to Live Stream when the engine is live, whatever was saved', () => {
    expect(
      reopenTarget({ engine: 'live', saved: nothing, now: AFTER_EXPIRY, resumed: false }),
    ).toEqual({
      go: 'stream',
    });
  });

  // R23: an expired code is kept while the engine holds it.
  it.each<[string, SavedState, Date]>([
    ['active and valid', inStream, NOW],
    ['active and expired', inStream, AFTER_EXPIRY],
    ['kept though not active', { active: null, codes: { stream: streamCode } }, NOW],
  ])(
    'returns to Live Stream when the engine is paired and a code is saved, %s',
    (_, saved, now) => {
      expect(reopenTarget({ engine: 'paired', saved, now, resumed: false })).toEqual({
        go: 'stream',
      });
    },
  );

  // I1 (final review): nothing saved owns it, so it is an orphan, cleared on the way Home.
  it('goes Home quietly when the engine is paired and no code is saved', () => {
    expect(reopenTarget({ engine: 'paired', saved: nothing, now: NOW, resumed: false })).toEqual({
      go: 'home',
    });
    const activeOnly: SavedState = { active: 'stream', codes: {} };
    expect(reopenTarget({ engine: 'paired', saved: activeOnly, now: NOW, resumed: false })).toEqual(
      { go: 'home' },
    );
  });

  // The amendment: a visit never pairs, so only the re-pair puts an Idle engine on /stream.
  it('reopens an Idle engine into /stream only when the re-pair was sent', () => {
    expect(reopenTarget({ engine: 'idle', saved: inStream, now: NOW, resumed: true })).toEqual({
      go: 'stream',
    });
    expect(reopenTarget({ engine: 'idle', saved: inStream, now: NOW, resumed: false })).toEqual({
      go: 'home',
    });
  });

  it('keeps a permanent failure on its Ended screen while its code is kept', () => {
    expect(reopenTarget({ engine: 'failed', saved: inStream, now: NOW, resumed: false })).toEqual({
      go: 'stream',
    });
  });

  it("goes Home after the operator's Stop", () => {
    expect(reopenTarget({ engine: 'stopped', saved: inStream, now: NOW, resumed: false })).toEqual({
      go: 'home',
    });
  });

  it('goes Home with a notice once the code has expired', () => {
    expect(
      reopenTarget({ engine: 'idle', saved: inStream, now: AFTER_EXPIRY, resumed: false }),
    ).toEqual({
      go: 'home',
      notice: { mode: 'stream', expiredAt: EXPIRY, venueTz: 'Europe/London' },
    });
  });

  it('names the venue zone in the notice, and none when the code has no stream part', () => {
    const madrid = savedStreamCode({
      expiresAt: EXPIRY,
      stream: {
        waiting: sampleWaiting({ venueTimezone: 'Europe/Madrid' }),
        codeUrl: 'https://stg.seazn.club/api/v1/capture/codes/fx42hmnp7k2q',
        tapToPair: false,
      },
    });
    const inMadrid: SavedState = { active: 'stream', codes: { stream: madrid } };
    expect(
      reopenTarget({ engine: 'idle', saved: inMadrid, now: AFTER_EXPIRY, resumed: false }),
    ).toMatchObject({
      notice: { venueTz: 'Europe/Madrid' },
    });
    const bare: SavedState = {
      active: 'stream',
      codes: { stream: { ...madrid, stream: null } },
    };
    expect(
      reopenTarget({ engine: 'idle', saved: bare, now: AFTER_EXPIRY, resumed: false }),
    ).toMatchObject({
      notice: { venueTz: null },
    });
  });

  it('goes Home quietly when no mode was active', () => {
    expect(reopenTarget({ engine: 'idle', saved: nothing, now: NOW, resumed: false })).toEqual({
      go: 'home',
    });
    const kept: SavedState = { active: null, codes: { stream: streamCode } };
    expect(reopenTarget({ engine: 'stopped', saved: kept, now: NOW, resumed: false })).toEqual({
      go: 'home',
    });
  });

  it('goes Home when the active mode has no saved code', () => {
    const orphan: SavedState = { active: 'stream', codes: {} };
    expect(reopenTarget({ engine: 'idle', saved: orphan, now: NOW, resumed: false })).toEqual({
      go: 'home',
    });
  });

  it('goes Home when the active mode is not built yet', () => {
    const scoring: SavedState = {
      active: 'scoring',
      codes: {
        scoring: { ...streamCode, mode: 'scoring', slot: null, expiresAt: null, stream: null },
      },
    };
    expect(reopenTarget({ engine: 'idle', saved: scoring, now: NOW, resumed: false })).toEqual({
      go: 'home',
    });
  });
});

describe('expiredModes', () => {
  it('names every mode whose code has expired', () => {
    expect(expiredModes(inStream, NOW)).toEqual([]);
    expect(expiredModes(inStream, AFTER_EXPIRY)).toEqual(['stream']);
  });

  // Without exactOptionalPropertyTypes a present-but-undefined key is a valid
  // SavedState. It must not throw inside the reopen gate before the splash hides.
  it('skips a mode whose code is undefined', () => {
    const hollow: SavedState = { active: 'stream', codes: { stream: undefined } };
    expect(expiredModes(hollow, NOW)).toEqual([]);
  });
});

/**
 * N4: an ended session is shown only on its own code's Ended screen. Once the
 * phone no longer holds that code, nothing can show it, and the next code
 * opened would land on it instead of arming.
 */
describe('orphanedSession', () => {
  const keptOnly: SavedState = { active: null, codes: { stream: streamCode } };
  const neverExpires: SavedState = {
    active: 'stream',
    codes: { stream: savedStreamCode({ expiresAt: null }) },
  };
  it.each<[string, boolean, EngineStatus, SavedState, Date]>([
    ['stopped, its code expired', true, 'stopped', inStream, AFTER_EXPIRY],
    ['failed, its code expired', true, 'failed', inStream, AFTER_EXPIRY],
    ['stopped, the code expiring this instant', true, 'stopped', inStream, EXPIRY],
    ['stopped, nothing saved', true, 'stopped', nothing, NOW],
    ['failed, nothing saved', true, 'failed', nothing, NOW],
    ['stopped, its code still valid', false, 'stopped', inStream, NOW],
    ['failed, its code still valid', false, 'failed', inStream, NOW],
    ['stopped, its code kept though not active', false, 'stopped', keptOnly, NOW],
    ['stopped, a code with no expiry', false, 'stopped', neverExpires, AFTER_EXPIRY],
    ['idle, nothing saved', false, 'idle', nothing, NOW],
    // I1 (final review): a pairing no saved code owns is an orphan too.
    ['paired, nothing saved', true, 'paired', nothing, NOW],
    ['paired, its code still valid', false, 'paired', inStream, NOW],
    ['paired, its code kept though not active', false, 'paired', keptOnly, NOW],
    // R23: the engine holds the expired code; the settle after it lets go expires it.
    ['paired, its code expired', false, 'paired', inStream, AFTER_EXPIRY],
    ['live, its code expired', false, 'live', inStream, AFTER_EXPIRY],
    ['live, nothing saved', false, 'live', nothing, NOW],
  ])('%s → orphaned: %s', (_, orphaned, engine, saved, now) => {
    expect(orphanedSession({ engine, saved, now })).toBe(orphaned);
  });
});

/** The engine port: JS forgets the code native says ended, by identity. */
describe('the forget rule (The engine port)', () => {
  it('forgets when unpaired or an operator stop names the saved code', () => {
    expect(forgetsSaved({ saved: NAME, unpaired: NAME, stopped: null })).toBe(true);
    expect(forgetsSaved({ saved: NAME, unpaired: null, stopped: NAME })).toBe(true);
  });
  it('keeps a code another pairing ended, or when nothing ended', () => {
    expect(forgetsSaved({ saved: NAME, unpaired: OTHER, stopped: OTHER })).toBe(false);
    expect(forgetsSaved({ saved: NAME, unpaired: null, stopped: null })).toBe(false);
    expect(forgetsSaved({ saved: NO_NAME, unpaired: NO_NAME, stopped: NO_NAME })).toBe(false);
  });
  it('keeps a code re-issued with a new token: another tag is another code (N2)', () => {
    const reissued = { ...NAME, tokenTag: 'cd2b4f7d' };
    expect(forgetsSaved({ saved: NAME, unpaired: reissued, stopped: reissued })).toBe(false);
  });
});

describe('tapToPair', () => {
  it('marks a code whose pairing failed permanently, once', () => {
    expect(tapToPairMark({ saved: NAME, marked: false, failed: NAME, paired: null })).toBe('mark');
    expect(tapToPairMark({ saved: NAME, marked: true, failed: NAME, paired: null })).toBeNull();
  });
  it('clears the mark once that code is paired, and only that code', () => {
    expect(tapToPairMark({ saved: NAME, marked: true, failed: null, paired: NAME })).toBe('clear');
    expect(tapToPairMark({ saved: NAME, marked: true, failed: null, paired: OTHER })).toBeNull();
    expect(tapToPairMark({ saved: NAME, marked: false, failed: null, paired: NAME })).toBeNull();
  });
  it("leaves another code's failure alone, and an unnamed one", () => {
    expect(tapToPairMark({ saved: NAME, marked: false, failed: OTHER, paired: null })).toBeNull();
    expect(
      tapToPairMark({ saved: NO_NAME, marked: false, failed: NO_NAME, paired: null }),
    ).toBeNull();
  });
});

describe('leaveRule', () => {
  it.each<[EngineStatus, boolean, string]>([
    ['idle', true, 'free'],
    ['paired', true, 'free'],
    ['failed', true, 'free'],
    ['live', true, 'blockedOnAir'],
    ['stopped', true, 'freeAndForget'],
    // Fix round 3: another code's stopped session spends nothing of this code's.
    ['stopped', false, 'free'],
    ['idle', false, 'free'],
    ['paired', false, 'free'],
    ['failed', false, 'free'],
    ['live', false, 'blockedOnAir'],
  ])(
    'when the engine is %s (this code’s session: %s), leaving Live Stream is %s',
    (engine, own, rule) => {
      expect(leaveRule('stream', engine, own)).toBe(rule);
    },
  );
});
