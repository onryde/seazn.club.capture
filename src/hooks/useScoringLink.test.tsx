import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  SCORING_RETRY_MAX_S,
  SCORING_SHOW_MS,
  SCORING_SHOW_SECONDS,
  useScoringLink,
} from '@/hooks/useScoringLink';
import { SCORING_WORDS, type ScoringLinkOutcome } from '@/services/scoringLinkPort';
import { createFakePorts, readRecord } from '../../test/fakePorts';
import { FAKE_SCORING_SECRET, FAKE_SCORING_URL } from '../../test/fakeScoringLinkPort';
import { savedStreamCode } from '../../test/fixtures/savedStream';
import { captureRaw } from '../../test/fixtures/wire';
import { pairCode } from '../../test/pairCode';
import { wrapperFor } from '../../test/renderWithPorts';

const OK: ScoringLinkOutcome = { kind: 'ok', url: FAKE_SCORING_URL };
/**
 * A different pairing, by each of the three scalars that name one: the slot, the code and the token (its tag). The
 * slot and the token ride inside the scanned text, so they are changed there, not on the SavedCode.
 */
const OTHER_PAIRINGS = [
  ['slot', 'slot', () => savedStreamCode({ raw: captureRaw({ slot: 2 }), slot: 2 })],
  ['code', 'code', () => savedStreamCode({ raw: captureRaw({ code: 'ab34cdmnp7kq' }) })],
  [
    'token',
    'tokenTag',
    () => savedStreamCode({ raw: captureRaw({ tok: 'tok-0000000000000000zz' }) }),
  ],
] as const;

const refused = (
  word: (typeof SCORING_WORDS)[number],
  retryAfterS: number | null = null,
): ScoringLinkOutcome => ({ kind: 'refused', word, retryAfterS });

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

function setup() {
  const fakes = createFakePorts();
  pairCode(fakes.engine, savedStreamCode());
  const hook = renderHook(({ trouble }) => useScoringLink(trouble), {
    wrapper: wrapperFor(fakes),
    initialProps: { trouble: false },
  });
  return {
    fakes,
    hook,
    /** R8a: the session enters (true) or leaves (false) trouble, the one boolean the screen hands the hook. */
    setTrouble: (trouble: boolean) => act(() => hook.rerender({ trouble })),
    view: () => hook.result.current.view,
    left: () => hook.result.current.secondsLeft,
    /** A tap, then the fake's already-resolved promise lands. */
    tap: () => act(async () => hook.result.current.open()),
    /** Timers armed beyond the harness's own, so a leaked timer or interval shows as a number. */
    armed: (
      (base) => () =>
        vi.getTimerCount() - base
    )(vi.getTimerCount()),
  };
}

describe('useScoringLink (spec §10, D7, D8)', () => {
  it('the owner’s 10 s, written out beside the constants it is made of', () => {
    expect(SCORING_SHOW_MS).toBe(10_000);
    expect(SCORING_SHOW_SECONDS).toBe(10);
  });

  it('1: a tap from hidden asks once', async () => {
    const { fakes, view, tap } = setup();
    expect(view()).toEqual({ kind: 'hidden' });
    fakes.scoringLink.hold();
    await tap();
    expect(view().kind).toBe('asking');
    expect(fakes.scoringLink.calls).toBe(1);
    expect(readRecord(fakes.record).map((line) => line.event)).toContain('scoring.open');
  });

  it('2: shown, then hidden after exactly SCORING_SHOW_MS, and the url is gone', async () => {
    const { view, tap } = setup();
    await tap();
    expect(view()).toEqual({ kind: 'shown', url: FAKE_SCORING_URL });
    act(() => vi.advanceTimersByTime(SCORING_SHOW_MS - 1));
    expect(view().kind).toBe('shown');
    act(() => vi.advanceTimersByTime(1));
    expect(view()).toEqual({ kind: 'hidden' });
    expect(JSON.stringify(view())).not.toContain(FAKE_SCORING_SECRET);
  });

  it('3: the 10 s runs from the answer, not from the tap', async () => {
    const { fakes, view, tap } = setup();
    fakes.scoringLink.hold();
    await tap();
    expect(view().kind).toBe('asking');
    act(() => vi.advanceTimersByTime(4_000));
    await act(async () => fakes.scoringLink.release(OK));
    expect(view().kind).toBe('shown');
    act(() => vi.advanceTimersByTime(SCORING_SHOW_MS - 100));
    // 4 s asking + 9.9 s shown: a timer from the tap would have fired at 10 s
    expect(view().kind).toBe('shown');
    act(() => vi.advanceTimersByTime(100));
    expect(view()).toEqual({ kind: 'hidden' });
  });

  it('4: hide() while shown goes to hidden and clears the timer and the tick', async () => {
    const { hook, view, tap, armed } = setup();
    await tap();
    expect(armed()).toBeGreaterThan(0);
    act(() => hook.result.current.hide());
    expect(view()).toEqual({ kind: 'hidden' });
    expect(armed()).toBe(0);
    act(() => vi.advanceTimersByTime(SCORING_SHOW_MS));
    expect(view()).toEqual({ kind: 'hidden' });
  });

  it('5: a tap while asking is ignored, and a Hide while asking drops the late answer', async () => {
    const { fakes, hook, view, tap, armed } = setup();
    fakes.scoringLink.hold();
    await tap();
    await tap(); // ignored
    expect(fakes.scoringLink.calls).toBe(1);
    act(() => hook.result.current.hide());
    await act(async () => fakes.scoringLink.release(OK)); // the old ask answers after the Hide
    expect(view()).toEqual({ kind: 'hidden' });
    expect(armed()).toBe(0);
    expect(readRecord(fakes.record).map((line) => line.event)).not.toContain('scoring.shown');
  });

  it('6: Hide, then open asks again, and the old ask’s answer arriving after that is dropped', async () => {
    const { fakes, hook, view, tap } = setup();
    const other = `https://stg.seazn.club/score/dl_${'Z'.repeat(43)}`;
    fakes.scoringLink.hold();
    await tap(); // ask A
    act(() => hook.result.current.hide());
    fakes.scoringLink.hold();
    await tap(); // ask B
    expect(fakes.scoringLink.calls).toBe(2);
    // release answers oldest first: A is dropped, B is shown.
    await act(async () => fakes.scoringLink.release({ kind: 'ok', url: other }));
    expect(view()).toEqual({ kind: 'asking' });
    await act(async () => fakes.scoringLink.release(OK));
    expect(view()).toEqual({ kind: 'shown', url: FAKE_SCORING_URL });
    expect(JSON.stringify(view())).not.toContain(other);
  });

  it('7: a tap while shown is ignored and does not restart the clock', async () => {
    const { fakes, view, tap } = setup();
    await tap();
    act(() => vi.advanceTimersByTime(6_000));
    await tap();
    expect(fakes.scoringLink.calls).toBe(1);
    expect(view().kind).toBe('shown');
    act(() => vi.advanceTimersByTime(4_000));
    expect(view()).toEqual({ kind: 'hidden' });
  });

  let wordsRun = 0;
  it('8: every refusal word, from the port’s own list, is shown with its word and hides after 10 s', async () => {
    expect(SCORING_WORDS).toHaveLength(6);
    for (const word of SCORING_WORDS) {
      const { fakes, view, tap, hook } = setup();
      const retryAfterS = word === 'rate_limited' ? 30 : null;
      fakes.scoringLink.answerWith(refused(word, retryAfterS));
      await tap();
      expect(view(), word).toEqual({ kind: 'refused', word, retryAfterS });
      const lines = readRecord(fakes.record).filter((line) => line.event === 'scoring.refused');
      expect(lines, word).toHaveLength(1);
      expect(lines[0]?.fields.reason, word).toBe(word);
      act(() => vi.advanceTimersByTime(SCORING_SHOW_MS));
      expect(view(), word).toEqual({ kind: 'hidden' });
      hook.unmount();
      wordsRun += 1;
    }
    expect(wordsRun).toBe(6);
  });

  it('9: a rate limit blocks taps until its Retry-After has passed, and says what is left', async () => {
    const { fakes, view, tap } = setup();
    const t0 = fakes.ports.clock().getTime();
    fakes.scoringLink.answerWith(refused('rate_limited', 30));
    await tap();
    expect(view()).toEqual({ kind: 'refused', word: 'rate_limited', retryAfterS: 30 });
    expect(fakes.scoringLink.calls).toBe(1);
    act(() => vi.advanceTimersByTime(SCORING_SHOW_MS));
    expect(view()).toEqual({ kind: 'hidden' });
    fakes.setNow(new Date(t0 + 29_900));
    await tap();
    expect(fakes.scoringLink.calls).toBe(1); // not asked
    expect(view()).toEqual({ kind: 'refused', word: 'rate_limited', retryAfterS: 1 }); // 0.1 s, rounded up
    act(() => vi.advanceTimersByTime(SCORING_SHOW_MS));
    fakes.setNow(new Date(t0 + 30_000));
    fakes.scoringLink.answerWith(OK);
    await tap();
    expect(fakes.scoringLink.calls).toBe(2);
    expect(view().kind).toBe('shown');
  });

  it('9b: a rate limit with no Retry-After blocks nothing: a second tap right after asks', async () => {
    const { fakes, view, tap, hook } = setup();
    fakes.scoringLink.answerWith(refused('rate_limited', null));
    await tap();
    expect(view()).toEqual({ kind: 'refused', word: 'rate_limited', retryAfterS: null });
    act(() => hook.result.current.hide());
    await tap();
    expect(fakes.scoringLink.calls).toBe(2);
  });

  it('10: a rate limit the Hide made unseen still counts', async () => {
    const { fakes, hook, view, tap } = setup();
    fakes.scoringLink.hold();
    await tap();
    act(() => hook.result.current.hide());
    await act(async () => fakes.scoringLink.release(refused('rate_limited', 30)));
    expect(view()).toEqual({ kind: 'hidden' }); // dropped, never shown
    await tap();
    expect(fakes.scoringLink.calls).toBe(1); // but it blocks the next tap
    expect(view()).toEqual({ kind: 'refused', word: 'rate_limited', retryAfterS: 30 });
  });

  it('10b: a rate limit belongs to its pairing: a new pairing asks at once, the same one stays blocked', async () => {
    let rows = 0;
    for (const [name, , other] of OTHER_PAIRINGS) {
      const { fakes, hook, view, tap } = setup();
      fakes.scoringLink.answerWith(refused('rate_limited', 30));
      await tap();
      expect(view().kind, name).toBe('refused');
      act(() => hook.result.current.hide());
      await tap(); // the positive pair: the same pairing, a second later, is still blocked
      expect(fakes.scoringLink.calls, `${name}: blocked`).toBe(1);
      expect(view(), name).toEqual({ kind: 'refused', word: 'rate_limited', retryAfterS: 30 });
      act(() => hook.result.current.hide());
      fakes.scoringLink.answerWith(OK);
      act(() => pairCode(fakes.engine, other()));
      await tap();
      expect(fakes.scoringLink.calls, `${name}: asks again`).toBe(2);
      expect(view(), name).toEqual({ kind: 'shown', url: FAKE_SCORING_URL });
      rows += 1;
    }
    expect(rows).toBe(OTHER_PAIRINGS.length);
    expect(rows).toBe(3);
  });

  it('11: leaving the foreground hides it, and the hook listens only while mounted', async () => {
    const { fakes, hook, view, tap, armed } = setup();
    expect(fakes.foreground.leaveListeners()).toBe(1);
    await tap();
    expect(view().kind).toBe('shown');
    act(() => fakes.foreground.leave());
    expect(view()).toEqual({ kind: 'hidden' });
    expect(armed()).toBe(0);
    hook.unmount();
    expect(fakes.foreground.leaveListeners()).toBe(0);
  });

  it('12: the held pairing changing, by any of its three names, hides it, and so does losing it', async () => {
    let rows = 0;
    for (const [name, field, other] of OTHER_PAIRINGS) {
      const { fakes, view, tap } = setup();
      await tap();
      expect(view().kind, name).toBe('shown');
      const before = fakes.engine.getSnapshot().pairing;
      act(() => pairCode(fakes.engine, other()));
      // The fixture really moved the one name it is for (and the screen below hides on it).
      expect(fakes.engine.getSnapshot().pairing?.[field], name).not.toBe(before?.[field]);
      expect(view(), name).toEqual({ kind: 'hidden' });
      rows += 1;
    }
    expect(OTHER_PAIRINGS).toHaveLength(3);
    {
      const { fakes, view, tap } = setup();
      await tap();
      expect(view().kind).toBe('shown');
      act(() => fakes.engine.send({ kind: 'unpair' }));
      expect(view()).toEqual({ kind: 'hidden' });
      rows += 1;
    }
    expect(rows).toBe(4);
  });

  it('12b: a pairing change mid-ask drops the answer that arrives after it', async () => {
    const { fakes, view, tap, armed } = setup();
    fakes.scoringLink.hold();
    await tap();
    expect(view().kind).toBe('asking');
    act(() => pairCode(fakes.engine, OTHER_PAIRINGS[0][2]()));
    expect(view()).toEqual({ kind: 'hidden' });
    await act(async () => fakes.scoringLink.release(OK));
    expect(view()).toEqual({ kind: 'hidden' });
    expect(armed()).toBe(0);
  });

  it('13: unmounted while asking or shown, no timer is left armed', async () => {
    {
      const { fakes, hook, tap, armed } = setup();
      fakes.scoringLink.hold();
      await tap();
      hook.unmount();
      await act(async () => fakes.scoringLink.release(OK)); // no throw
      expect(armed()).toBe(0); // no timer is armed for a view nobody has
    }
    {
      const { hook, tap, armed } = setup();
      await tap();
      expect(armed()).toBeGreaterThan(0);
      hook.unmount();
      expect(armed()).toBe(0);
    }
  });

  it('14: the url reaches no record line, and the lines that should exist do', async () => {
    const { fakes, hook, tap } = setup();
    await tap();
    act(() => hook.result.current.hide());
    expect(JSON.stringify(fakes.record.lines())).not.toContain(FAKE_SCORING_SECRET);
    const events = readRecord(fakes.record).map((line) => line.event);
    expect(events).toContain('scoring.open');
    expect(events).toContain('scoring.shown');
  });

  it('15: open and hide keep their identity across a view change', async () => {
    const { hook, tap } = setup();
    const opens = [hook.result.current.open];
    const hides = [hook.result.current.hide];
    await tap();
    opens.push(hook.result.current.open);
    hides.push(hook.result.current.hide);
    act(() => hook.result.current.hide());
    opens.push(hook.result.current.open);
    hides.push(hook.result.current.hide);
    expect(opens[1]).toBe(opens[0]);
    expect(opens[2]).toBe(opens[0]);
    expect(hides[1]).toBe(hides[0]);
    expect(hides[2]).toBe(hides[0]);
  });
});

// R8a (controller ruling): the opaque panel covers the status strip, so a session ENTERING trouble takes it down.
describe('useScoringLink’s trouble (R8a)', () => {
  it('entering trouble hides a shown code and stops its timers; calm again leaves it hidden; a tap shows it again', async () => {
    const { fakes, view, tap, setTrouble, armed } = setup();
    await tap();
    expect(view().kind).toBe('shown');
    expect(armed()).toBeGreaterThan(0);
    setTrouble(true);
    expect(view()).toEqual({ kind: 'hidden' });
    expect(armed()).toBe(0);
    setTrouble(false);
    expect(view()).toEqual({ kind: 'hidden' });
    await tap();
    expect(fakes.scoringLink.calls).toBe(2);
    expect(view().kind).toBe('shown');
  });

  it('entering trouble mid-ask drops the answer that arrives after it', async () => {
    const { fakes, view, tap, setTrouble, armed } = setup();
    fakes.scoringLink.hold();
    await tap();
    expect(view().kind).toBe('asking');
    setTrouble(true);
    expect(view()).toEqual({ kind: 'hidden' });
    await act(async () => fakes.scoringLink.release(OK));
    expect(view()).toEqual({ kind: 'hidden' });
    expect(armed()).toBe(0);
    expect(readRecord(fakes.record).map((line) => line.event)).not.toContain('scoring.shown');
  });

  it('a refusal on screen is taken down too (it covers the strip the same way)', async () => {
    const { fakes, view, tap, setTrouble } = setup();
    fakes.scoringLink.answerWith(refused('replaced'));
    await tap();
    expect(view().kind).toBe('refused');
    setTrouble(true);
    expect(view()).toEqual({ kind: 'hidden' });
  });

  it('it is ENTERING that hides: a tap made while trouble stands is honoured, and only a new entry takes it down', async () => {
    const { view, tap, setTrouble } = setup();
    setTrouble(true);
    await tap();
    expect(view().kind).toBe('shown'); // the operator's own tap, with the warning already known
    act(() => vi.advanceTimersByTime(3_000));
    expect(view().kind).toBe('shown'); // trouble standing does not hide it
    setTrouble(true); // no change
    expect(view().kind).toBe('shown');
    setTrouble(false);
    expect(view().kind).toBe('shown'); // leaving trouble does not hide it either
    setTrouble(true); // a new entry
    expect(view()).toEqual({ kind: 'hidden' });
  });
});

// B3 (owner-approved board ruling): the countdown beside Hide. One 1 s tick; the 10 s hide timer stays the authority.
describe('useScoringLink’s countdown (B3)', () => {
  it('counts 10, 9 … 1 over the ten seconds, and the code is gone at the tenth', async () => {
    const { view, left, tap } = setup();
    await tap();
    const seen: number[] = [left()];
    for (let second = 1; second < SCORING_SHOW_SECONDS; second += 1) {
      act(() => vi.advanceTimersByTime(1_000));
      expect(view().kind, `at ${second} s`).toBe('shown');
      seen.push(left());
    }
    // The expected run is written from the board, not read from the hook: 10 down to 1.
    expect(seen).toEqual([10, 9, 8, 7, 6, 5, 4, 3, 2, 1]);
    act(() => vi.advanceTimersByTime(1_000));
    expect(view()).toEqual({ kind: 'hidden' });
    expect(Math.min(...seen)).toBe(1); // never 0 while it is shown
  });

  it('does not tick while asking, and starts from 10 at the answer, not at the tap', async () => {
    const { fakes, view, left, tap, armed } = setup();
    fakes.scoringLink.hold();
    await tap();
    act(() => vi.advanceTimersByTime(5_000));
    expect(view().kind).toBe('asking');
    expect(armed()).toBe(0); // no timer and no tick while there is nothing to count
    await act(async () => fakes.scoringLink.release(OK));
    expect(left()).toBe(10);
    act(() => vi.advanceTimersByTime(1_000));
    expect(left()).toBe(9);
  });

  it('counts a refusal too, since it hides itself the same way', async () => {
    const { fakes, left, view, tap } = setup();
    fakes.scoringLink.answerWith(refused('replaced'));
    await tap();
    expect(left()).toBe(10);
    act(() => vi.advanceTimersByTime(3_000));
    expect(left()).toBe(7);
    act(() => vi.advanceTimersByTime(7_000));
    expect(view()).toEqual({ kind: 'hidden' });
  });

  it('is cleared on Hide, on leaving the foreground, on a pairing change and on unmount: no tick is left to change it', async () => {
    let rows = 0;
    const exits: readonly (readonly [
      string,
      (s: ReturnType<typeof setup>) => void | Promise<void>,
    ])[] = [
      ['hide', (s) => act(() => s.hook.result.current.hide())],
      ['background', (s) => act(() => s.fakes.foreground.leave())],
      ['pairing', (s) => act(() => pairCode(s.fakes.engine, OTHER_PAIRINGS[0][2]()))],
      ['unmount', (s) => s.hook.unmount()],
    ];
    for (const [name, exit] of exits) {
      const s = setup();
      await s.tap();
      act(() => vi.advanceTimersByTime(2_000));
      expect(s.left(), name).toBe(8);
      const before = s.left();
      await exit(s);
      expect(s.armed(), name).toBe(0);
      if (name !== 'unmount') {
        act(() => vi.advanceTimersByTime(3_000));
        expect(s.left(), name).toBe(before); // a leaked tick would have moved it
      }
      rows += 1;
    }
    expect(rows).toBe(4);
  });

  it('restarts from 10 when a refusal is shown again, and the hide follows that, not the first show (tap, wait, tap)', async () => {
    const { fakes, view, left, tap } = setup();
    fakes.scoringLink.answerWith(refused('rate_limited', 30));
    await tap();
    act(() => vi.advanceTimersByTime(6_000));
    expect(left()).toBe(4);
    await tap(); // blocked: says so again, asks nothing
    expect(fakes.scoringLink.calls).toBe(1);
    expect(left()).toBe(10);
    act(() => vi.advanceTimersByTime(SCORING_SHOW_MS - 1));
    expect(view().kind).toBe('refused'); // 6 s + 9.999 s: the first show's timer would have hidden it
    act(() => vi.advanceTimersByTime(1));
    expect(view()).toEqual({ kind: 'hidden' });
  });
});

describe('useScoringLink’s refusal, then a tap (B3, D7)', () => {
  it('a tap while a refusal is still showing asks again, and the refusal’s own timer does not hide the new ask', async () => {
    const { fakes, view, left, tap, armed } = setup();
    fakes.scoringLink.answerWith(refused('replaced'));
    await tap();
    expect(view().kind).toBe('refused');
    act(() => vi.advanceTimersByTime(6_000)); // 4 s of the refusal's 10 are left
    fakes.scoringLink.answerWith(OK);
    fakes.scoringLink.hold();
    await tap(); // 'replaced' blocks nothing, so this asks
    expect(fakes.scoringLink.calls).toBe(2);
    expect(view().kind).toBe('asking');
    expect(armed()).toBe(0); // the refusal's timer and tick went when the ask began
    act(() => vi.advanceTimersByTime(5_000)); // past where the refusal's timer would have fired
    expect(view().kind).toBe('asking');
    await act(async () => fakes.scoringLink.release(OK));
    expect(view()).toEqual({ kind: 'shown', url: FAKE_SCORING_URL });
    expect(left()).toBe(10);
    act(() => vi.advanceTimersByTime(SCORING_SHOW_MS));
    expect(view()).toEqual({ kind: 'hidden' });
  });
});

// The port never clamps retryAfterS: any finite value >= 0 can arrive, and a NaN or an infinity should not.
describe('useScoringLink clamps the Retry-After it is given', () => {
  const MAX = SCORING_RETRY_MAX_S;
  // [what native said, what the screen says, what the next tap is blocked for in whole seconds (0 = not blocked)]
  const ROWS: readonly (readonly [raw: number, said: number | null, blockedS: number])[] = [
    [0, null, 0], // "retry now": no number to say, nothing to wait for
    [-5, null, 0],
    [0.2, 1, 1], // a fraction of a second is a whole one
    [30, 30, 30],
    [29.2, 30, 30],
    [MAX, MAX, MAX],
    [MAX + 1, MAX, MAX],
    [86_400, MAX, MAX], // a day is not a wait anybody honours
    [Number.POSITIVE_INFINITY, null, 0],
    [Number.NaN, null, 0],
  ];

  it('the cap is 300 s, the widest number the copy budget is written for', () => {
    expect(SCORING_RETRY_MAX_S).toBe(300);
  });

  let rowsRun = 0;
  it('says and blocks only a sane wait, over every row', async () => {
    for (const [raw, said, blockedS] of ROWS) {
      const { fakes, view, tap } = setup();
      const t0 = fakes.ports.clock().getTime();
      fakes.scoringLink.answerWith(refused('rate_limited', raw));
      await tap();
      expect(view(), `raw ${raw}`).toEqual({
        kind: 'refused',
        word: 'rate_limited',
        retryAfterS: said,
      });
      act(() => vi.advanceTimersByTime(SCORING_SHOW_MS));
      // Just inside the wait the next tap asks nothing; at its end it asks.
      if (blockedS > 0) {
        fakes.setNow(new Date(t0 + blockedS * 1000 - 1));
        await tap();
        expect(fakes.scoringLink.calls, `raw ${raw} inside`).toBe(1);
        act(() => vi.advanceTimersByTime(SCORING_SHOW_MS));
      }
      fakes.setNow(new Date(t0 + blockedS * 1000));
      await tap();
      expect(fakes.scoringLink.calls, `raw ${raw} at the end`).toBe(2);
      rowsRun += 1;
    }
    expect(rowsRun).toBe(ROWS.length);
    expect(ROWS).toHaveLength(10);
  });
});
