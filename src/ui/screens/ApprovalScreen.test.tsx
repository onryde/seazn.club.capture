import { act, fireEvent, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ApprovalReview } from '@/domain/matchday/approvalWire';
import type { Approval, MatchDay, MatchDayRefusal } from '@/domain/matchday/matchDay';
import { encodeSavedCode, type SavedCode } from '@/domain/mode/savedCode';
import { HOLD_MS } from '@/hooks/useHold';
import en from '@/i18n/en.json';
import es from '@/i18n/es.json';
import fr from '@/i18n/fr.json';
import nl from '@/i18n/nl.json';
import type { Lang } from '@/i18n/language';
import { FAKE_DAY, FAKE_REVIEW, FAKE_STAGE } from '@/services/fakeMatchDayPort';
import { STORE_KEYS } from '@/services/modeStore';
import { MatchDayScreen } from '@/ui/screens/MatchDayScreen';
import { createFakePorts, TEST_NOW, type FakePorts } from '../../../test/fakePorts';
import { dayLink, FIXTURE_DAY_TOKEN } from '../../../test/fixtures/dayCode';
import { pressIn, pressOut } from '../../../test/press';
import { renderWithPorts } from '../../../test/renderWithPorts';

// MD-2 Task 6: the approval review over Match Day's list (S4 design §7), on react-native-web over the fake ports.
// Copy comes from the dictionaries; the fill's colour and the touch feel are the device's.

const DICTIONARY: Readonly<Record<Lang, Record<string, string>>> = { en, es, fr, nl };
const word = (lang: Lang, key: string, vars: Record<string, string> = {}): string => {
  const text = DICTIONARY[lang][key];
  if (text === undefined) throw new Error(`no ${key} in ${lang}`);
  return Object.entries(vars).reduce((all, [k, v]) => all.replaceAll(`{${k}}`, v), text);
};
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
const SWISS: Approval = {
  kind: 'swiss',
  stageId: FAKE_STAGE,
  divisionName: "Men's singles",
  label: 'Swiss',
  round: 4,
  waiting: null,
};
const DRAW: Approval = {
  kind: 'draw',
  stageId: DRAW_STAGE,
  divisionName: "Men's singles",
  label: 'Finals',
  round: null,
  waiting: null,
};
const DRAW_REVIEW: ApprovalReview = {
  kind: 'draw',
  stageId: DRAW_STAGE,
  divisionName: "Men's singles",
  round: null,
  rows: [
    { label: 'QF 1', home: 'Ng', away: 'Brown' },
    { label: 'SF 1', home: 'Patel', away: null },
  ],
  hash: 'fake-draw-hash-0002',
  ties: false,
};
const ok = <T,>(value: T) => ({ ok: true, value }) as const;
const refused = (refusal: MatchDayRefusal) => ({ ok: false, refusal }) as const;
const OFFLINE = { ok: false, offline: true } as const;
const APPROVED = ok({ ok: true } as const);
const dayWith = (approvals: readonly Approval[], canApprove = true): MatchDay => ({
  ...FAKE_DAY,
  canApprove,
  approvals,
});

type Open = {
  readonly approval?: Approval;
  readonly review?: ApprovalReview;
  readonly lang?: Lang;
  readonly prepare?: (fakes: FakePorts) => void;
  /** Pend the review's read from the press on Review (the day is read first, before it). */
  readonly holdReview?: boolean;
};

/** The list as Home's tile opens it, with the approval waiting, and the banner's Review pressed. */
async function openReview(open: Open = {}) {
  const approval = open.approval ?? SWISS;
  const view = renderWithPorts(<MatchDayScreen />, {
    kvSeed: {
      [STORE_KEYS.code('matchday')]: encodeSavedCode(SAVED_DAY),
      [STORE_KEYS.active]: 'matchday',
    },
    deviceLanguages: [open.lang ?? 'en'],
    // A clock that moves with the fake timers, for the 250 ms after the review closes.
    clock: () => new Date(),
  });
  view.matchDay.answerDay({ ok: true, value: dayWith([approval]) });
  view.matchDay.answerReview(
    ok(open.review ?? (approval.kind === 'swiss' ? FAKE_REVIEW : DRAW_REVIEW)),
  );
  view.matchDay.answerApprove(APPROVED);
  open.prepare?.(view);
  act(() => view.navigation.go('matchday'));
  await act(() => view.ports.modeStore.load());
  await settle();
  if (open.holdReview === true) view.matchDay.hold();
  fireEvent.click(
    screen.getByRole('button', { name: word(open.lang ?? 'en', 'matchday.approve.review') }),
  );
  await settle();
  return view;
}

const settle = (ms = 0) => act(() => vi.advanceTimersByTimeAsync(ms));
const calls = (view: FakePorts, op: 'review' | 'approve' | 'day' | 'open') =>
  view.matchDay.calls.filter((call) => call.op === op);
const holdButton = (lang: Lang = 'en') =>
  screen.getByRole('button', {
    name: word(lang, 'stream.action.holdLabel', { label: word(lang, 'matchday.approve.action') }),
  });
const review = () => within(screen.getByTestId('approval-screen'));

beforeEach(() => vi.useFakeTimers({ now: TEST_NOW }));
afterEach(() => vi.useRealTimers());

describe('ApprovalScreen: the review', () => {
  it('lists the rows as the server sent them, and says where a slot is changed', async () => {
    await openReview();
    expect(review().getByText("Men's singles · Round 4")).toBeTruthy();
    expect(review().getByText('Ng v Brown')).toBeTruthy();
    expect(review().getByText('Patel v Okafor')).toBeTruthy();
    expect(review().getByText('R4 1')).toBeTruthy();
    expect(review().getByText('Kim v Bye')).toBeTruthy();
    expect(review().getByText('To change a slot, use the web desk')).toBeTruthy();
  });

  it('a draw says Knockout draw, and an open seat is To be decided, never TBD', async () => {
    await openReview({ approval: DRAW });
    expect(review().getByText("Men's singles · Knockout draw")).toBeTruthy();
    expect(review().getByText('Patel v To be decided')).toBeTruthy();
    expect(screen.queryByText(/TBD/)).toBeNull();
  });

  it('reads the review once, from the screen opening, and never again', async () => {
    const view = await openReview();
    await settle(60_000);
    expect(calls(view, 'review')).toHaveLength(1);
  });

  it('covers the list for a screen reader, and Back gives the list back', async () => {
    const view = await openReview();
    expect(screen.getByTestId('approval-screen').getAttribute('aria-modal')).toBe('true');
    let handled = false;
    act(() => {
      handled = view.back.press();
    });
    expect(handled).toBe(true);
    expect(screen.queryByTestId('approval-screen')).toBeNull();
    expect(view.navigation.current()).toBe('matchday');
    expect(screen.getByTestId('matchday-screen')).toBeTruthy();
  });

  it('hides the list beneath from a screen reader while it is open', async () => {
    await openReview();
    expect(screen.queryByRole('button', { name: en['matchday.approve.review'] })).toBeNull();
    expect(screen.queryByRole('button', { name: en['stream.home'] })).toBeNull();
    fireEvent.click(review().getByRole('button', { name: en['mode.matchday'] }));
    expect(screen.getByRole('button', { name: en['matchday.approve.review'] })).toBeTruthy();
  });

  it('the header’s Back closes it too, back to the list', async () => {
    await openReview();
    fireEvent.click(review().getByRole('button', { name: en['mode.matchday'] }));
    expect(screen.queryByTestId('approval-screen')).toBeNull();
  });

  it('loading says so while the review is out', async () => {
    await openReview({ holdReview: true });
    expect(review().getByText(en['matchday.approve.loading'])).toBeTruthy();
    expect(review().queryByRole('button', { name: /Press and hold/ })).toBeNull();
  });

  it('offline: the line and Review again, one more read; no hold until it recovers', async () => {
    const view = await openReview({ prepare: (fakes) => fakes.matchDay.answerReview(OFFLINE) });
    await settle(1000);
    expect(review().getByText(en['matchday.offlineEmpty'])).toBeTruthy();
    expect(review().queryByRole('button', { name: /Press and hold/ })).toBeNull();
    view.matchDay.answerReview(ok(FAKE_REVIEW));
    fireEvent.click(review().getByRole('button', { name: en['matchday.approve.reviewAgain'] }));
    await settle();
    expect(calls(view, 'review')).toHaveLength(3);
    expect(holdButton()).toBeTruthy();
  });

  it('ties: no hold, "Ties need a decision on the web desk"', async () => {
    await openReview({ approval: DRAW, review: { ...DRAW_REVIEW, ties: true } });
    expect(review().getByText(en['matchday.approve.ties'])).toBeTruthy();
    expect(review().queryByRole('button', { name: /Press and hold/ })).toBeNull();
    expect(review().getByText('Ng v Brown')).toBeTruthy();
  });

  it('a Swiss review with round null: "{label} · pair on the web desk", no hold (ruling 1)', async () => {
    await openReview({ review: { ...FAKE_REVIEW, round: null } });
    expect(review().getByText('Swiss · pair on the web desk')).toBeTruthy();
    expect(review().queryByRole('button', { name: /Press and hold/ })).toBeNull();
  });
});

describe('ApprovalScreen: the 3 s hold', () => {
  it('shows the plate "Hold 3 s" and says Approve to a screen reader', async () => {
    await openReview();
    expect(within(holdButton()).getByText('Hold 3 s')).toBeTruthy();
    expect(holdButton().getAttribute('aria-label')).toBe('Approve. Press and hold for 3 seconds.');
    expect(HOLD_MS).toBe(3000);
  });

  it('a release at 2.9 s approves nothing; a hold of 3 s approves once', async () => {
    const view = await openReview();
    pressIn(holdButton());
    await settle(HOLD_MS - 100);
    pressOut(holdButton());
    await settle(HOLD_MS);
    expect(calls(view, 'approve')).toEqual([]);
    pressIn(holdButton());
    await settle(HOLD_MS);
    expect(calls(view, 'approve')).toHaveLength(1);
    expect(calls(view, 'approve')[0]).toMatchObject({
      kind: 'swiss',
      stageId: FAKE_STAGE,
      round: 4,
    });
  });

  it('approved: the review closes, the list reads the day again at once, and the line is recorded', async () => {
    const view = await openReview();
    const before = calls(view, 'day').length;
    pressIn(holdButton());
    await settle(HOLD_MS);
    expect(screen.queryByTestId('approval-screen')).toBeNull();
    expect(calls(view, 'day').length).toBe(before + 1);
  });

  it('a second hold while the approve is out does nothing', async () => {
    const view = await openReview();
    view.matchDay.hold();
    pressIn(holdButton());
    await settle(HOLD_MS);
    expect(holdButton().getAttribute('aria-disabled')).toBe('true');
    expect(review().getByText(en['matchday.approve.approving'])).toBeTruthy();
    pressOut(holdButton());
    pressIn(holdButton());
    await settle(HOLD_MS);
    view.matchDay.release();
    await settle();
    expect(calls(view, 'approve')).toHaveLength(1);
  });

  it('the app leaving the foreground mid-hold abandons it: nothing is approved on the return', async () => {
    const view = await openReview();
    pressIn(holdButton());
    await settle(1500);
    act(() => view.foreground.leave());
    await settle(HOLD_MS * 2);
    act(() => view.foreground.fire());
    await settle(HOLD_MS);
    expect(calls(view, 'approve')).toEqual([]);
  });

  it('killed with the approve in flight: it is still recorded when the answer comes', async () => {
    const view = await openReview();
    view.matchDay.hold();
    pressIn(holdButton());
    await settle(HOLD_MS);
    view.unmount();
    view.matchDay.release();
    await settle();
    expect(view.record.lines().some((line) => line.includes('matchday.approve'))).toBe(true);
  });
});

describe('ApprovalScreen: what the server says to an approve', () => {
  const hold = async (view: FakePorts) => {
    const button = holdButton();
    pressIn(button);
    await settle(HOLD_MS);
    pressOut(button);
    return view;
  };

  it('MD_ALREADY: "Already approved", and the list refreshes', async () => {
    const view = await openReview({
      prepare: (fakes) => fakes.matchDay.answerApprove(refused('MD_ALREADY')),
    });
    const before = calls(view, 'day').length;
    await hold(view);
    expect(review().getByText('Already approved')).toBeTruthy();
    expect(review().queryByRole('button', { name: /Press and hold/ })).toBeNull();
    expect(calls(view, 'day').length).toBe(before + 1);
  });

  it('MD_STALE on a Swiss round: "Pairings changed — review again", the review is read again, and the hold is back', async () => {
    const view = await openReview({
      prepare: (fakes) => fakes.matchDay.answerApprove(refused('MD_STALE')),
    });
    await hold(view);
    await settle();
    expect(review().getByText('Pairings changed — review again')).toBeTruthy();
    expect(calls(view, 'review')).toHaveLength(2);
    expect(holdButton()).toBeTruthy();
  });

  it('a second MD_STALE: "Approve it on the web desk", no loop', async () => {
    const view = await openReview({
      prepare: (fakes) => fakes.matchDay.answerApprove(refused('MD_STALE')),
    });
    await hold(view);
    await settle();
    await hold(view);
    await settle();
    expect(review().getByText('Approve it on the web desk')).toBeTruthy();
    expect(review().queryByRole('button', { name: /Press and hold/ })).toBeNull();
    expect(calls(view, 'review')).toHaveLength(2);
  });

  it('MD_TIES: the ties line, no hold', async () => {
    const view = await openReview({
      prepare: (fakes) => fakes.matchDay.answerApprove(refused('MD_TIES')),
    });
    await hold(view);
    expect(review().getAllByText(en['matchday.approve.ties']).length).toBeGreaterThan(0);
    expect(review().queryByRole('button', { name: /Press and hold/ })).toBeNull();
  });

  it('offline: the day is read again; still waiting, the hold is back with the Offline line', async () => {
    const view = await openReview({
      prepare: (fakes) => fakes.matchDay.answerApprove(OFFLINE),
    });
    await hold(view);
    await settle();
    expect(review().getByTestId('approval-line').textContent).toBe(en['matchday.offlineEmpty']);
    expect(holdButton().getAttribute('aria-disabled')).not.toBe('true');
  });
});

describe('ApprovalScreen: a draw says Draw changed', () => {
  it('MD_STALE on a draw is the spec’s verbatim line', async () => {
    const view = await openReview({
      approval: DRAW,
      prepare: (fakes) => fakes.matchDay.answerApprove(refused('MD_STALE')),
    });
    const button = holdButton();
    pressIn(button);
    await settle(HOLD_MS);
    pressOut(button);
    await settle();
    expect(review().getByText('Draw changed — review again')).toBeTruthy();
    expect(calls(view, 'review')).toHaveLength(2);
  });
});

describe('ApprovalScreen: Back mid-approve, then Review again (fix round 1, M2)', () => {
  it('the second approve answered MD_ALREADY reads Approved, not Already approved', async () => {
    const view = await openReview({
      prepare: (fakes) => fakes.matchDay.answerApprove(APPROVED, refused('MD_ALREADY')),
    });
    view.matchDay.hold();
    const button = holdButton();
    pressIn(button);
    await settle(HOLD_MS);
    pressOut(button);
    fireEvent.click(review().getByRole('button', { name: en['mode.matchday'] }));
    view.matchDay.release();
    await settle(300);
    fireEvent.click(screen.getByRole('button', { name: en['matchday.approve.review'] }));
    await settle();
    const again = holdButton();
    pressIn(again);
    await settle(HOLD_MS);
    pressOut(again);
    expect(review().getByText('Approved')).toBeTruthy();
    expect(screen.queryByText('Already approved')).toBeNull();
    expect(calls(view, 'approve')).toHaveLength(2);
  });
});

describe('ApprovalScreen: the list beneath (a touch within 250 ms of closing)', () => {
  const pressNow = () =>
    fireEvent.click(screen.getByRole('button', { name: /^R2, Now, Ng v Brown/ }));
  const close = () => fireEvent.click(review().getByRole('button', { name: en['mode.matchday'] }));

  it('a touch that lands within 250 ms of the review closing opens no match', async () => {
    const view = await openReview();
    close();
    await settle(100);
    pressNow();
    await settle();
    expect(calls(view, 'open')).toEqual([]);
  });

  it('a touch 250 ms after it does open the match', async () => {
    const view = await openReview();
    close();
    await settle(250);
    pressNow();
    await settle();
    expect(calls(view, 'open')).toHaveLength(1);
  });

  it('a double tap on the overlay’s Back does not go Home through the list’s Back', async () => {
    const view = await openReview();
    close();
    await settle(80);
    fireEvent.click(screen.getByRole('button', { name: en['stream.home'] }));
    await settle();
    expect(view.navigation.current()).toBe('matchday');
    await settle(250);
    fireEvent.click(screen.getByRole('button', { name: en['stream.home'] }));
    await settle();
    expect(view.navigation.current()).toBe('home');
  });

  it('nor does it open the review again within 250 ms', async () => {
    await openReview();
    close();
    await settle(100);
    fireEvent.click(screen.getByRole('button', { name: en['matchday.approve.review'] }));
    expect(screen.queryByTestId('approval-screen')).toBeNull();
    await settle(250);
    fireEvent.click(screen.getByRole('button', { name: en['matchday.approve.review'] }));
    expect(screen.queryByTestId('approval-screen')).not.toBeNull();
  });
});

describe('ApprovalScreen: the four languages', () => {
  it.each(['en', 'es', 'fr', 'nl'] as const)(
    '%s: heading, rows, the hint and the plate',
    async (lang) => {
      await openReview({ lang });
      const heading = word(lang, 'matchday.approve.heading.swiss', {
        division: "Men's singles",
        round: '4',
      });
      expect(review().getByText(heading)).toBeTruthy();
      expect(review().getByText(word(lang, 'matchday.approve.change'))).toBeTruthy();
      expect(
        review().getByText(
          word(lang, 'matchday.row.match', {
            home: 'Kim',
            away: word(lang, 'matchday.approve.bye'),
          }),
        ),
      ).toBeTruthy();
      expect(within(holdButton(lang)).getByText(word(lang, 'matchday.approve.hold'))).toBeTruthy();
    },
  );

  it.each(['es', 'fr', 'nl'] as const)('%s: the stale and web-desk lines', async (lang) => {
    const view = await openReview({
      lang,
      prepare: (fakes) => fakes.matchDay.answerApprove(refused('MD_STALE')),
    });
    const first = holdButton(lang);
    pressIn(first);
    await settle(HOLD_MS);
    pressOut(first);
    await settle();
    expect(review().getByText(word(lang, 'matchday.approve.staleSwiss'))).toBeTruthy();
    pressIn(holdButton(lang));
    await settle(HOLD_MS);
    await settle();
    expect(review().getByText(word(lang, 'matchday.approve.onWeb'))).toBeTruthy();
    expect(calls(view, 'approve')).toHaveLength(2);
  });
});
