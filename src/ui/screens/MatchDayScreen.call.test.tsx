import { act, fireEvent, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CallReason, CallRefused, Candidate } from '@/domain/matchday/callWire';
import type { Court, MatchDay, Row } from '@/domain/matchday/matchDay';
import { encodeSavedCode, type SavedCode } from '@/domain/mode/savedCode';
import { HOLD_MS } from '@/hooks/useHold';
import { MATCHDAY_POLL_MS } from '@/hooks/useMatchDay';
import en from '@/i18n/en.json';
import es from '@/i18n/es.json';
import fr from '@/i18n/fr.json';
import nl from '@/i18n/nl.json';
import type { Lang } from '@/i18n/language';
import { FAKE_DAY } from '@/services/fakeMatchDayPort';
import { STORE_KEYS } from '@/services/modeStore';
import type { CallAnswer } from '@/services/matchDayPort';
import { MatchDayScreen } from '@/ui/screens/MatchDayScreen';
import { createFakePorts, readRecord, TEST_NOW, type FakePorts } from '../../../test/fakePorts';
import { dayLink, FIXTURE_DAY_TOKEN } from '../../../test/fixtures/dayCode';
import { pressIn, pressOut } from '../../../test/press';
import { renderWithPorts } from '../../../test/renderWithPorts';

// MD-2 Task 8e: calling a match to a court with a Match Day code (S4 design §7a), on react-native-web over the fake
// ports. Copy comes from the dictionaries; colour, the hold's fill and the touch feel are the device's.

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
const COURT_2 = '1f6a7b8c-9d0e-4f1a-9b2c-4d5e6f7a8b9c';
const ANN = '2c3d4e5f-6a7b-4c8d-9e0f-1a2b3c4d5e6f';
const EVE = '1b2c3d4e-5f6a-4b7c-8d9e-0f1a2b3c4d5e';
const BUSY = '3d4e5f6a-7b8c-4d9e-8f0a-2b3c4d5e6f70';

const row = (fixtureId: string, home: string, away: string, more: Partial<Row> = {}): Row => ({
  fixtureId,
  sportKey: 'badminton',
  divisionName: "Men's singles",
  roundLabel: 'R2',
  roundTag: 'R2',
  home,
  away,
  homeSlot: null,
  awaySlot: null,
  status: 'upcoming',
  scheduledAt: new Date('2026-10-03T14:20:00.000Z'),
  summary: null,
  ...more,
});
const candidate = (match: Row, more: Partial<Candidate> = {}): Candidate => ({
  match,
  source: 'thisCourt',
  fromCourtName: null,
  plannedAt: new Date('2026-10-03T14:20:00.000Z'),
  waitingMinutes: 0,
  behindMinutes: 0,
  blocked: null,
  ...more,
});
const OWN = candidate(row(ANN, 'Kim', 'Lee'));
const NO_COURT = candidate(row(EVE, 'Eve', 'Fay', { scheduledAt: null }), {
  source: 'noCourt',
  plannedAt: null,
});
const BLOCKED = candidate(row(BUSY, 'Ann Archer', 'Cat'), {
  source: 'otherCourt',
  fromCourtName: 'Court 3',
  blocked: { personName: 'Ann Archer', courtName: 'Court 3' },
});

const ok = <T,>(value: T) => ({ ok: true, value }) as const;
const OFFLINE = { ok: false, offline: true } as const;
const GONE = { ok: false, gone: true } as const;
const refused = (refused: CallRefused): CallAnswer<never> => ({ ok: false, refused });
const desk = (
  reason: CallReason,
  personName: string | null = null,
  courtName: string | null = null,
) => refused({ code: 'MD_CALL_REFUSED', reason, personName, courtName });
const candidates = (...list: Candidate[]) =>
  ok({ courtId: COURT_2, courtName: 'Court 2', candidates: list });
const QUIET = ok({ shifts: [], warnings: [] });
const CALLED = ok({ fixtureId: ANN, courtId: COURT_2, calledAt: new Date(TEST_NOW) });
const UNCALLED = ok({ fixtureId: ANN, courtId: null, scheduledAt: null });

const calling = (canCall = true): MatchDay => ({ ...FAKE_DAY, canCall });
/** Court 2 is called to Kim v Lee, who have not started. */
const called = (more: Partial<Court> = {}, canCall = true): MatchDay => ({
  ...FAKE_DAY,
  canCall,
  courts: FAKE_DAY.courts.map((c) =>
    c.courtId === COURT_2 ? { ...c, state: 'called', now: OWN.match, ...more } : c,
  ),
});

type Open = {
  readonly day?: MatchDay;
  readonly lang?: Lang;
  readonly prepare?: (fakes: FakePorts) => void;
};

/** The list as Home's tile opens it, the server's day `day`, the candidates `OWN`, `NO_COURT` and `BLOCKED`. */
async function openList(open: Open = {}) {
  const view = renderWithPorts(<MatchDayScreen />, {
    kvSeed: {
      [STORE_KEYS.code('matchday')]: encodeSavedCode(SAVED_DAY),
      [STORE_KEYS.active]: 'matchday',
    },
    deviceLanguages: [open.lang ?? 'en'],
    // A clock that moves with the fake timers, for the 250 ms after a sheet closes.
    clock: () => new Date(),
  });
  view.matchDay.answerDay({ ok: true, value: open.day ?? calling() });
  view.matchDay.answerCandidates(candidates(OWN, NO_COURT, BLOCKED));
  view.matchDay.answerPreview(QUIET);
  view.matchDay.answerCall(CALLED);
  view.matchDay.answerUndo(UNCALLED);
  open.prepare?.(view);
  act(() => view.navigation.go('matchday'));
  await act(() => view.ports.modeStore.load());
  await settle();
  return view;
}

const settle = (ms = 0) => act(() => vi.advanceTimersByTimeAsync(ms));
const calls = (view: FakePorts, op: string) => view.matchDay.calls.filter((c) => c.op === op);
const callButton = (lang: Lang = 'en') =>
  screen.getByRole('button', {
    name: word(lang, 'matchday.call.actionNamed', { court: 'Court 2' }),
  });
const sheet = () => within(screen.getByTestId('call-screen'));
const holdButton = (lang: Lang = 'en') =>
  sheet().getByRole('button', {
    name: word(lang, 'stream.action.holdLabel', { label: word(lang, 'matchday.call.action') }),
  });
/** The list's control, named with its court (final review m3); the sheet's own plain "Undo call" is `confirmUndo`. */
const undoButton = (lang: Lang = 'en') =>
  screen.getByRole('button', { name: word(lang, 'matchday.call.undoNamed', { court: 'Court 2' }) });

async function openSheet(open: Open = {}) {
  const view = await openList(open);
  fireEvent.click(callButton(open.lang));
  await settle();
  return view;
}

async function pickKim(lang: Lang = 'en') {
  fireEvent.click(sheet().getByRole('button', { name: new RegExp('Kim v Lee') }));
  await settle();
  return lang;
}

async function hold(ms = HOLD_MS, lang: Lang = 'en') {
  pressIn(holdButton(lang));
  await settle(ms);
}

beforeEach(() => vi.useFakeTimers({ now: TEST_NOW }));
afterEach(() => vi.useRealTimers());

describe('Call a match: who sees it, and where', () => {
  it('a free court of a code with the power offers it; the playing court does not', async () => {
    await openList();
    expect(screen.getAllByRole('button', { name: /^Call a match, / })).toHaveLength(1);
    expect(callButton()).toBeTruthy();
    const playing = within(screen.getAllByTestId('court-card')[0] as HTMLElement);
    expect(playing.queryByText(en['matchday.call.action'])).toBeNull();
  });

  it('a code without the power has no call control at all', async () => {
    await openList({ day: calling(false) });
    expect(screen.queryByText(en['matchday.call.action'])).toBeNull();
    expect(screen.queryByRole('button', { name: /^Call a match, / })).toBeNull();
  });

  it('a called court of a code without the power has no Undo call either', async () => {
    await openList({ day: called({}, false) });
    expect(screen.queryByText(en['matchday.call.undo'])).toBeNull();
  });

  it('a court called to a match already called off the list has none, nor one in use elsewhere', async () => {
    const day: MatchDay = {
      ...calling(),
      courts: FAKE_DAY.courts.map((c) =>
        c.courtId === COURT_2 ? { ...c, state: 'inUseElsewhere' as const } : c,
      ),
    };
    await openList({ day });
    expect(screen.queryByText(en['matchday.call.action'])).toBeNull();
  });
});

describe('Call to {court}: the candidates', () => {
  it('opens "Call to Court 2" and lists each match with its chip, names, time and where it is now', async () => {
    const view = await openSheet();
    expect(sheet().getByText('Call to Court 2')).toBeTruthy();
    expect(calls(view, 'candidates')).toHaveLength(1);
    expect(calls(view, 'candidates')[0]?.courtId).toBe(COURT_2);
    expect(sheet().getByText('Kim v Lee')).toBeTruthy();
    expect(sheet().getByText('Eve v Fay')).toBeTruthy();
    expect(sheet().getAllByTestId('round-chip').length).toBeGreaterThan(0);
    // 14:20Z is 15:20 in London (BST), the venue's zone.
    expect(sheet().getAllByText('15:20')).toHaveLength(2);
    expect(sheet().getByText('Next on Court 2')).toBeTruthy();
    expect(sheet().getByText('Next on Court 3')).toBeTruthy();
    expect(sheet().getByText(en['matchday.noCourt'])).toBeTruthy();
  });

  it('a blocked match is dimmed with its reason and is not a control; the others are', async () => {
    await openSheet();
    expect(sheet().getByText('Ann Archer is playing on Court 3')).toBeTruthy();
    expect(sheet().queryByRole('button', { name: /Ann Archer v Cat/ })).toBeNull();
    expect(sheet().getByRole('button', { name: /Kim v Lee/ })).toBeTruthy();
    expect(sheet().getByRole('button', { name: /Eve v Fay/ })).toBeTruthy();
  });

  it('a tap on a blocked match does nothing', async () => {
    const view = await openSheet();
    fireEvent.click(sheet().getByText('Ann Archer v Cat'));
    await settle();
    expect(calls(view, 'preview')).toHaveLength(0);
    expect(sheet().getByText('Kim v Lee')).toBeTruthy();
  });

  it('none: "Nothing can start here now"', async () => {
    await openSheet({ prepare: (f) => f.matchDay.answerCandidates(candidates()) });
    expect(sheet().getByText(en['matchday.call.none'])).toBeTruthy();
  });

  it('loading says so while the read is out', async () => {
    const view = await openList();
    view.matchDay.hold();
    fireEvent.click(callButton());
    await settle();
    expect(sheet().getByText(en['matchday.call.loading'])).toBeTruthy();
  });

  it('offline: the line and Try again, which asks again and recovers', async () => {
    const view = await openSheet({ prepare: (f) => f.matchDay.answerCandidates(OFFLINE) });
    expect(sheet().getByText(en['matchday.offlineEmpty'])).toBeTruthy();
    expect(sheet().queryByText('Kim v Lee')).toBeNull();
    view.matchDay.answerCandidates(candidates(OWN));
    fireEvent.click(sheet().getByRole('button', { name: en['panel.tryAgain'] }));
    await settle();
    expect(calls(view, 'candidates')).toHaveLength(2);
    expect(sheet().getByText('Kim v Lee')).toBeTruthy();
  });

  it('no power: says so with Close, and shows no match', async () => {
    await openSheet({
      prepare: (f) => f.matchDay.answerCandidates(refused({ code: 'MD_NO_CALL' })),
    });
    expect(sheet().getByText(en['matchday.call.noPower'])).toBeTruthy();
    fireEvent.click(sheet().getByRole('button', { name: en['matchday.call.close'] }));
    expect(screen.queryByTestId('call-screen')).toBeNull();
  });

  it('out of scope names the court', async () => {
    await openSheet({
      prepare: (f) => f.matchDay.answerCandidates(refused({ code: 'MD_OUT_OF_SCOPE' })),
    });
    expect(sheet().getByText(en['matchday.call.courtOutOfScope'])).toBeTruthy();
  });

  it('a second tap on Call a match while the sheet is open opens one sheet', async () => {
    const view = await openList();
    const button = callButton();
    fireEvent.click(button);
    fireEvent.click(button);
    await settle();
    expect(screen.getAllByTestId('call-screen')).toHaveLength(1);
    expect(calls(view, 'candidates')).toHaveLength(1);
  });
});

describe('the preview', () => {
  it('asks the server about the match picked and this court, and says No knock-on when quiet', async () => {
    const view = await openSheet();
    await pickKim();
    expect(calls(view, 'preview')).toEqual([
      expect.objectContaining({ fixtureId: ANN, courtId: COURT_2 }),
    ]);
    expect(sheet().getByText(en['matchday.call.quiet'])).toBeTruthy();
    expect(sheet().getByText('Kim v Lee')).toBeTruthy();
    expect(holdButton()).toBeTruthy();
  });

  it('says one line per warning, the count in its plural', async () => {
    const at = new Date('2026-10-03T20:00:00.000Z');
    await openSheet({
      prepare: (f) =>
        f.matchDay.answerPreview(
          ok({
            shifts: [],
            warnings: [
              { kind: 'pushesLater', count: 1 },
              { kind: 'restGap', personName: 'Eve Ellis', minutes: 5, minRest: 20 },
              { kind: 'pastDayEnd', courtName: 'Court 2', until: at },
              { kind: 'crossesClosure', courtName: 'Court 2', from: at, until: at },
              { kind: 'courtClosed', courtName: 'Court 2', until: null, since: at },
            ],
          }),
        ),
    });
    await pickKim();
    const lines = within(screen.getByTestId('call-screen'))
      .getAllByTestId('call-warning')
      .map((node) => node.textContent);
    expect(lines).toEqual([
      'Pushes 1 match later',
      'Eve Ellis has less rest than the division asks',
      "Runs past the court's closing time",
      'Crosses a court closure',
      'Closed: Court 2',
    ]);
    expect(sheet().queryByText(en['matchday.call.quiet'])).toBeNull();
  });

  it('pushes several matches later', async () => {
    await openSheet({
      prepare: (f) =>
        f.matchDay.answerPreview(ok({ shifts: [], warnings: [{ kind: 'pushesLater', count: 3 }] })),
    });
    await pickKim();
    expect(sheet().getByText('Pushes 3 matches later')).toBeTruthy();
  });

  it('a double tap on a candidate is one preview request', async () => {
    const view = await openSheet();
    const button = sheet().getByRole('button', { name: /Kim v Lee/ });
    fireEvent.click(button);
    fireEvent.click(button);
    await settle();
    expect(calls(view, 'preview')).toHaveLength(1);
  });

  it('while the preview is out it says so and the hold waits', async () => {
    const view = await openSheet();
    view.matchDay.hold();
    await pickKim();
    expect(sheet().getByText(en['matchday.call.checking'])).toBeTruthy();
    expect(holdButton().getAttribute('aria-disabled')).toBe('true');
    view.matchDay.release();
    await settle();
    expect(holdButton().getAttribute('aria-disabled')).not.toBe('true');
  });

  it('offline: the line and Try again, no hold until it answers', async () => {
    const view = await openSheet({ prepare: (f) => f.matchDay.answerPreview(OFFLINE) });
    await pickKim();
    expect(sheet().getByText(en['matchday.offlineEmpty'])).toBeTruthy();
    expect(sheet().queryByRole('button', { name: /Press and hold/ })).toBeNull();
    view.matchDay.answerPreview(QUIET);
    fireEvent.click(sheet().getByRole('button', { name: en['panel.tryAgain'] }));
    await settle();
    expect(sheet().getByText(en['matchday.call.quiet'])).toBeTruthy();
    expect(holdButton().getAttribute('aria-disabled')).not.toBe('true');
  });

  it('Choose another goes back to the list, read again', async () => {
    const view = await openSheet();
    await pickKim();
    fireEvent.click(sheet().getByRole('button', { name: en['matchday.call.other'] }));
    await settle();
    expect(sheet().getByText('Eve v Fay')).toBeTruthy();
    expect(calls(view, 'candidates')).toHaveLength(2);
  });
});

describe('the hold, then the call', () => {
  it('nothing is called before 3 s of hold, and releasing early calls nothing', async () => {
    const view = await openSheet();
    await pickKim();
    expect(calls(view, 'call')).toHaveLength(0);
    pressIn(holdButton());
    await settle(HOLD_MS - 1);
    expect(calls(view, 'call')).toHaveLength(0);
    pressOut(holdButton());
    await settle(HOLD_MS);
    expect(calls(view, 'call')).toHaveLength(0);
    expect(screen.getByTestId('call-screen')).toBeTruthy();
  });

  it('a tap, which is no hold, calls nothing', async () => {
    const view = await openSheet();
    await pickKim();
    fireEvent.click(holdButton());
    await settle(HOLD_MS);
    expect(calls(view, 'call')).toHaveLength(0);
  });

  it('after 3 s one call goes with the match and the court; the sheet closes and the day is read at once', async () => {
    const view = await openSheet();
    await pickKim();
    const days = calls(view, 'day').length;
    view.matchDay.answerDay({ ok: true, value: called() });
    await hold();
    expect(calls(view, 'call')).toEqual([
      expect.objectContaining({ fixtureId: ANN, courtId: COURT_2 }),
    ]);
    expect(screen.queryByTestId('call-screen')).toBeNull();
    expect(calls(view, 'day').length).toBeGreaterThan(days);
    const card = within(screen.getAllByTestId('court-card')[1] as HTMLElement);
    expect(card.getByText(en['matchday.court.called'])).toBeTruthy();
    expect(card.getByText('Kim v Lee')).toBeTruthy();
    expect(card.getByText(en['matchday.row.now'])).toBeTruthy();
  });

  it('says matchday.call with the court and the result, never a token, a name or a match', async () => {
    const view = await openSheet();
    await pickKim();
    await hold();
    const lines = readRecord(view.record).filter((l) => l.event === 'matchday.call');
    expect(lines).toHaveLength(1);
    expect(lines[0]?.fields).toEqual({ sid: COURT_2, result: 'called' });
    const all = JSON.stringify(readRecord(view.record));
    for (const secret of [FIXTURE_DAY_TOKEN, 'Kim', ANN]) expect(all).not.toContain(secret);
  });

  it('a second hold while the call is out is ignored: one request', async () => {
    const view = await openSheet();
    await pickKim();
    view.matchDay.hold();
    pressIn(holdButton());
    await settle(HOLD_MS);
    expect(calls(view, 'call')).toHaveLength(1);
    expect(sheet().getByText(en['matchday.call.calling'])).toBeTruthy();
    pressOut(holdButton());
    pressIn(holdButton());
    await settle(HOLD_MS);
    expect(calls(view, 'call')).toHaveLength(1);
    expect(holdButton().getAttribute('aria-disabled')).toBe('true');
    view.matchDay.release();
    await settle();
    expect(screen.queryByTestId('call-screen')).toBeNull();
  });

  it('Android Back mid-hold closes the sheet and the hold calls nothing', async () => {
    const view = await openSheet();
    await pickKim();
    pressIn(holdButton());
    await settle(HOLD_MS - 500);
    let handled = false;
    act(() => {
      handled = view.back.press();
    });
    expect(handled).toBe(true);
    expect(screen.queryByTestId('call-screen')).toBeNull();
    await settle(HOLD_MS);
    expect(calls(view, 'call')).toHaveLength(0);
    expect(screen.getByTestId('matchday-screen')).toBeTruthy();
  });

  it('Back on the list closes the sheet too, and the list gives its button back', async () => {
    const view = await openSheet();
    act(() => {
      view.back.press();
    });
    expect(screen.queryByTestId('call-screen')).toBeNull();
    expect(callButton()).toBeTruthy();
  });

  it('an offline call may have landed: the day is read at once, and the hold waits for Try again', async () => {
    const view = await openSheet({ prepare: (f) => f.matchDay.answerCall(OFFLINE) });
    await pickKim();
    const days = calls(view, 'day').length;
    await hold();
    expect(calls(view, 'day').length).toBeGreaterThan(days);
    expect(sheet().getByText(en['matchday.offlineEmpty'])).toBeTruthy();
    expect(
      view.record && readRecord(view.record).find((l) => l.event === 'matchday.call')?.fields,
    ).toEqual({
      sid: COURT_2,
      result: 'offline',
    });
  });
});

describe('a refused call says why, and the list is read again', () => {
  const REFUSALS: readonly [string, CallAnswer<never>, string][] = [
    ['no power', refused({ code: 'MD_NO_CALL' }), en['matchday.call.noPower']],
    ['out of scope', refused({ code: 'MD_OUT_OF_SCOPE' }), en['matchday.outOfScope']],
    [
      'a player busy',
      desk('playerBusy', 'Ann Archer', 'Court 3'),
      'Ann Archer is playing on Court 3',
    ],
    ['started', desk('started'), en['matchday.call.started']],
    ['not called', desk('notCalled'), en['matchday.call.moved']],
    ['the court busy', desk('courtBusy', null, 'Court 2'), 'Court 2 is busy'],
    ['not ready', desk('notReady'), en['matchday.call.notReady']],
    ['frozen', desk('frozen'), en['matchday.call.frozen']],
    ['not a candidate court', desk('notCandidateCourt'), "This match can't be played on Court 2"],
    ['gone', GONE, en['matchday.call.moved']],
  ];

  it.each(REFUSALS)('%s on the call', async (_, answer, line) => {
    const view = await openSheet({ prepare: (f) => f.matchDay.answerCall(answer) });
    await pickKim();
    const days = calls(view, 'day').length;
    await hold();
    expect(sheet().getByTestId('call-line').textContent).toBe(line);
    expect(calls(view, 'day').length).toBeGreaterThan(days);
    // The candidates are read again: the sheet is back on its list.
    expect(calls(view, 'candidates')).toHaveLength(2);
    expect(sheet().getByText('Eve v Fay')).toBeTruthy();
    expect(readRecord(view.record).filter((l) => l.event === 'matchday.call')).toHaveLength(1);
  });

  it('on the preview too: a refusal is said on the list', async () => {
    const view = await openSheet({ prepare: (f) => f.matchDay.answerPreview(desk('notReady')) });
    await pickKim();
    expect(sheet().getByTestId('call-line').textContent).toBe(en['matchday.call.notReady']);
    expect(calls(view, 'call')).toHaveLength(0);
  });

  it('a code that has ended is forgotten as the day forgets it, and the app goes Home', async () => {
    const view = await openSheet({
      prepare: (f) => f.matchDay.answerCall(refused({ code: 'MD_ENDED' })),
    });
    await pickKim();
    await hold();
    expect(view.navigation.current()).toBe('home');
  });
});

describe('the court stops being free under an open sheet', () => {
  it('says so and offers Close; the list and the hold are gone', async () => {
    const view = await openSheet();
    view.matchDay.answerDay({ ok: true, value: called() });
    await settle(MATCHDAY_POLL_MS);
    expect(sheet().getByText('Court 2 is no longer free')).toBeTruthy();
    expect(sheet().queryByText('Kim v Lee')).toBeNull();
    fireEvent.click(sheet().getByRole('button', { name: en['matchday.call.close'] }));
    expect(screen.queryByTestId('call-screen')).toBeNull();
  });

  it('also in the preview: no hold is left', async () => {
    const view = await openSheet();
    await pickKim();
    view.matchDay.answerDay({ ok: true, value: called() });
    await settle(MATCHDAY_POLL_MS);
    expect(sheet().getByText('Court 2 is no longer free')).toBeTruthy();
    expect(sheet().queryByRole('button', { name: /Press and hold/ })).toBeNull();
  });
});

describe('Undo call', () => {
  it('is offered under the Now row of a called court whose match has not started', async () => {
    await openList({ day: called() });
    expect(undoButton()).toBeTruthy();
  });

  it('is not offered once the match is in play, nor on a playing or free court', async () => {
    await openList({ day: called({ now: { ...OWN.match, status: 'inPlay' } }) });
    expect(screen.queryByText(en['matchday.call.undo'])).toBeNull();
  });

  it('is not offered on a playing court or a free one', async () => {
    await openList();
    expect(screen.queryByText(en['matchday.call.undo'])).toBeNull();
  });

  it('is not offered under an unstarted match on a court that is not called', async () => {
    await openList({ day: called({ state: 'playing' }) });
    expect(screen.queryByText(en['matchday.call.undo'])).toBeNull();
  });

  it('a tap asks first: the match, and Keep or Undo call; nothing is sent yet', async () => {
    const view = await openList({ day: called() });
    fireEvent.click(undoButton());
    await settle();
    const confirm = within(screen.getByTestId('undo-call-confirm'));
    expect(confirm.getByText(en['matchday.call.undoTitle'])).toBeTruthy();
    expect(confirm.getByText('Kim v Lee goes back to where it was')).toBeTruthy();
    expect(calls(view, 'undo')).toHaveLength(0);
  });

  it('Keep closes it and sends nothing', async () => {
    const view = await openList({ day: called() });
    fireEvent.click(undoButton());
    await settle();
    fireEvent.click(
      within(screen.getByTestId('undo-call-confirm')).getByRole('button', {
        name: en['matchday.call.keep'],
      }),
    );
    await settle();
    expect(screen.queryByTestId('undo-call-confirm')).toBeNull();
    expect(calls(view, 'undo')).toHaveLength(0);
  });

  it('Android Back keeps the call', async () => {
    const view = await openList({ day: called() });
    fireEvent.click(undoButton());
    await settle();
    act(() => {
      view.back.press();
    });
    expect(screen.queryByTestId('undo-call-confirm')).toBeNull();
    expect(calls(view, 'undo')).toHaveLength(0);
  });

  it('Undo call sends one request however often it is tapped, reads the day, and says matchday.uncall', async () => {
    const view = await openList({ day: called() });
    fireEvent.click(undoButton());
    await settle();
    const days = calls(view, 'day').length;
    view.matchDay.hold();
    const confirm = within(screen.getByTestId('undo-call-confirm'));
    const again = confirm.getByRole('button', { name: en['matchday.call.undo'] });
    fireEvent.click(again);
    fireEvent.click(again);
    await settle();
    view.matchDay.release();
    await settle();
    expect(calls(view, 'undo')).toEqual([expect.objectContaining({ fixtureId: ANN })]);
    expect(screen.queryByTestId('undo-call-confirm')).toBeNull();
    expect(calls(view, 'day').length).toBeGreaterThan(days);
    expect(readRecord(view.record).filter((l) => l.event === 'matchday.uncall')).toEqual([
      expect.objectContaining({ fields: { result: 'called' } }),
    ]);
  });

  it('closing after the answer opens the bounce window: a touch as it closes does not reopen the sheet', async () => {
    await openList({ day: called() });
    fireEvent.click(undoButton());
    await settle();
    fireEvent.click(
      within(screen.getByTestId('undo-call-confirm')).getByRole('button', {
        name: en['matchday.call.undo'],
      }),
    );
    await settle();
    expect(screen.queryByTestId('undo-call-confirm')).toBeNull();
    fireEvent.click(undoButton());
    await settle();
    expect(screen.queryByTestId('undo-call-confirm')).toBeNull();
    await settle(300);
    fireEvent.click(undoButton());
    await settle();
    expect(screen.getByTestId('undo-call-confirm')).toBeTruthy();
  });

  it.each([
    ['started', desk('started'), en['matchday.call.started']],
    ['not called', desk('notCalled'), en['matchday.call.moved']],
    ['called on the web desk', desk('notCodeCall'), en['matchday.call.notCodeCall']],
    ['no power', refused({ code: 'MD_NO_CALL' }), en['matchday.call.noPower']],
    ['frozen', desk('frozen'), en['matchday.call.frozen']],
    ['gone', GONE, en['matchday.call.moved']],
    ['offline', OFFLINE, en['matchday.offlineEmpty']],
  ] as const)('%s: said on the list, and the day is read again', async (_, answer, line) => {
    const view = await openList({
      day: called(),
      prepare: (f) => f.matchDay.answerUndo(answer as CallAnswer<never>),
    });
    fireEvent.click(undoButton());
    await settle();
    // The day is read again, and that read is offline here: no good read has landed yet, so every line is still up.
    view.matchDay.answerDay(OFFLINE, ok(called()));
    const days = calls(view, 'day').length;
    fireEvent.click(
      within(screen.getByTestId('undo-call-confirm')).getByRole('button', {
        name: en['matchday.call.undo'],
      }),
    );
    await settle();
    expect(screen.getByText(line)).toBeTruthy();
    expect(screen.queryByTestId('undo-call-confirm')).toBeNull();
    expect(calls(view, 'day').length).toBeGreaterThan(days);
  });

  const confirmUndo = async () => {
    fireEvent.click(
      within(screen.getByTestId('undo-call-confirm')).getByRole('button', {
        name: en['matchday.call.undo'],
      }),
    );
    await settle();
  };

  it.each([
    ['gone', GONE, en['matchday.call.moved']],
    ['offline', OFFLINE, en['matchday.offlineEmpty']],
  ] as const)(
    'a line about the read in flight (%s) ends when the next good read lands, not before (final review m1)',
    async (_, answer, line) => {
      const view = await openList({
        day: called(),
        prepare: (f) => f.matchDay.answerUndo(answer as CallAnswer<never>),
      });
      fireEvent.click(undoButton());
      await settle();
      view.matchDay.answerDay(OFFLINE, ok(called()));
      await confirmUndo();
      expect(screen.getByText(line)).toBeTruthy();
      await settle(MATCHDAY_POLL_MS);
      expect(screen.queryByText(line)).toBeNull();
    },
  );

  it('a good refresh straight after ends such a line at once', async () => {
    await openList({
      day: called(),
      prepare: (f) => f.matchDay.answerUndo(GONE),
    });
    fireEvent.click(undoButton());
    await settle();
    await confirmUndo();
    expect(screen.queryByText(en['matchday.call.moved'])).toBeNull();
  });

  it('a reason to be read (called on the desk) stays through the refresh it asked for, and ends at the next poll', async () => {
    await openList({ day: called(), prepare: (f) => f.matchDay.answerUndo(desk('notCodeCall')) });
    fireEvent.click(undoButton());
    await settle();
    await confirmUndo();
    expect(screen.getByText(en['matchday.call.notCodeCall'])).toBeTruthy();
    await settle(MATCHDAY_POLL_MS);
    expect(screen.queryByText(en['matchday.call.notCodeCall'])).toBeNull();
  });

  it('the sheet notices its court is no longer called: it says so, offers Close, and sends nothing (final review m2)', async () => {
    const view = await openList({ day: called() });
    fireEvent.click(undoButton());
    await settle();
    const confirm = () => within(screen.getByTestId('undo-call-confirm'));
    expect(confirm().queryByTestId('undo-call-gone')).toBeNull();
    view.matchDay.answerDay(ok(calling()));
    await settle(MATCHDAY_POLL_MS);
    expect(confirm().getByText('Court 2 is no longer called')).toBeTruthy();
    expect(confirm().queryByRole('button', { name: en['matchday.call.undo'] })).toBeNull();
    expect(confirm().queryByRole('button', { name: en['matchday.call.keep'] })).toBeNull();
    fireEvent.click(confirm().getByRole('button', { name: en['matchday.call.close'] }));
    await settle();
    expect(screen.queryByTestId('undo-call-confirm')).toBeNull();
    expect(calls(view, 'undo')).toHaveLength(0);
  });

  it.each([
    ['the court is playing', called({ state: 'playing' })],
    ['the match is in play', called({ now: { ...OWN.match, status: 'inPlay' } })],
    ['another match is Now', called({ now: row(BUSY, 'Zed', 'Yan') })],
  ])('the sheet is Close-only too when %s (final review m2)', async (_, day) => {
    const view = await openList({ day: called() });
    fireEvent.click(undoButton());
    await settle();
    view.matchDay.answerDay(ok(day));
    await settle(MATCHDAY_POLL_MS);
    expect(
      within(screen.getByTestId('undo-call-confirm')).getByTestId('undo-call-gone'),
    ).toBeTruthy();
  });

  it('with two called courts each control names its own (final review m3)', async () => {
    const two: MatchDay = {
      ...called(),
      courts: called().courts.map((c) =>
        c.courtId === COURT_2 ? c : { ...c, state: 'called', now: row(BUSY, 'Zed', 'Yan') },
      ),
    };
    await openList({ day: two });
    const names = screen
      .getAllByRole('button', { name: /^Undo call, / })
      .map((b) => b.getAttribute('aria-label') ?? b.textContent);
    expect(new Set(names).size).toBe(names.length);
    expect(names.length).toBeGreaterThan(1);
    expect(names).toContain('Undo call, Court 2');
  });

  it('the desk’s own call is explained in plain words', () => {
    expect(en['matchday.call.notCodeCall']).toBe(
      'Called from the web desk — ask the organiser to undo it',
    );
  });
});

describe('in Spanish, French and Dutch', () => {
  it.each(['es', 'fr', 'nl'] as const)(
    '%s: the button, the sheet, the reason and the hold',
    async (lang) => {
      await openSheet({ lang });
      expect(
        sheet().getByText(word(lang, 'matchday.call.title', { court: 'Court 2' })),
      ).toBeTruthy();
      expect(
        sheet().getByText(
          word(lang, 'matchday.call.busy', { name: 'Ann Archer', court: 'Court 3' }),
        ),
      ).toBeTruthy();
      expect(
        sheet().getByText(word(lang, 'matchday.call.nextOn', { court: 'Court 2' })),
      ).toBeTruthy();
      await pickKim(lang);
      expect(sheet().getByText(word(lang, 'matchday.call.quiet'))).toBeTruthy();
      expect(holdButton(lang)).toBeTruthy();
      expect(sheet().getByText(word(lang, 'matchday.call.hold'))).toBeTruthy();
    },
  );

  it.each(['es', 'fr', 'nl'] as const)('%s: Undo call asks in its words', async (lang) => {
    await openList({ lang, day: called() });
    fireEvent.click(undoButton(lang));
    await settle();
    const confirm = within(screen.getByTestId('undo-call-confirm'));
    expect(
      confirm.getByText(word(lang, 'matchday.call.undoTitle').replaceAll('\u00a0', ' ')),
    ).toBeTruthy();
    expect(
      confirm.getByText(word(lang, 'matchday.call.undoBody', { match: 'Kim v Lee' })),
    ).toBeTruthy();
  });
});
