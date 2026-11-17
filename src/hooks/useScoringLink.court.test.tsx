import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useScoringLink } from '@/hooks/useScoringLink';
import type { ScoringLinkOutcome } from '@/services/scoringLinkPort';
import { createFakePorts } from '../../test/fakePorts';
import { FAKE_SCORING_SECRET, FAKE_SCORING_URL } from '../../test/fakeScoringLinkPort';
import { savedCourtCode, savedStreamCode } from '../../test/fixtures/savedStream';
import { pairCode } from '../../test/pairCode';
import { wrapperFor } from '../../test/renderWithPorts';

// Court stream (spec 2026-11-14, the scoring stale guard; Review Focus 3). On a court the link asked for is the court's
// next called match (O10), so when the match behind the court moves (a handover's sid, the waiting label, the next
// match) a shown panel goes, and an answer still in flight is dropped. A fixture's code is unchanged.

const OK: ScoringLinkOutcome = {
  kind: 'ok',
  url: FAKE_SCORING_URL,
  label: 'Northside v Riverside',
};
const NEXT_A = { label: 'Northside v Riverside', scheduledStart: null };
const NEXT_B = { label: 'Eastside v Westside', scheduledStart: null };

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

function setup(code = savedCourtCode()) {
  const fakes = createFakePorts();
  pairCode(fakes.engine, code);
  const hook = renderHook(() => useScoringLink(false), { wrapper: wrapperFor(fakes) });
  return {
    fakes,
    view: () => hook.result.current.view,
    tap: () => act(async () => hook.result.current.open()),
    /** The match behind the court moves, as a beat or the descriptor would report it. */
    nextIs: (next: typeof NEXT_A | null) => act(() => fakes.engine.setPairing({ next })),
    goLive: () => act(() => fakes.engine.hear({ word: 'go-live', cause: 'organiser' })),
  };
}

describe('the court’s scoring panel never outlives its match', () => {
  it('starts on a court code (anti-vacuity)', () => {
    const { fakes } = setup();
    expect(fakes.engine.getSnapshot().pairing?.court).toBe('Court 2');
    expect(fakes.engine.getSnapshot().broadcast).toBeNull();
  });

  it('hides the panel when the court’s sid changes while it shows', async () => {
    const { view, tap, goLive, fakes } = setup();
    await tap();
    expect(view().kind).toBe('shown');
    goLive();
    expect(fakes.engine.getSnapshot().broadcast?.sid).toBe('fake-sid-1');
    expect(view()).toEqual({ kind: 'hidden' });
  });

  it('hides the panel when the next label changes while it shows', async () => {
    const { view, tap, nextIs } = setup();
    nextIs(NEXT_A);
    await tap();
    expect(view().kind).toBe('shown');
    nextIs(NEXT_B);
    expect(view()).toEqual({ kind: 'hidden' });
  });

  it('hides the panel when the match label changes while it shows', async () => {
    const { fakes, view, tap } = setup();
    await tap();
    expect(view().kind).toBe('shown');
    act(() => fakes.engine.setPairing({ label: 'Eastside v Westside' }));
    expect(view()).toEqual({ kind: 'hidden' });
  });

  it('hides a refusal too, when the next match moves (it was said of the old one)', async () => {
    const { fakes, view, tap, nextIs } = setup();
    fakes.scoringLink.answerWith({ kind: 'refused', word: 'no_match', retryAfterS: null });
    await tap();
    expect(view().kind).toBe('refused');
    nextIs(NEXT_A);
    expect(view()).toEqual({ kind: 'hidden' });
  });

  // Review Focus 3: the scorer taps, and the match behind the court moves before the answer lands.
  it('drops an answer that lands after the court’s match moved', async () => {
    const { fakes, view, tap, nextIs } = setup();
    nextIs(NEXT_A);
    fakes.scoringLink.hold();
    await tap();
    expect(view()).toEqual({ kind: 'asking' });
    nextIs(NEXT_B);
    expect(view()).toEqual({ kind: 'hidden' });
    await act(async () => fakes.scoringLink.release(OK));
    expect(view()).toEqual({ kind: 'hidden' });
    expect(JSON.stringify(view())).not.toContain(FAKE_SCORING_SECRET);
  });

  it('drops an answer that lands after a handover (four questions 3: the sid moves mid-ask)', async () => {
    const { fakes, view, tap, goLive } = setup();
    fakes.scoringLink.hold();
    await tap();
    goLive();
    await act(async () => fakes.scoringLink.release(OK));
    expect(view()).toEqual({ kind: 'hidden' });
  });

  it('two taps across a re-point: one ask in flight at a time, and the tap after the hide asks again', async () => {
    const { fakes, view, tap, nextIs } = setup();
    fakes.scoringLink.hold();
    await tap();
    await tap(); // a second call while the first is out: ignored
    expect(fakes.scoringLink.calls).toBe(1);
    nextIs(NEXT_A); // the re-point drops ask 1
    fakes.scoringLink.hold();
    await tap(); // ask 2, for the new match
    expect(fakes.scoringLink.calls).toBe(2);
    // Oldest first: ask 1's answer is dropped, ask 2's is shown.
    await act(async () => fakes.scoringLink.release({ ...OK, label: 'Old v Match' }));
    expect(view()).toEqual({ kind: 'asking' });
    await act(async () => fakes.scoringLink.release(OK));
    expect(view()).toEqual({
      kind: 'shown',
      url: FAKE_SCORING_URL,
      label: 'Northside v Riverside',
    });
  });

  it('a stable key never hides: a court with no next and no sid, reported again and again (four questions 2)', async () => {
    const { fakes, view, tap, nextIs } = setup();
    await tap();
    expect(view().kind).toBe('shown');
    act(() => fakes.engine.patch({ audioLevel: 0.3 }));
    nextIs(null); // the same nothing again
    act(() => vi.advanceTimersByTime(3_000));
    expect(view().kind).toBe('shown');
  });

  it('keeps the server’s wait across a re-point: the court’s code is the same code', async () => {
    const { fakes, view, tap, nextIs } = setup();
    fakes.scoringLink.answerWith({ kind: 'refused', word: 'rate_limited', retryAfterS: 60 });
    await tap();
    expect(fakes.scoringLink.calls).toBe(1);
    nextIs(NEXT_A);
    await tap();
    expect(fakes.scoringLink.calls).toBe(1);
    expect(view()).toMatchObject({ kind: 'refused', word: 'rate_limited' });
  });

  it('a fixture code going live keeps the panel (today’s behaviour, pinned; four questions 4)', async () => {
    const { view, tap, goLive, fakes } = setup(savedStreamCode());
    expect(fakes.engine.getSnapshot().pairing?.court).toBeNull();
    await tap();
    goLive();
    expect(fakes.engine.getSnapshot().broadcast?.sid).toBe('fake-sid-1');
    expect(view().kind).toBe('shown');
  });
});
