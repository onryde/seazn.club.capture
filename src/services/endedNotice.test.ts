import { describe, expect, it, vi } from 'vitest';
import type { EndedCard } from '@/domain/session/endedCard';
import { createEndedNotice } from '@/services/endedNotice';

const CARD: EndedCard = { reason: 'operator-stopped', durationMs: 754_000, codeEnded: false };

describe('endedNotice', () => {
  it('holds no card at creation', () => {
    expect(createEndedNotice().getSnapshot()).toBeNull();
  });

  it('shows a card once: one notification, a copy equal to the card but not the card itself (D8)', () => {
    const notice = createEndedNotice();
    const heard = vi.fn();
    notice.subscribe(heard);
    notice.show(CARD);
    expect(heard).toHaveBeenCalledTimes(1);
    expect(notice.getSnapshot()).toEqual(CARD);
    expect(notice.getSnapshot()).not.toBe(CARD);
  });

  // The "fresh card" rule at its source: a second broadcast that ended the same way is a new card, so a
  // subscriber that compares by identity (useSyncExternalStore) hears it.
  it('shows an equal card twice as two snapshots and two notifications', () => {
    const notice = createEndedNotice();
    const heard = vi.fn();
    notice.subscribe(heard);
    notice.show(CARD);
    const first = notice.getSnapshot();
    notice.show(CARD);
    expect(heard).toHaveBeenCalledTimes(2);
    expect(notice.getSnapshot()).toEqual(first);
    expect(notice.getSnapshot()).not.toBe(first);
  });

  it('clears: one notification, then no card', () => {
    const notice = createEndedNotice();
    notice.show(CARD);
    const heard = vi.fn();
    notice.subscribe(heard);
    notice.clear();
    expect(heard).toHaveBeenCalledTimes(1);
    expect(notice.getSnapshot()).toBeNull();
  });

  it('does not notify for a second clear, or for a clear with nothing shown', () => {
    const notice = createEndedNotice();
    const heard = vi.fn();
    notice.subscribe(heard);
    notice.clear();
    expect(heard).not.toHaveBeenCalled();
    notice.show(CARD);
    notice.clear();
    notice.clear();
    expect(heard).toHaveBeenCalledTimes(2);
  });

  it('shows a fresh card after a clear (OK, then another broadcast)', () => {
    const notice = createEndedNotice();
    notice.show(CARD);
    notice.clear();
    notice.show({ ...CARD, durationMs: 61_000 });
    expect(notice.getSnapshot()).toEqual({ ...CARD, durationMs: 61_000 });
  });

  it('tells nobody once unsubscribed', () => {
    const notice = createEndedNotice();
    const heard = vi.fn();
    const off = notice.subscribe(heard);
    off();
    notice.show(CARD);
    notice.clear();
    expect(heard).not.toHaveBeenCalled();
  });

  // The card lives in memory only: a restart builds new ports, and nothing is shared between two of them.
  it('shares nothing between two notices (a restart)', () => {
    const before = createEndedNotice();
    before.show(CARD);
    const after = createEndedNotice();
    expect(after.getSnapshot()).toBeNull();
    after.show({ ...CARD, durationMs: 1_000 });
    expect(before.getSnapshot()).toEqual(CARD);
  });
});
