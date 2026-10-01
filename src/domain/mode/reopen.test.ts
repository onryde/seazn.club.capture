import { describe, expect, it } from 'vitest';
import {
  expiredModes,
  leaveRule,
  orphanedSession,
  reopenTarget,
  visitArm,
  type EngineStatus,
  type SavedState,
  type VisitArm,
} from '@/domain/mode/reopen';
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
  it.each<EngineStatus>(['armed', 'live'])(
    'returns to Live Stream when the engine is %s, whatever was saved',
    (engine) => {
      expect(reopenTarget({ engine, saved: nothing, now: AFTER_EXPIRY })).toEqual({ go: 'stream' });
    },
  );

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
    ['armed, its code expired', false, 'armed', inStream, AFTER_EXPIRY],
    ['live, its code expired', false, 'live', inStream, AFTER_EXPIRY],
  ])('%s → orphaned: %s', (_, orphaned, engine, saved, now) => {
    expect(orphanedSession({ engine, saved, now })).toBe(orphaned);
  });
});

/**
 * I1 (fix round 1, owner-visible): a visit adopts native's session only when
 * it is this code's: the same sid and the same slot (C7, fix round 2). Another
 * code's session, another slot's, or one native cannot name, is reset and the
 * code armed in its place. Live is never reset: it cannot
 * reach Home, and a reset under a broadcast would end it.
 */
describe('visitArm', () => {
  const SID = {
    A: '5d9c1d0e-0000-4000-8000-00000000000a',
    B: '5d9c1d0e-0000-4000-8000-00000000000b',
  } as const;
  type Sid = keyof typeof SID | null;
  const sid = (label: Sid) => (label === null ? null : SID[label]);
  // [engine, engine sid, engine slot, code sid, code slot, expected]
  it.each<[EngineStatus, Sid, number | null, Sid, number | null, VisitArm]>([
    ['idle', null, null, 'A', 1, 'arm'],
    ['idle', 'B', 2, 'A', 1, 'arm'],
    ['armed', 'A', 1, 'A', 1, 'adopt'],
    ['stopped', 'A', 1, 'A', 1, 'adopt'],
    ['failed', 'A', 1, 'A', 1, 'adopt'],
    ['armed', 'B', 1, 'A', 1, 'replace'],
    ['stopped', 'B', 1, 'A', 1, 'replace'],
    ['failed', 'B', 1, 'A', 1, 'replace'],
    // Fix round 2 (C7): another slot of the same session is another camera.
    ['armed', 'A', 1, 'A', 2, 'replace'],
    ['stopped', 'A', 1, 'A', 2, 'replace'],
    ['failed', 'A', 2, 'A', 1, 'replace'],
    ['armed', 'A', null, 'A', 1, 'replace'],
    ['armed', 'A', 1, 'A', null, 'replace'],
    ['armed', 'A', null, 'A', null, 'replace'],
    ['armed', null, 1, 'A', 1, 'replace'],
    ['stopped', null, 1, 'A', 1, 'replace'],
    ['armed', 'A', 1, null, 1, 'replace'],
    ['armed', null, 1, null, 1, 'replace'],
    ['live', 'A', 1, 'A', 1, 'adopt'],
    ['live', 'B', 1, 'A', 1, 'adopt'],
    ['live', 'A', 1, 'A', 2, 'adopt'],
    ['live', null, null, null, null, 'adopt'],
  ])(
    '%s, engine sid %s slot %s, code sid %s slot %s → %s',
    (engine, engineSid, engineSlot, codeSid, codeSlot, expected) => {
      expect(
        visitArm({
          engine,
          engineSid: sid(engineSid),
          engineSlot,
          codeSid: sid(codeSid),
          codeSlot,
        }),
      ).toBe(expected);
    },
  );
});

describe('leaveRule', () => {
  it.each<[EngineStatus, string]>([
    ['idle', 'free'],
    ['armed', 'free'],
    ['failed', 'free'],
    ['live', 'blockedOnAir'],
    ['stopped', 'freeAndForget'],
  ])('when the engine is %s, leaving Live Stream is %s', (engine, rule) => {
    expect(leaveRule('stream', engine)).toBe(rule);
  });
});
