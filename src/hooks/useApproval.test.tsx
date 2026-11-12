import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ApprovalReview } from '@/domain/matchday/approvalWire';
import type { Approval, MatchDay, MatchDayRefusal } from '@/domain/matchday/matchDay';
import { encodeSavedCode, type SavedCode } from '@/domain/mode/savedCode';
import { REVIEW_RETRY_MS, useApproval, type ApprovalSink } from '@/hooks/useApproval';
import { FAKE_DAY, FAKE_HASH, FAKE_REVIEW, FAKE_STAGE } from '@/services/fakeMatchDayPort';
import { STORE_KEYS } from '@/services/modeStore';
import { createFakePorts, readRecord, TEST_NOW, type FakePorts } from '../../test/fakePorts';
import { dayLink, FIXTURE_DAY_TOKEN } from '../../test/fixtures/dayCode';
import { wrapperFor } from '../../test/renderWithPorts';

// MD-2 Task 6: the approval's hook (S4 design §7) over the fake Match Day port: one GET of the review as it opens and
// one on Review again (never a poll: it writes and is budgeted 1/s per code), an offline review asked once more after
// 1 s, the approve's every answer, and the record's one line per approval.

const SAVED_DAY: SavedCode = {
  mode: 'matchday',
  raw: dayLink(),
  slot: null,
  savedAt: TEST_NOW,
  expiresAt: null,
  stream: null,
  scoring: null,
};
const DRAW_STAGE = '3b8c9d0e-1f2a-4b3c-bd4e-6f7a8b9c0d1e';
const DRAW: ApprovalReview = {
  ...FAKE_REVIEW,
  kind: 'draw',
  stageId: DRAW_STAGE,
  round: null,
  hash: 'fake-draw-hash-0002',
};
const FRESH: ApprovalReview = { ...FAKE_REVIEW, hash: 'fake-proposal-hash-0002' };
const ok = <T,>(value: T) => ({ ok: true, value }) as const;
const refused = (refusal: MatchDayRefusal) => ({ ok: false, refusal }) as const;
const OFFLINE = { ok: false, offline: true } as const;
const GONE = { ok: false, gone: true } as const;
const APPROVED = ok({ ok: true } as const);
const waiting = (stage: string, kind: Approval['kind'] = 'swiss'): Approval => ({
  kind,
  stageId: stage,
  divisionName: "Men's singles",
  label: 'Swiss',
  round: kind === 'swiss' ? 4 : null,
});
const dayWaiting = (approvals: readonly Approval[]): MatchDay => ({
  ...FAKE_DAY,
  canApprove: true,
  approvals,
});

type Setup = {
  readonly kind?: 'swiss' | 'draw';
  readonly saved?: SavedCode | null;
  readonly prepare?: (fakes: FakePorts) => void;
  /** The list's `sent` set, to share it between two screens of one list. */
  readonly sent?: Set<string>;
  readonly refresh?: () => void;
};

/** The hook on the fake ports with the day code saved and active: the screen has just opened. */
async function mount(setup: Setup = {}) {
  const kind = setup.kind ?? 'swiss';
  const saved = setup.saved === undefined ? SAVED_DAY : setup.saved;
  const fakes = createFakePorts({
    kvSeed: {
      ...(saved === null ? {} : { [STORE_KEYS.code('matchday')]: encodeSavedCode(saved) }),
      [STORE_KEYS.active]: 'matchday',
    },
  });
  await fakes.ports.modeStore.load();
  fakes.navigation.go('matchday');
  fakes.matchDay.answerReview(ok(kind === 'swiss' ? FAKE_REVIEW : DRAW));
  fakes.matchDay.answerApprove(APPROVED);
  fakes.matchDay.answerDay({ ok: true, value: dayWaiting([waiting(FAKE_STAGE, kind)]) });
  setup.prepare?.(fakes);
  const sink: ApprovalSink = {
    refresh: setup.refresh ?? vi.fn(),
    close: vi.fn(),
    sent: setup.sent ?? new Set(),
  };
  const stage = kind === 'swiss' ? FAKE_STAGE : DRAW_STAGE;
  const view = renderHook(() => useApproval(kind, stage, sink), { wrapper: wrapperFor(fakes) });
  await settle();
  return { ...fakes, ...view, sink, stage };
}

const settle = (ms = 0) => act(() => vi.advanceTimersByTimeAsync(ms));
const callsOf = (fakes: FakePorts, op: 'review' | 'approve' | 'day') =>
  fakes.matchDay.calls.filter((call) => call.op === op);
const heldNow = (fakes: FakePorts) => {
  const snapshot = fakes.ports.modeStore.getSnapshot();
  return snapshot.status === 'ready' ? (snapshot.saved.codes.matchday ?? null) : null;
};

beforeEach(() => vi.useFakeTimers({ now: TEST_NOW }));
afterEach(() => vi.useRealTimers());

describe('useApproval: the review', () => {
  it('reads the review once as the screen opens, with the kind and the stage, and offers the hold', async () => {
    const view = await mount();
    expect(callsOf(view, 'review')).toEqual([
      expect.objectContaining({ op: 'review', kind: 'swiss', stageId: FAKE_STAGE }),
    ]);
    expect(view.result.current.state).toBe('ready');
    expect(view.result.current.review).toEqual(FAKE_REVIEW);
    expect(view.result.current.refusal).toBeNull();
    expect(view.result.current.holdable).toBe(true);
  });

  it('never polls: a minute later it is still the one read (ruling 3)', async () => {
    const view = await mount();
    await settle(60_000);
    expect(callsOf(view, 'review')).toHaveLength(1);
    expect(callsOf(view, 'day')).toHaveLength(0);
  });

  it('a review that answers offline is asked once more after 1 s, and shows the second answer', async () => {
    const view = await mount({
      prepare: (fakes) => fakes.matchDay.answerReview(OFFLINE, ok(FAKE_REVIEW)),
    });
    expect(callsOf(view, 'review')).toHaveLength(1);
    await settle(REVIEW_RETRY_MS - 1);
    expect(callsOf(view, 'review')).toHaveLength(1);
    await settle(1);
    expect(callsOf(view, 'review')).toHaveLength(2);
    expect(view.result.current.state).toBe('ready');
  });

  it('offline twice is offline: two reads, no hold, and nothing asks again by itself', async () => {
    const view = await mount({ prepare: (fakes) => fakes.matchDay.answerReview(OFFLINE) });
    await settle(REVIEW_RETRY_MS);
    expect(view.result.current.state).toBe('offline');
    expect(view.result.current.holdable).toBe(false);
    await settle(60_000);
    expect(callsOf(view, 'review')).toHaveLength(2);
  });

  it('Review again is one more read (itself retried once), and recovers', async () => {
    const view = await mount({ prepare: (fakes) => fakes.matchDay.answerReview(OFFLINE) });
    await settle(REVIEW_RETRY_MS);
    view.matchDay.answerReview(ok(FAKE_REVIEW));
    act(() => view.result.current.reviewAgain());
    await settle();
    expect(callsOf(view, 'review')).toHaveLength(3);
    expect(view.result.current.state).toBe('ready');
  });

  it('a second Review again while a read is out reads once (a second call)', async () => {
    const view = await mount({ prepare: (fakes) => fakes.matchDay.answerReview(OFFLINE) });
    await settle(REVIEW_RETRY_MS);
    view.matchDay.answerReview(ok(FAKE_REVIEW));
    view.matchDay.hold();
    act(() => view.result.current.reviewAgain());
    act(() => view.result.current.reviewAgain());
    view.matchDay.release();
    await settle();
    expect(callsOf(view, 'review')).toHaveLength(3);
  });

  it('a port that throws is offline, then asked again once', async () => {
    const view = await mount({ prepare: (fakes) => fakes.matchDay.throwNext() });
    await settle(REVIEW_RETRY_MS);
    expect(view.result.current.state).toBe('ready');
    expect(callsOf(view, 'review')).toHaveLength(2);
    expect(readRecord(view.record).map((line) => line.event)).toContain('matchday.review-threw');
  });

  it('with no day code saved nothing is asked', async () => {
    const view = await mount({ saved: null });
    expect(callsOf(view, 'review')).toEqual([]);
    expect(view.result.current.state).toBe('offline');
  });

  it('unmounted during the 1 s wait, the second read is never made', async () => {
    const view = await mount({ prepare: (fakes) => fakes.matchDay.answerReview(OFFLINE) });
    view.unmount();
    await settle(REVIEW_RETRY_MS * 2);
    expect(callsOf(view, 'review')).toHaveLength(1);
  });

  it('a Swiss review with no round, and a review with ties, are never offered the hold (ruling 1)', async () => {
    const noRound = await mount({
      prepare: (fakes) => fakes.matchDay.answerReview(ok({ ...FAKE_REVIEW, round: null })),
    });
    expect(noRound.result.current.state).toBe('ready');
    expect(noRound.result.current.holdable).toBe(false);
    act(() => noRound.result.current.approve());
    await settle();
    expect(callsOf(noRound, 'approve')).toEqual([]);
    const ties = await mount({
      kind: 'draw',
      prepare: (fakes) => fakes.matchDay.answerReview(ok({ ...DRAW, ties: true })),
    });
    expect(ties.result.current.holdable).toBe(false);
    act(() => ties.result.current.approve());
    await settle();
    expect(callsOf(ties, 'approve')).toEqual([]);
  });

  it.each([
    ['MD_ALREADY', 'already'],
    ['MD_TIES', 'ties'],
    ['MD_NO_APPROVE', 'onWeb'],
    ['MD_OUT_OF_SCOPE', 'onWeb'],
    ['MD_STALE', 'onWeb'],
  ] as const)('a review refused %s says %s and offers no hold', async (word, refusal) => {
    const view = await mount({ prepare: (fakes) => fakes.matchDay.answerReview(refused(word)) });
    expect(view.result.current.state).toBe('refused');
    expect(view.result.current.refusal).toBe(refusal);
    expect(view.result.current.holdable).toBe(false);
    expect(callsOf(view, 'review')).toHaveLength(1);
  });

  it('a stage that is gone says the web desk', async () => {
    const view = await mount({ prepare: (fakes) => fakes.matchDay.answerReview(GONE) });
    expect(view.result.current.refusal).toBe('onWeb');
  });

  it.each(['MD_ENDED', 'MD_WITHDRAWN', 'MD_UNKNOWN'] as const)(
    'a review refused %s forgets the code, as the day read does, and goes Home',
    async (word) => {
      const view = await mount({ prepare: (fakes) => fakes.matchDay.answerReview(refused(word)) });
      await settle();
      expect(heldNow(view)).toBeNull();
      expect(view.navigation.current()).toBe('home');
      expect(view.result.current.state).toBe('refused');
      expect(view.result.current.holdable).toBe(false);
    },
  );

  it('a review refused MD_NOT_OPEN keeps the code and goes Home', async () => {
    const view = await mount({
      prepare: (fakes) => fakes.matchDay.answerReview(refused('MD_NOT_OPEN')),
    });
    await settle();
    expect(heldNow(view)).not.toBeNull();
    expect(view.navigation.current()).toBe('home');
  });
});

describe('useApproval: the approve', () => {
  it('approves once, handing back the review’s own hash and round, then reads the day and closes', async () => {
    const view = await mount();
    act(() => view.result.current.approve());
    await settle();
    expect(callsOf(view, 'approve')).toEqual([
      expect.objectContaining({
        kind: 'swiss',
        stageId: FAKE_STAGE,
        hash: FAKE_HASH,
        round: 4,
      }),
    ]);
    expect(view.result.current.state).toBe('done');
    expect(view.sink.refresh).toHaveBeenCalledTimes(1);
    expect(view.sink.close).toHaveBeenCalledTimes(1);
  });

  it('a draw hands back a null round', async () => {
    const view = await mount({ kind: 'draw' });
    act(() => view.result.current.approve());
    await settle();
    expect(callsOf(view, 'approve')).toEqual([
      expect.objectContaining({
        kind: 'draw',
        stageId: DRAW_STAGE,
        hash: 'fake-draw-hash-0002',
        round: null,
      }),
    ]);
  });

  it('a draw review that carries a round still approves with null (round is a Swiss field)', async () => {
    const view = await mount({
      kind: 'draw',
      prepare: (fakes) => fakes.matchDay.answerReview(ok({ ...DRAW, round: 3 })),
    });
    act(() => view.result.current.approve());
    await settle();
    expect(callsOf(view, 'approve')[0]?.round).toBeNull();
  });

  it('a second approve while one is out does nothing (a second call)', async () => {
    const view = await mount();
    view.matchDay.hold();
    act(() => view.result.current.approve());
    expect(view.result.current.state).toBe('approving');
    act(() => view.result.current.approve());
    act(() => view.result.current.approve());
    view.matchDay.release();
    await settle();
    expect(callsOf(view, 'approve')).toHaveLength(1);
  });

  it('two approves in one breath (before a render) make one request', async () => {
    const view = await mount();
    act(() => {
      view.result.current.approve();
      view.result.current.approve();
    });
    await settle();
    expect(callsOf(view, 'approve')).toHaveLength(1);
  });

  it('an approve while the review is offline (the day could not be read) does nothing', async () => {
    const view = await mount({ prepare: (fakes) => fakes.matchDay.answerApprove(OFFLINE) });
    view.matchDay.answerDay(OFFLINE);
    act(() => view.result.current.approve());
    await settle();
    expect(view.result.current.state).toBe('offline');
    act(() => view.result.current.approve());
    await settle();
    expect(callsOf(view, 'approve')).toHaveLength(1);
  });

  it('the code forgotten between the review and the hold: nothing is sent and the screen says offline', async () => {
    const view = await mount();
    await act(async () => {
      const saved = heldNow(view);
      if (saved !== null) await view.ports.modeStore.forget(saved);
    });
    act(() => view.result.current.approve());
    await settle();
    expect(callsOf(view, 'approve')).toEqual([]);
    expect(view.result.current.state).toBe('offline');
  });

  it('an approve before the review has landed does nothing (an empty input)', async () => {
    const view = await mount({ prepare: (fakes) => fakes.matchDay.hold() });
    act(() => view.result.current.approve());
    expect(callsOf(view, 'approve')).toEqual([]);
  });

  it('after the approval is done, a stray approve does nothing more', async () => {
    const view = await mount();
    act(() => view.result.current.approve());
    await settle();
    act(() => view.result.current.approve());
    await settle();
    expect(callsOf(view, 'approve')).toHaveLength(1);
  });

  it('MD_ALREADY says Already approved, refreshes the list, and reads nothing more', async () => {
    const view = await mount({
      prepare: (fakes) => fakes.matchDay.answerApprove(refused('MD_ALREADY')),
    });
    act(() => view.result.current.approve());
    await settle();
    expect(view.result.current.state).toBe('refused');
    expect(view.result.current.refusal).toBe('already');
    expect(view.sink.refresh).toHaveBeenCalledTimes(1);
    expect(view.sink.close).not.toHaveBeenCalled();
    expect(callsOf(view, 'review')).toHaveLength(1);
  });

  it('MD_STALE says the draw changed and reads the review once more, then the hold is offered on the fresh hash (ruling 4)', async () => {
    const view = await mount({
      prepare: (fakes) => {
        fakes.matchDay.answerApprove(refused('MD_STALE'));
      },
    });
    view.matchDay.answerReview(ok(FRESH));
    act(() => view.result.current.approve());
    await settle();
    expect(callsOf(view, 'review')).toHaveLength(2);
    expect(view.result.current.state).toBe('ready');
    expect(view.result.current.refusal).toBe('stale');
    expect(view.result.current.review).toEqual(FRESH);
    view.matchDay.answerApprove(APPROVED);
    act(() => view.result.current.approve());
    await settle();
    expect(callsOf(view, 'approve')[1]?.hash).toBe('fake-proposal-hash-0002');
    expect(view.result.current.state).toBe('done');
  });

  it('a second MD_STALE right after the fresh review says the web desk, with no third read (ruling 4)', async () => {
    const view = await mount({
      prepare: (fakes) => fakes.matchDay.answerApprove(refused('MD_STALE')),
    });
    view.matchDay.answerReview(ok(FRESH));
    act(() => view.result.current.approve());
    await settle();
    act(() => view.result.current.approve());
    await settle();
    expect(view.result.current.state).toBe('refused');
    expect(view.result.current.refusal).toBe('onWeb');
    expect(view.result.current.holdable).toBe(false);
    expect(callsOf(view, 'review')).toHaveLength(2);
    expect(callsOf(view, 'approve')).toHaveLength(2);
  });

  it('MD_TIES shows the ties line, keeps the rows, and offers no hold', async () => {
    const view = await mount({
      prepare: (fakes) => fakes.matchDay.answerApprove(refused('MD_TIES')),
    });
    act(() => view.result.current.approve());
    await settle();
    expect(view.result.current.refusal).toBe('ties');
    expect(view.result.current.review).toEqual(FAKE_REVIEW);
    expect(view.result.current.holdable).toBe(false);
  });

  it.each(['MD_NO_APPROVE', 'MD_OUT_OF_SCOPE'] as const)(
    '%s says the web desk and refreshes',
    async (word) => {
      const view = await mount({ prepare: (fakes) => fakes.matchDay.answerApprove(refused(word)) });
      act(() => view.result.current.approve());
      await settle();
      expect(view.result.current.refusal).toBe('onWeb');
      expect(view.sink.refresh).toHaveBeenCalledTimes(1);
    },
  );

  it.each(['MD_ENDED', 'MD_WITHDRAWN', 'MD_UNKNOWN'] as const)(
    'an approve refused %s forgets the code and goes Home (ruling 7)',
    async (word) => {
      const view = await mount({ prepare: (fakes) => fakes.matchDay.answerApprove(refused(word)) });
      act(() => view.result.current.approve());
      await settle();
      expect(heldNow(view)).toBeNull();
      expect(view.navigation.current()).toBe('home');
      expect(view.sink.close).not.toHaveBeenCalled();
    },
  );
});

describe('useApproval: a throw nobody expected (fix round 1, M1)', () => {
  const warns = (fakes: FakePorts) => readRecord(fakes.record).map((line) => line.event);

  it('a refresh that throws leaves Approving: offline with the review, logged, and Review again reads the day first', async () => {
    const refresh = vi.fn(() => {
      throw new Error('the list broke');
    });
    const view = await mount({ refresh });
    act(() => view.result.current.approve());
    await settle();
    expect(view.result.current.state).toBe('offline');
    expect(view.result.current.review).toEqual(FAKE_REVIEW);
    expect(view.result.current.holdable).toBe(false);
    expect(warns(view)).toContain('matchday.approve-failed');
    act(() => view.result.current.reviewAgain());
    await settle();
    expect(callsOf(view, 'day')).toHaveLength(1);
  });

  it('the approve flag is down again after it: a later approve is not locked out', async () => {
    let throwing = true;
    const refresh = vi.fn(() => {
      if (throwing) throw new Error('the list broke');
    });
    const view = await mount({ refresh });
    act(() => view.result.current.approve());
    await settle();
    throwing = false;
    view.matchDay.answerDay({ ok: true, value: dayWaiting([waiting(FAKE_STAGE)]) });
    act(() => view.result.current.reviewAgain());
    await settle();
    expect(view.result.current.state).toBe('ready');
    act(() => view.result.current.approve());
    await settle();
    expect(callsOf(view, 'approve')).toHaveLength(2);
  });

  it('a read that throws as the screen opens is offline and logged, not an unhandled rejection', async () => {
    const view = await mount({
      prepare: (fakes) => {
        const real = fakes.ports.modeStore.getSnapshot.bind(fakes.ports.modeStore);
        let first = true;
        vi.spyOn(fakes.ports.modeStore, 'getSnapshot').mockImplementation(() => {
          if (first && new Error().stack?.includes('heldCode')) {
            first = false;
            throw new Error('the store broke');
          }
          return real();
        });
      },
    });
    expect(view.result.current.state).toBe('offline');
    expect(warns(view)).toContain('matchday.review-failed');
  });

  it('Review again that throws is caught too, and the next one still reads', async () => {
    const view = await mount({ prepare: (fakes) => fakes.matchDay.answerReview(OFFLINE) });
    await settle(REVIEW_RETRY_MS);
    const real = view.ports.modeStore.getSnapshot.bind(view.ports.modeStore);
    vi.spyOn(view.ports.modeStore, 'getSnapshot').mockImplementationOnce(() => {
      throw new Error('the store broke');
    });
    void real;
    act(() => view.result.current.reviewAgain());
    await settle();
    expect(warns(view)).toContain('matchday.review-failed');
    view.matchDay.answerReview(ok(FAKE_REVIEW));
    act(() => view.result.current.reviewAgain());
    await settle();
    expect(view.result.current.state).toBe('ready');
  });
});

describe('useApproval: an approve this phone sent and left (fix round 1, M2)', () => {
  it('a later MD_ALREADY for the same proposal reads own, not already', async () => {
    const sent = new Set<string>();
    const first = await mount({ sent, prepare: (fakes) => fakes.matchDay.answerApprove(OFFLINE) });
    first.matchDay.answerDay(OFFLINE);
    act(() => first.result.current.approve());
    await settle();
    first.unmount();
    const again = await mount({
      sent,
      prepare: (fakes) => fakes.matchDay.answerApprove(refused('MD_ALREADY')),
    });
    act(() => again.result.current.approve());
    await settle();
    expect(again.result.current.refusal).toBe('own');
    expect(
      readRecord(again.record).filter((line) => line.event === 'matchday.approve')[0]?.fields,
    ).toEqual({ kind: 'swiss', sid: FAKE_STAGE, result: 'own' });
  });

  it('with nothing sent before, the same answer is Already approved', async () => {
    const view = await mount({
      sent: new Set(),
      prepare: (fakes) => fakes.matchDay.answerApprove(refused('MD_ALREADY')),
    });
    act(() => view.result.current.approve());
    await settle();
    expect(view.result.current.refusal).toBe('already');
  });

  it('another proposal (a fresh hash) of the same stage is not this phone’s', async () => {
    const sent = new Set([`${FAKE_STAGE}:some-older-hash`]);
    const view = await mount({
      sent,
      prepare: (fakes) => fakes.matchDay.answerApprove(refused('MD_ALREADY')),
    });
    act(() => view.result.current.approve());
    await settle();
    expect(view.result.current.refusal).toBe('already');
  });

  it('records the approve it sends, keyed by stage and hash', async () => {
    const sent = new Set<string>();
    const view = await mount({ sent });
    act(() => view.result.current.approve());
    await settle();
    expect([...sent]).toEqual([`${FAKE_STAGE}:${FAKE_HASH}`]);
  });
});

describe('useApproval: an approve that answered offline (ruling 5)', () => {
  const offlineApprove = (fakes: FakePorts) => fakes.matchDay.answerApprove(OFFLINE);

  it('reads the day before it offers the hold again: still waiting, the hold is back with the Offline line', async () => {
    const view = await mount({ prepare: offlineApprove });
    act(() => view.result.current.approve());
    await settle();
    expect(callsOf(view, 'day')).toHaveLength(1);
    expect(view.result.current.state).toBe('ready');
    expect(view.result.current.refusal).toBe('offline');
    expect(view.result.current.holdable).toBe(true);
    expect(callsOf(view, 'review')).toHaveLength(1);
  });

  it('the approval gone from the day: it landed, so it is done, the list refreshes and the review closes', async () => {
    const view = await mount({ prepare: offlineApprove });
    view.matchDay.answerDay({ ok: true, value: dayWaiting([]) });
    act(() => view.result.current.approve());
    await settle();
    expect(view.result.current.state).toBe('done');
    expect(view.sink.refresh).toHaveBeenCalledTimes(1);
    expect(view.sink.close).toHaveBeenCalledTimes(1);
    expect(callsOf(view, 'approve')).toHaveLength(1);
  });

  it('another stage of the same kind waiting does not hide that this one has gone', async () => {
    const view = await mount({ prepare: offlineApprove });
    view.matchDay.answerDay({
      ok: true,
      value: dayWaiting([waiting('9f8e7d6c-5b4a-4938-8271-605f4e3d2c1b')]),
    });
    act(() => view.result.current.approve());
    await settle();
    expect(view.result.current.state).toBe('done');
  });

  it('the same stage id under the other kind does not count as still waiting', async () => {
    const view = await mount({ prepare: offlineApprove });
    view.matchDay.answerDay({ ok: true, value: dayWaiting([waiting(FAKE_STAGE, 'draw')]) });
    act(() => view.result.current.approve());
    await settle();
    expect(view.result.current.state).toBe('done');
  });

  it('with no day to read the hold stays away, and Review again reads the day first, then the review', async () => {
    const view = await mount({ prepare: offlineApprove });
    view.matchDay.answerDay(OFFLINE);
    act(() => view.result.current.approve());
    await settle();
    expect(view.result.current.state).toBe('offline');
    expect(view.result.current.holdable).toBe(false);
    act(() => view.result.current.reviewAgain());
    await settle();
    expect(callsOf(view, 'day')).toHaveLength(2);
    expect(callsOf(view, 'review')).toHaveLength(1);
    expect(view.result.current.state).toBe('offline');
    view.matchDay.answerDay({ ok: true, value: dayWaiting([waiting(FAKE_STAGE)]) });
    act(() => view.result.current.reviewAgain());
    await settle();
    expect(callsOf(view, 'day')).toHaveLength(3);
    expect(callsOf(view, 'review')).toHaveLength(2);
    expect(view.result.current.state).toBe('ready');
  });

  it('Review again after a recheck that found it landed is done, with no review read', async () => {
    const view = await mount({ prepare: offlineApprove });
    view.matchDay.answerDay(OFFLINE);
    act(() => view.result.current.approve());
    await settle();
    view.matchDay.answerDay({ ok: true, value: dayWaiting([]) });
    act(() => view.result.current.reviewAgain());
    await settle();
    expect(view.result.current.state).toBe('done');
    expect(callsOf(view, 'review')).toHaveLength(1);
    expect(view.sink.close).toHaveBeenCalledTimes(1);
  });

  it('a day that says the code is over forgets it, and the screen offers no hold', async () => {
    const view = await mount({ prepare: offlineApprove });
    view.matchDay.answerDay(refused('MD_ENDED'));
    act(() => view.result.current.approve());
    await settle();
    expect(heldNow(view)).toBeNull();
    expect(view.navigation.current()).toBe('home');
    expect(view.result.current.state).toBe('refused');
    expect(view.result.current.holdable).toBe(false);
  });

  it('Review again after an offline approve whose day says the code is over leaves the same way', async () => {
    const view = await mount({ prepare: offlineApprove });
    view.matchDay.answerDay(OFFLINE);
    act(() => view.result.current.approve());
    await settle();
    view.matchDay.answerDay(refused('MD_WITHDRAWN'));
    act(() => view.result.current.reviewAgain());
    await settle();
    expect(heldNow(view)).toBeNull();
    expect(view.result.current.state).toBe('refused');
    expect(callsOf(view, 'review')).toHaveLength(1);
  });

  it('once the day has been read again the recheck is over: a later Review again is one review read, no day read', async () => {
    const view = await mount({ prepare: offlineApprove });
    act(() => view.result.current.approve());
    await settle();
    expect(callsOf(view, 'day')).toHaveLength(1);
    act(() => view.result.current.reviewAgain());
    await settle();
    expect(callsOf(view, 'day')).toHaveLength(1);
    expect(callsOf(view, 'review')).toHaveLength(2);
  });

  it('and after Review again has done the recheck, the next one reads only the review', async () => {
    const view = await mount({ prepare: offlineApprove });
    view.matchDay.answerDay(OFFLINE);
    act(() => view.result.current.approve());
    await settle();
    view.matchDay.answerDay({ ok: true, value: dayWaiting([waiting(FAKE_STAGE)]) });
    act(() => view.result.current.reviewAgain());
    await settle();
    expect(callsOf(view, 'day')).toHaveLength(2);
    act(() => view.result.current.reviewAgain());
    await settle();
    expect(callsOf(view, 'day')).toHaveLength(2);
    expect(callsOf(view, 'review')).toHaveLength(3);
  });

  it('a code that ends while the approve is out is forgotten even after the review was closed', async () => {
    const view = await mount({
      prepare: (fakes) => fakes.matchDay.answerApprove(refused('MD_ENDED')),
    });
    view.matchDay.hold();
    act(() => view.result.current.approve());
    view.unmount();
    view.matchDay.release();
    await settle();
    expect(heldNow(view)).toBeNull();
  });

  it('a port that throws on the approve reads as offline, and the day is read again', async () => {
    const view = await mount();
    view.matchDay.hold();
    act(() => view.result.current.approve());
    view.matchDay.throwNext();
    view.matchDay.release();
    await settle();
    expect(callsOf(view, 'day')).toHaveLength(1);
    expect(readRecord(view.record).map((line) => line.event)).toContain('matchday.approve-threw');
  });

  it('closed while the approve is out: the answer is recorded, the list refreshes, nothing else moves', async () => {
    const view = await mount();
    view.matchDay.hold();
    act(() => view.result.current.approve());
    view.unmount();
    view.matchDay.release();
    await settle();
    expect(view.sink.refresh).toHaveBeenCalledTimes(1);
    expect(view.sink.close).not.toHaveBeenCalled();
    const lines = readRecord(view.record).filter((line) => line.event === 'matchday.approve');
    expect(lines).toHaveLength(1);
  });

  it('closed while an offline approve waits to recheck, the day is not read', async () => {
    const view = await mount({ prepare: offlineApprove });
    view.matchDay.hold();
    act(() => view.result.current.approve());
    view.unmount();
    view.matchDay.release();
    await settle();
    expect(callsOf(view, 'day')).toEqual([]);
  });
});

describe('useApproval: the session record (spec §7)', () => {
  const lineOf = (fakes: FakePorts) =>
    readRecord(fakes.record).filter((line) => line.event === 'matchday.approve');

  it.each([
    ['approved', APPROVED],
    ['MD_ALREADY', refused('MD_ALREADY')],
    ['stale', refused('MD_STALE')],
    ['MD_TIES', refused('MD_TIES')],
    ['offline', OFFLINE],
    ['gone', GONE],
  ] as const)('one line with the kind, the stage and the outcome: %s', async (outcome, answer) => {
    const view = await mount({ prepare: (fakes) => fakes.matchDay.answerApprove(answer) });
    act(() => view.result.current.approve());
    await settle();
    expect(lineOf(view).map((line) => line.fields)).toEqual([
      { kind: 'swiss', sid: FAKE_STAGE, result: outcome },
    ]);
  });

  it('never carries the token or the hash', async () => {
    const view = await mount();
    act(() => view.result.current.approve());
    await settle();
    const everything = JSON.stringify(view.record.lines());
    expect(everything).not.toContain(FIXTURE_DAY_TOKEN);
    expect(everything).not.toContain(FAKE_HASH);
  });

  it('says nothing for an approve that was never made', async () => {
    const view = await mount();
    await settle(30_000);
    expect(lineOf(view)).toEqual([]);
  });
});
