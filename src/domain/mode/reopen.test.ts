import { describe, expect, it } from 'vitest';
import {
  expiredModes,
  leaveRule,
  orphanedSession,
  reopenTarget,
  type EngineStatus,
  type SavedState,
} from '@/domain/mode/reopen';
import type { SavedCode } from '@/domain/mode/savedCode';
import { sampleWaiting } from '@/services/fakeCodePort';
import { savedStreamCode } from '../../../test/fixtures/savedStream';

const NOW = new Date('2026-10-03T13:00:00Z');
const EXPIRY = new Date('2026-10-03T18:40:00Z');
const AFTER_EXPIRY = new Date('2026-10-03T19:00:00Z');

const streamCode: SavedCode = savedStreamCode({ expiresAt: EXPIRY });

const inStream: SavedState = { active: 'stream', codes: { stream: streamCode } };
const nothing: SavedState = { active: null, codes: {} };

describe('reopenTarget', () => {
  it('returns to Live Stream when the engine is live, whatever was saved', () => {
    expect(reopenTarget({ engine: 'live', saved: nothing, now: AFTER_EXPIRY })).toEqual({
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
      expect(reopenTarget({ engine: 'paired', saved, now })).toEqual({ go: 'stream' });
    },
  );

  // I1 (final review): nothing saved owns it, so it is an orphan, cleared on the way Home.
  it('goes Home quietly when the engine is paired and no code is saved', () => {
    expect(reopenTarget({ engine: 'paired', saved: nothing, now: NOW })).toEqual({ go: 'home' });
    const activeOnly: SavedState = { active: 'stream', codes: {} };
    expect(reopenTarget({ engine: 'paired', saved: activeOnly, now: NOW })).toEqual({ go: 'home' });
  });

  it('returns to the last mode while its code is valid', () => {
    expect(reopenTarget({ engine: 'idle', saved: inStream, now: NOW })).toEqual({ go: 'stream' });
  });

  it('goes Home with a notice once the code has expired', () => {
    expect(reopenTarget({ engine: 'idle', saved: inStream, now: AFTER_EXPIRY })).toEqual({
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
    expect(reopenTarget({ engine: 'idle', saved: inMadrid, now: AFTER_EXPIRY })).toMatchObject({
      notice: { venueTz: 'Europe/Madrid' },
    });
    const bare: SavedState = {
      active: 'stream',
      codes: { stream: { ...madrid, stream: null } },
    };
    expect(reopenTarget({ engine: 'idle', saved: bare, now: AFTER_EXPIRY })).toMatchObject({
      notice: { venueTz: null },
    });
  });

  it('goes Home quietly when no mode was active', () => {
    expect(reopenTarget({ engine: 'idle', saved: nothing, now: NOW })).toEqual({ go: 'home' });
    const kept: SavedState = { active: null, codes: { stream: streamCode } };
    expect(reopenTarget({ engine: 'stopped', saved: kept, now: NOW })).toEqual({ go: 'home' });
  });

  it('goes Home when the active mode has no saved code', () => {
    const orphan: SavedState = { active: 'stream', codes: {} };
    expect(reopenTarget({ engine: 'idle', saved: orphan, now: NOW })).toEqual({ go: 'home' });
  });

  it('goes Home when the active mode is not built yet', () => {
    const scoring: SavedState = {
      active: 'scoring',
      codes: {
        scoring: { ...streamCode, mode: 'scoring', slot: null, expiresAt: null, stream: null },
      },
    };
    expect(reopenTarget({ engine: 'idle', saved: scoring, now: NOW })).toEqual({ go: 'home' });
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
