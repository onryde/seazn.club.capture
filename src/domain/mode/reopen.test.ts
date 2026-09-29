import { describe, expect, it } from 'vitest';
import {
  expiredModes,
  leaveRule,
  reopenTarget,
  type EngineStatus,
  type SavedState,
} from '@/domain/mode/reopen';
import type { SavedCode } from '@/domain/mode/savedCode';

const NOW = new Date('2026-10-03T13:00:00Z');
const EXPIRY = new Date('2026-10-03T18:40:00Z');
const AFTER_EXPIRY = new Date('2026-10-03T19:00:00Z');

const streamCode: SavedCode = {
  mode: 'stream',
  raw: '{"fake":true}',
  slot: 0,
  savedAt: NOW,
  expiresAt: EXPIRY,
  venueTz: null,
};

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
      notice: { mode: 'stream', expiredAt: EXPIRY },
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
      codes: { scoring: { ...streamCode, mode: 'scoring', slot: null, expiresAt: null } },
    };
    expect(reopenTarget({ engine: 'idle', saved: scoring, now: NOW })).toEqual({ go: 'home' });
  });
});

describe('expiredModes', () => {
  it('names every mode whose code has expired', () => {
    expect(expiredModes(inStream, NOW)).toEqual([]);
    expect(expiredModes(inStream, AFTER_EXPIRY)).toEqual(['stream']);
  });
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
