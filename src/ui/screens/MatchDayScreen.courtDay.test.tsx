import { act, fireEvent, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Court, MatchDay, Row } from '@/domain/matchday/matchDay';
import { encodeSavedCode, type SavedCode } from '@/domain/mode/savedCode';
import { MATCHDAY_POLL_MS } from '@/hooks/useMatchDay';
import en from '@/i18n/en.json';
import es from '@/i18n/es.json';
import fr from '@/i18n/fr.json';
import nl from '@/i18n/nl.json';
import type { Lang } from '@/i18n/language';
import { FAKE_DAY } from '@/services/fakeMatchDayPort';
import { STORE_KEYS } from '@/services/modeStore';
import { MatchDayScreen } from '@/ui/screens/MatchDayScreen';
import { colour } from '@/ui/theme/tokens';
import { TEST_NOW } from '../../../test/fakePorts';
import { dayLink } from '../../../test/fixtures/dayCode';
import { edgeOf } from '../../../test/pressState';
import { renderWithPorts } from '../../../test/renderWithPorts';

// A court's whole day (owner, 2026-11-13: "If I click Court 2, can we open screen with full list and finished matches
// less?"), opened by a tap on its head, on react-native-web over the fake ports. Copy comes from the dictionaries; the
// press feel and colour are the device's.

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

const row = (
  fixtureId: string,
  home: string | null,
  away: string | null,
  more: Partial<Row> = {},
): Row => ({
  fixtureId,
  sportKey: 'badminton',
  divisionName: "Men's singles",
  roundLabel: null,
  roundTag: null,
  home,
  away,
  homeSlot: null,
  awaySlot: null,
  status: 'upcoming',
  scheduledAt: null,
  summary: null,
  ...more,
});
const done = (id: string, home: string, away: string): Row =>
  row(id, home, away, { status: 'finished', summary: '21-10' });

const COURT_2 = 'c-2';
const queue = [
  row('q-1', 'Kim', 'Lee'),
  row('q-2', 'Max', 'Noa'),
  row('q-3', 'Orla', 'Pia'),
  row('q-4', 'Quin', 'Rae'),
  row('q-5', 'Sam', 'Tia'),
];
const finished = [done('f-3', 'Cy', 'Di'), done('f-2', 'Bo', 'Eve'), done('f-1', 'Ann', 'Cat')];
const court = (courtId: string, courtName: string, more: Partial<Court> = {}): Court => ({
  courtId,
  courtName,
  venueName: 'Hall A',
  state: 'free',
  now: null,
  next: [],
  finished: [],
  ...more,
});
/** Court 2 has a match on, five queued and three finished: far more than its card shows. */
const busy = (more: Partial<Court> = {}): Court =>
  court(COURT_2, 'Court 2', {
    state: 'playing',
    now: row('p-1', 'Ng', 'Brown', { status: 'inPlay', summary: '14-9' }),
    next: queue,
    finished,
    ...more,
  });
const dayWith = (courts: readonly Court[], more: Partial<MatchDay> = {}): MatchDay => ({
  ...FAKE_DAY,
  courts,
  ...more,
});
const BASIC = dayWith([court('c-1', 'Court 1'), busy()]);

async function openList(day: MatchDay = BASIC, lang: Lang = 'en') {
  const view = renderWithPorts(<MatchDayScreen />, {
    kvSeed: {
      [STORE_KEYS.code('matchday')]: encodeSavedCode(SAVED_DAY),
      [STORE_KEYS.active]: 'matchday',
    },
    deviceLanguages: [lang],
    // A clock that moves with the fake timers, for the 250 ms after an overlay closes.
    clock: () => new Date(),
  });
  view.matchDay.answerDay({ ok: true, value: day });
  act(() => view.navigation.go('matchday'));
  await act(() => view.ports.modeStore.load());
  await settle();
  return view;
}

const settle = (ms = 0) => act(() => vi.advanceTimersByTimeAsync(ms));
const headOf = (name: string, lang: Lang = 'en') =>
  screen.getByRole('button', {
    name: new RegExp(`^${word(lang, 'matchday.court.openDay', { court: name })}, `),
  });
const dayScreen = () => screen.queryByTestId('court-day-screen');
const inDay = () => within(screen.getByTestId('court-day-screen'));
const dayRows = () => inDay().getAllByTestId('match-row');
const labels = () => dayRows().map((one) => one.getAttribute('aria-label'));
const backOfDay = () => inDay().getByRole('button', { name: en['mode.matchday'] });
const openDay = async (name = 'Court 2') => {
  fireEvent.click(headOf(name));
  await settle();
};

beforeEach(() => vi.useFakeTimers({ now: TEST_NOW }));
afterEach(() => vi.useRealTimers());

describe('a court’s day: opened from its head', () => {
  it('is not there until the head is tapped, and the list keeps its cards', async () => {
    await openList();
    expect(dayScreen()).toBeNull();
    expect(screen.getAllByTestId('court-card')).toHaveLength(2);
  });

  it('is titled with the court and says its venue and state', async () => {
    await openList();
    await openDay();
    const screenOf = inDay();
    expect(screenOf.getByText('Court 2')).toBeTruthy();
    expect(screenOf.getByText('Hall A')).toBeTruthy();
    expect(screenOf.getByText(en['matchday.court.playing'])).toBeTruthy();
    expect(screen.getByTestId('court-day-screen').getAttribute('aria-label')).toBe('Court 2');
  });

  it('shows Now, then every queued match in order: Next, Then, and the rest with no label', async () => {
    await openList();
    await openDay();
    expect(labels().slice(0, 7)).toEqual([
      `${en['matchday.row.now']}, Ng v Brown, 14-9`,
      `${en['matchday.row.next']}, Kim v Lee`,
      `${en['matchday.row.then']}, Max v Noa`,
      'Orla v Pia',
      'Quin v Rae',
      'Sam v Tia',
      `${en['matchday.row.finished']}, Cy v Di, 21-10`,
    ]);
  });

  it('shows only the latest finished match, with "+2 more finished"; a tap shows them all, and Show less hides them', async () => {
    await openList();
    await openDay();
    const finishedRows = () => labels().filter((l) => l?.startsWith(en['matchday.row.finished']));
    expect(inDay().getByText(en['matchday.row.finished'])).toBeTruthy();
    expect(finishedRows()).toEqual([`${en['matchday.row.finished']}, Cy v Di, 21-10`]);
    const more = inDay().getByTestId('finished-more');
    expect(more.textContent).toBe('+2 more finished');
    fireEvent.click(more);
    expect(finishedRows()).toHaveLength(3);
    expect(inDay().getByTestId('finished-more').textContent).toBe(en['matchday.finished.less']);
    fireEvent.click(inDay().getByTestId('finished-more'));
    expect(finishedRows()).toHaveLength(1);
  });

  it('has no finished heading or toggle for a court with none, and no toggle for one finished', async () => {
    await openList(dayWith([busy({ finished: [] }), court('c-1', 'Court 1')]));
    await openDay();
    expect(inDay().queryByText(en['matchday.row.finished'])).toBeNull();
    expect(inDay().queryByTestId('finished-more')).toBeNull();
  });

  it('keeps a lone finished match, with no toggle', async () => {
    await openList(dayWith([busy({ finished: finished.slice(0, 1) })]));
    await openDay();
    expect(inDay().getByText(en['matchday.row.finished'])).toBeTruthy();
    expect(inDay().queryByTestId('finished-more')).toBeNull();
  });

  it('puts a hairline above every match but the first, and one over the Finished heading', async () => {
    await openList();
    await openDay();
    const hairline = (element: Element) => {
      const { borderTopWidth, borderTopStyle, borderTopColor } = getComputedStyle(element);
      return [borderTopWidth, borderTopStyle, borderTopColor];
    };
    const line = ['1px', 'solid', edgeOf(colour.rule)];
    const wrappers = inDay().getAllByTestId('court-row');
    expect(getComputedStyle(wrappers[0] as Element).borderTopWidth).not.toBe('1px');
    for (const one of wrappers.slice(1, 6)) expect(hairline(one)).toEqual(line);
    expect(hairline(inDay().getByText(en['matchday.row.finished']))).toEqual(line);
    // The first finished match sits under its heading's line, which is its own.
    expect(getComputedStyle(wrappers[6] as Element).borderTopWidth).not.toBe('1px');
  });

  it('says no venue line for a court the web gives no venue', async () => {
    await openList(dayWith([busy({ venueName: '' })]));
    await openDay();
    expect(inDay().queryByText('Hall A')).toBeNull();
    // The chip is alone in the head: no empty venue line stands before it.
    const chip = inDay().getByText(en['matchday.court.playing']).parentElement as HTMLElement;
    expect(chip.parentElement?.children).toHaveLength(1);
  });

  it('with no match on and nothing queued, shows the state and no rows', async () => {
    await openList(dayWith([court(COURT_2, 'Court 2')]));
    await openDay();
    expect(inDay().queryAllByTestId('match-row')).toEqual([]);
    expect(inDay().getByText(en['matchday.court.free'])).toBeTruthy();
  });

  it('hides the list from a screen reader while it covers it, and shows it again on Back', async () => {
    await openList();
    const list = () => screen.getAllByTestId('court-card')[0]?.closest('[aria-hidden]');
    expect(list()).toBeNull();
    await openDay();
    expect(list()?.getAttribute('aria-hidden')).toBe('true');
    fireEvent.click(backOfDay());
    expect(list()).toBeNull();
  });

  it('names the head to a screen reader by what it does, then the state', async () => {
    await openList();
    const head = screen.getByLabelText(
      `${word('en', 'matchday.court.openDay', { court: 'Court 2' })}, ${en['matchday.court.playing']}`,
    );
    expect(head.getAttribute('role')).toBe('button');
  });
});

describe('a court’s day: leaving it', () => {
  it('Back returns to the list, its cards intact', async () => {
    await openList();
    await openDay();
    fireEvent.click(backOfDay());
    await settle();
    expect(dayScreen()).toBeNull();
    expect(screen.getAllByTestId('court-card')).toHaveLength(2);
    expect(
      within(screen.getAllByTestId('court-card')[1] as HTMLElement).getByText('Court 2'),
    ).toBeTruthy();
  });

  it('Android Back closes it, and the next Back goes Home', async () => {
    const view = await openList();
    await openDay();
    let handled = false;
    act(() => {
      handled = view.back.press();
    });
    expect(handled).toBe(true);
    expect(dayScreen()).toBeNull();
    expect(view.navigation.current()).toBe('matchday');
    await settle(300);
    act(() => {
      handled = view.back.press();
    });
    expect(view.navigation.current()).toBe('home');
  });

  it('a tap on the head that lands as it closes is ignored, and one after the bounce opens it again', async () => {
    await openList();
    await openDay();
    fireEvent.click(backOfDay());
    fireEvent.click(headOf('Court 2'));
    await settle();
    expect(dayScreen()).toBeNull();
    await settle(300);
    await openDay();
    expect(dayScreen()).not.toBeNull();
  });

  it('closes when a poll takes the court off the day, and does not come back with it', async () => {
    const view = await openList();
    await openDay();
    view.matchDay.answerDay({ ok: true, value: dayWith([court('c-1', 'Court 1')]) });
    await settle(MATCHDAY_POLL_MS);
    expect(dayScreen()).toBeNull();
    view.matchDay.answerDay({ ok: true, value: BASIC });
    await settle(MATCHDAY_POLL_MS);
    expect(dayScreen()).toBeNull();
  });

  it('follows the day: a poll that moves the queue shows in the open view', async () => {
    const view = await openList();
    await openDay();
    view.matchDay.answerDay({
      ok: true,
      value: dayWith([court('c-1', 'Court 1'), busy({ next: [row('q-9', 'Uli', 'Val')] })]),
    });
    await settle(MATCHDAY_POLL_MS);
    expect(labels().slice(0, 2)).toEqual([
      `${en['matchday.row.now']}, Ng v Brown, 14-9`,
      `${en['matchday.row.next']}, Uli v Val`,
    ]);
    expect(inDay().queryByText('Kim v Lee')).toBeNull();
  });
});

describe('a court’s day: the head is not the court’s action', () => {
  it('the Call button still opens the call sheet, not the day', async () => {
    await openList(dayWith([court(COURT_2, 'Court 2')], { canCall: true }));
    fireEvent.click(
      screen.getByRole('button', {
        name: word('en', 'matchday.call.actionNamed', { court: 'Court 2' }),
      }),
    );
    await settle();
    expect(screen.getByTestId('call-screen')).toBeTruthy();
    expect(dayScreen()).toBeNull();
  });

  it('the Undo button still asks, and does not open the day', async () => {
    const called = court(COURT_2, 'Court 2', {
      state: 'called',
      now: row('c-1', 'Kim', 'Lee'),
    });
    await openList(dayWith([called], { canCall: true }));
    fireEvent.click(
      screen.getByRole('button', {
        name: word('en', 'matchday.call.undoNamed', { court: 'Court 2' }),
      }),
    );
    await settle();
    expect(dayScreen()).toBeNull();
  });
});

describe('a court’s day: its matches open as the card’s do', () => {
  const opens = (view: Awaited<ReturnType<typeof openList>>) =>
    view.matchDay.calls.filter((call) => call.op === 'open');

  it('a seated match asks the server to open it, once, and the view leaves the list as it was', async () => {
    const view = await openList();
    await openDay();
    fireEvent.click(dayRows()[1] as HTMLElement);
    await settle();
    expect(opens(view)).toHaveLength(1);
    expect(opens(view)[0]).toMatchObject({ fixtureId: 'q-1' });
    // The view leaves with the tap, so a refusal ("can't open") is said on the list, not under the view.
    expect(dayScreen()).toBeNull();
  });

  it('a second touch right after the open acts on nothing: the list’s row beneath it is quiet', async () => {
    const view = await openList();
    await openDay();
    fireEvent.click(dayRows()[1] as HTMLElement);
    // The first open has finished by the time the finger lands again (an open in flight would hide the gap).
    await settle(100);
    // The view is gone; the finger lands again on Court 2's own Now row on the list.
    fireEvent.click(
      within(screen.getAllByTestId('court-card')[1] as HTMLElement).getAllByTestId(
        'match-row',
      )[0] as HTMLElement,
    );
    await settle();
    expect(opens(view)).toHaveLength(1);
    // Anti-vacuity: after the bounce the same row opens.
    await settle(300);
    fireEvent.click(
      within(screen.getAllByTestId('court-card')[1] as HTMLElement).getAllByTestId(
        'match-row',
      )[0] as HTMLElement,
    );
    await settle();
    expect(opens(view)).toHaveLength(2);
  });

  it('two touches in one frame on a day row open once, and the view is gone', async () => {
    const view = await openList();
    await openDay();
    const target = dayRows()[1] as HTMLElement;
    act(() => {
      fireEvent.click(target);
      fireEvent.click(target);
    });
    await settle();
    expect(opens(view)).toHaveLength(1);
    expect(dayScreen()).toBeNull();
  });

  it('a match with an empty seat is not a control, and a finished one opens only when its link is held', async () => {
    const half = row('q-h', 'Eva', null, { awaySlot: 'Winner of SF·2' });
    const view = await openList(dayWith([busy({ next: [half, ...queue.slice(1)] })]));
    await openDay();
    expect(dayRows()[1]?.getAttribute('role')).not.toBe('button');
    const lastFinished = dayRows().at(-1) as HTMLElement;
    expect(lastFinished.getAttribute('role')).not.toBe('button');
    fireEvent.click(dayRows()[1] as HTMLElement);
    fireEvent.click(lastFinished);
    await settle();
    expect(opens(view)).toEqual([]);
  });
});

describe('a court’s day: in another language', () => {
  it.each(['es', 'fr', 'nl'] as const)('reads in %s', async (lang) => {
    await openList(BASIC, lang);
    fireEvent.click(headOf('Court 2', lang));
    await settle();
    expect(labels().slice(0, 3)).toEqual([
      `${word(lang, 'matchday.row.now')}, Ng v Brown, 14-9`,
      `${word(lang, 'matchday.row.next')}, Kim v Lee`,
      `${word(lang, 'matchday.row.then')}, Max v Noa`,
    ]);
    expect(inDay().getByTestId('finished-more').textContent).toBe(
      word(lang, 'matchday.finished.more.other', { count: '2' }),
    );
    expect(inDay().getByRole('button', { name: word(lang, 'mode.matchday') })).toBeTruthy();
  });
});
