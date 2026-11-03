import { describe, expect, it } from 'vitest';
import { flashCue, flashMove, type HalfFlash } from '@/domain/scoring/tapFlash';

// Owner ruling 14 (2026-10-31): "the tapped half flashes lime briefly so you see at a glance your tap counted". The
// hook numbers each counted tap on a half; a half's cue is the number of the counted tap that is its own; the flash
// acts when its cue moves. The cases below are the ruling's, written out: nothing is computed by the code under test.

describe('flashCue: the number a half’s flash reads', () => {
  it('is 0 for both halves before any tap counted (empty input: no last tap, no flash)', () => {
    expect([flashCue(null, 'first'), flashCue(null, 'second')]).toEqual([0, 0]);
  });

  it('is the counted tap’s number on its own half, and 0 on the other', () => {
    const flash: HalfFlash = { side: 'second', seq: 4 };
    expect([flashCue(flash, 'first'), flashCue(flash, 'second')]).toEqual([0, 4]);
  });
});

describe('flashMove: what a half’s flash does when its cue moves', () => {
  it('flashes for a counted tap on a half that had none', () => {
    expect(flashMove(0, 1)).toBe('flash');
  });

  it('flashes again for a second counted tap on the same half (a double tap that counted twice)', () => {
    expect(flashMove(1, 2)).toBe('flash');
  });

  it('flashes for a tap on this half after the other half’s tap took the cue away', () => {
    expect(flashMove(0, 3)).toBe('flash');
  });

  it('stops a flash still showing when the cue goes to 0: the other half’s tap counted, or the preview row cleared it', () => {
    expect(flashMove(2, 0)).toBe('stop');
  });

  it('does nothing for the same cue: a re-render, a mount with a cue already there, a bounced or refused tap', () => {
    expect([flashMove(0, 0), flashMove(3, 3)]).toEqual(['none', 'none']);
  });
});
