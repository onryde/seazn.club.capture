import { describe, expect, it } from 'vitest';
import {
  expiredModes,
  leaveRule,
  orphanedSession,
  reopenTarget,
  replaceStep,
  stillReplacing,
  visitArm,
  type EngineStatus,
  type ReplaceStep,
  type SavedState,
  type VisitArm,
} from '@/domain/mode/reopen';
import { NO_NAME, type CodeName } from '@/domain/mode/codeName';
import type { SavedCode } from '@/domain/mode/savedCode';
import { sampleDescriptor } from '@/services/fakeDescriptorPort';
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
  ])('returns to Live Stream when the engine is armed and a code is saved, %s', (_, saved, now) => {
    expect(reopenTarget({ engine: 'armed', saved, now })).toEqual({ go: 'stream' });
  });

  // I1 (final review): nothing saved owns it, so it is an orphan, cleared on the way Home.
  it('goes Home quietly when the engine is armed and no code is saved', () => {
    expect(reopenTarget({ engine: 'armed', saved: nothing, now: NOW })).toEqual({ go: 'home' });
    const activeOnly: SavedState = { active: 'stream', codes: {} };
    expect(reopenTarget({ engine: 'armed', saved: activeOnly, now: NOW })).toEqual({ go: 'home' });
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

  it('names the venue zone in the notice, and none when the code has no descriptor', () => {
    const madrid = savedStreamCode({
      expiresAt: EXPIRY,
      descriptor: sampleDescriptor(NOW, { venueTimezone: 'Europe/Madrid' }),
    });
    const inMadrid: SavedState = { active: 'stream', codes: { stream: madrid } };
    expect(reopenTarget({ engine: 'idle', saved: inMadrid, now: AFTER_EXPIRY })).toMatchObject({
      notice: { venueTz: 'Europe/Madrid' },
    });
    const bare: SavedState = {
      active: 'stream',
      codes: { stream: { ...madrid, descriptor: null } },
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
        scoring: { ...streamCode, mode: 'scoring', slot: null, expiresAt: null, descriptor: null },
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
    // I1 (final review): an armed session no saved code owns is an orphan too.
    ['armed, nothing saved', true, 'armed', nothing, NOW],
    ['armed, its code still valid', false, 'armed', inStream, NOW],
    ['armed, its code kept though not active', false, 'armed', keptOnly, NOW],
    // R23: the engine holds the expired code; the settle after it lets go expires it.
    ['armed, its code expired', false, 'armed', inStream, AFTER_EXPIRY],
    ['live, its code expired', false, 'live', inStream, AFTER_EXPIRY],
    ['live, nothing saved', false, 'live', nothing, NOW],
  ])('%s → orphaned: %s', (_, orphaned, engine, saved, now) => {
    expect(orphanedSession({ engine, saved, now })).toBe(orphaned);
  });
});

/**
 * I1 (owner-visible): a visit adopts native's session only when it is this
 * code's: the same sid (fix round 1), slot (C7, fix round 2) and token tag
 * (N2, fix round 3). Any other non-live session is replaced and the code armed
 * in its place. Live is always adopted: it cannot reach Home, and replacing it
 * would end a broadcast.
 */
describe('visitArm', () => {
  const NAMES = {
    none: NO_NAME,
    A1: { sid: 'a', slot: 1, tokenTag: 't1' },
    A2: { sid: 'a', slot: 2, tokenTag: 't1' },
    /** A1 re-issued: the same match and slot, a new token (N2). */
    A1r: { sid: 'a', slot: 1, tokenTag: 't2' },
    B1: { sid: 'b', slot: 1, tokenTag: 't1' },
    noSid: { sid: null, slot: 1, tokenTag: 't1' },
    noSlot: { sid: 'a', slot: null, tokenTag: 't1' },
    noTag: { sid: 'a', slot: 1, tokenTag: null },
  } as const satisfies Record<string, CodeName>;
  type Name = keyof typeof NAMES;
  it.each<[EngineStatus, Name, Name, VisitArm]>([
    ['idle', 'none', 'A1', 'arm'],
    ['idle', 'B1', 'A1', 'arm'],
    ['armed', 'A1', 'A1', 'adopt'],
    ['stopped', 'A1', 'A1', 'adopt'],
    ['failed', 'A1', 'A1', 'adopt'],
    ['armed', 'B1', 'A1', 'replace'],
    ['stopped', 'B1', 'A1', 'replace'],
    ['failed', 'B1', 'A1', 'replace'],
    // C7: another slot of the same match is another camera.
    ['armed', 'A1', 'A2', 'replace'],
    ['stopped', 'A1', 'A2', 'replace'],
    ['failed', 'A2', 'A1', 'replace'],
    // N2: a re-issued code is another code.
    ['armed', 'A1', 'A1r', 'replace'],
    ['stopped', 'A1', 'A1r', 'replace'],
    ['failed', 'A1r', 'A1', 'replace'],
    // A session native cannot name, or a code the phone cannot, is never adopted.
    ['armed', 'noSid', 'A1', 'replace'],
    ['armed', 'noSlot', 'A1', 'replace'],
    ['stopped', 'noTag', 'A1', 'replace'],
    ['armed', 'A1', 'noSid', 'replace'],
    ['armed', 'A1', 'noTag', 'replace'],
    ['armed', 'none', 'none', 'replace'],
    ['stopped', 'noTag', 'noTag', 'replace'],
    // Live is always adopted: it cannot reach Home, and a stop would end it.
    ['live', 'A1', 'A1', 'adopt'],
    ['live', 'B1', 'A1', 'adopt'],
    ['live', 'A1', 'A2', 'adopt'],
    ['live', 'A1', 'A1r', 'adopt'],
    ['live', 'none', 'none', 'adopt'],
  ])('%s, engine holding %s, code %s → %s', (engine, held, code, expected) => {
    expect(visitArm({ engine, held: NAMES[held], code: NAMES[code] })).toBe(expected);
  });
});

/**
 * N1 (plan B's contract): native resets only from Ended and arms only from
 * Idle. So another code's session is cleared by the documented path, one
 * intent per snapshot: stop an armed one, reset an ended one, arm at idle.
 * Never a stop on air.
 */
describe('replaceStep', () => {
  it.each<[EngineStatus, ReplaceStep]>([
    ['armed', 'stop'],
    ['stopped', 'reset'],
    ['failed', 'reset'],
    ['idle', 'arm'],
    ['live', null],
  ])('%s → %s', (engine, step) => {
    expect(replaceStep(engine)).toBe(step);
  });
});

/**
 * N3 (owner-visible): a replacing visit shows not ready, never the session it
 * replaces, until native holds this code's session; for a code the phone
 * cannot use, until the old session is cleared. Never over a broadcast.
 */
describe('stillReplacing', () => {
  it.each<[VisitArm, boolean, boolean, EngineStatus, boolean]>([
    ['replace', false, false, 'armed', true],
    ['replace', false, false, 'stopped', true],
    ['replace', false, false, 'failed', true],
    ['replace', false, false, 'idle', true],
    ['replace', true, false, 'armed', false],
    ['replace', true, false, 'stopped', false],
    ['replace', false, true, 'armed', true],
    ['replace', false, true, 'stopped', true],
    ['replace', false, true, 'idle', false],
    ['replace', false, false, 'live', false],
    ['replace', false, true, 'live', false],
    ['adopt', false, false, 'armed', false],
    ['adopt', false, false, 'stopped', false],
    ['arm', false, false, 'idle', false],
    ['arm', false, true, 'idle', false],
  ])(
    'a visit to %s, own session %s, unusable code %s, engine %s → %s',
    (plan, own, unusable, engine, expected) => {
      expect(stillReplacing({ plan, own, unusable, engine })).toBe(expected);
    },
  );
});

describe('leaveRule', () => {
  it.each<[EngineStatus, boolean, string]>([
    ['idle', true, 'free'],
    ['armed', true, 'free'],
    ['failed', true, 'free'],
    ['live', true, 'blockedOnAir'],
    ['stopped', true, 'freeAndForget'],
    // Fix round 3: another code's stopped session spends nothing of this code's.
    ['stopped', false, 'free'],
    ['idle', false, 'free'],
    ['armed', false, 'free'],
    ['failed', false, 'free'],
    ['live', false, 'blockedOnAir'],
  ])(
    'when the engine is %s (this code’s session: %s), leaving Live Stream is %s',
    (engine, own, rule) => {
      expect(leaveRule('stream', engine, own)).toBe(rule);
    },
  );
});
