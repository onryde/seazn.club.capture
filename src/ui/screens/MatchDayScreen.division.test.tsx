import { act, fireEvent, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Candidate } from '@/domain/matchday/callWire';
import type { Court, MatchDay, Row } from '@/domain/matchday/matchDay';
import { encodeSavedCode, type SavedCode } from '@/domain/mode/savedCode';
import en from '@/i18n/en.json';
import es from '@/i18n/es.json';
import type { Lang } from '@/i18n/language';
import { FAKE_DAY } from '@/services/fakeMatchDayPort';
import { STORE_KEYS } from '@/services/modeStore';
import { MatchDayScreen } from '@/ui/screens/MatchDayScreen';
import { colour } from '@/ui/theme/tokens';
import { TEST_NOW } from '../../../test/fakePorts';
import { dayLink } from '../../../test/fixtures/dayCode';
import { edgeOf } from '../../../test/pressState';
import { renderWithPorts } from '../../../test/renderWithPorts';

// A row names its division when the day lists more than one (owner, 2026-11-14: "is it possible to have division
// name?"): under the names on a card, in a court's day, on the matches on no court and in the Call sheet. Copy comes
// from the dictionaries; colour is the device's (the ink is read from the style the web draws).

const SAVED_DAY: SavedCode = {
  mode: 'matchday',
  raw: dayLink(),
  slot: null,
  savedAt: TEST_NOW,
  expiresAt: null,
  stream: null,
  scoring: null,
};
const MEN = "Men's Singles A";
const WOMEN = "Women's Doubles B";

const row = (
  fixtureId: string,
  home: string,
  away: string,
  divisionName: string,
  more: Partial<Row> = {},
): Row => ({
  fixtureId,
  sportKey: 'badminton',
  divisionName,
  roundLabel: 'R1',
  roundTag: 'R1',
  home,
  away,
  homeSlot: null,
  awaySlot: null,
  status: 'upcoming',
  scheduledAt: null,
  summary: null,
  ...more,
});
const court = (courtId: string, courtName: string, more: Partial<Court> = {}): Court => ({
  courtId,
  courtName,
  venueName: 'Hall A',
  state: 'playing',
  now: null,
  next: [],
  finished: [],
  ...more,
});
/** Court 2: Ng v Brown on (men's), Kim v Lee next (women's), Cy v Di finished (men's). */
const TWO = (more: Partial<MatchDay> = {}): MatchDay => ({
  ...FAKE_DAY,
  courts: [
    court('c-2', 'Court 2', {
      now: row('p-1', 'Ng', 'Brown', MEN, { status: 'inPlay', summary: '14-9' }),
      next: [row('q-1', 'Kim', 'Lee', WOMEN)],
      finished: [row('f-1', 'Cy', 'Di', MEN, { status: 'finished', summary: '21-10' })],
    }),
  ],
  noCourt: [],
  online: [],
  ...more,
});
const ONE: MatchDay = {
  ...TWO(),
  courts: [
    court('c-2', 'Court 2', {
      now: row('p-1', 'Ng', 'Brown', MEN, { status: 'inPlay', summary: '14-9' }),
      next: [row('q-1', 'Kim', 'Lee', MEN)],
      finished: [row('f-1', 'Cy', 'Di', MEN, { status: 'finished', summary: '21-10' })],
    }),
  ],
};

async function openList(day: MatchDay, lang: Lang = 'en') {
  const view = renderWithPorts(<MatchDayScreen />, {
    kvSeed: {
      [STORE_KEYS.code('matchday')]: encodeSavedCode(SAVED_DAY),
      [STORE_KEYS.active]: 'matchday',
    },
    deviceLanguages: [lang],
    clock: () => new Date(),
  });
  view.matchDay.answerDay({ ok: true, value: day });
  act(() => view.navigation.go('matchday'));
  await act(() => view.ports.modeStore.load());
  await settle();
  return view;
}
const settle = (ms = 0) => act(() => vi.advanceTimersByTimeAsync(ms));
const divisions = (scope: ReturnType<typeof within> | typeof screen = screen) =>
  scope.queryAllByTestId('match-division').map((one: HTMLElement) => one.textContent);
const labelsIn = (scope: ReturnType<typeof within> | typeof screen = screen) =>
  scope.getAllByTestId('match-row').map((one: HTMLElement) => one.getAttribute('aria-label'));

beforeEach(() => vi.useFakeTimers({ now: TEST_NOW }));
afterEach(() => vi.useRealTimers());

describe('a row names its division', () => {
  it('under the names on a card, for every row, when the day lists two divisions', async () => {
    await openList(TWO());
    expect(divisions()).toEqual([MEN, WOMEN, MEN]);
    const names = screen.getAllByText('Ng v Brown')[0];
    // The names stay on their own line: the division is its own text under them.
    expect(names?.textContent).toBe('Ng v Brown');
    expect(screen.getAllByTestId('match-division')[0]?.textContent).toBe(MEN);
  });

  it('draws nothing for a day of one division', async () => {
    await openList(ONE);
    expect(divisions()).toEqual([]);
    expect(screen.queryByText(MEN)).toBeNull();
  });

  it('is said after the round and before the label, for a screen reader, only when it shows', async () => {
    await openList(TWO());
    expect(labelsIn()).toEqual([
      `R1, ${MEN}, ${en['matchday.row.now']}, Ng v Brown, 14-9`,
      `R1, ${WOMEN}, ${en['matchday.row.next']}, Kim v Lee`,
      `R1, ${MEN}, ${en['matchday.row.finished']}, Cy v Di, 21-10`,
    ]);
  });

  it('says it in the language of the phone, the division as the organiser typed it', async () => {
    await openList(TWO(), 'es');
    expect(labelsIn()[0]).toBe(`R1, ${MEN}, ${es['matchday.row.now']}, Ng v Brown, 14-9`);
    expect(divisions()[1]).toBe(WOMEN);
  });

  it('is dimmed on a finished row and in the second ink on the rest', async () => {
    await openList(TWO());
    const [now, , done] = screen.getAllByTestId('match-division');
    expect(getComputedStyle(now as Element).color).toBe(edgeOf(colour.ink2));
    expect(getComputedStyle(done as Element).color).toBe(edgeOf(colour.ink3));
  });

  it('never draws a blank line for a match with no division name, even on a two-division day', async () => {
    const day = TWO();
    const blank = row('q-9', 'Zed', 'Yan', '');
    await openList({
      ...day,
      courts: [{ ...(day.courts[0] as Court), next: [day.courts[0]!.next[0] as Row, blank] }],
    });
    expect(divisions()).toEqual([MEN, WOMEN, MEN]);
    expect(labelsIn()).toContain(`R1, ${en['matchday.row.then']}, Zed v Yan`);
  });

  it('draws it on the matches on no court and on the online boards', async () => {
    await openList(
      TWO({
        noCourt: [row('n-1', 'Ola', 'Pam', WOMEN)],
        online: [row('o-1', 'Quinn', 'Rex', MEN)],
      }),
    );
    expect(divisions()).toEqual([MEN, WOMEN, MEN, WOMEN, MEN]);
  });

  it('counts a division that only a finished match under “more” lists', async () => {
    const day = TWO();
    const only = day.courts[0] as Court;
    await openList({
      ...day,
      courts: [
        {
          ...only,
          now: null,
          next: [],
          finished: [
            row('f-1', 'Cy', 'Di', MEN, { status: 'finished', summary: '21-10' }),
            row('f-2', 'Ed', 'Flo', WOMEN, { status: 'finished', summary: '21-12' }),
          ],
        },
      ],
    });
    // The second division's match is under "+1 more finished", yet it counts: the latest shows its division.
    expect(divisions()).toEqual([MEN]);
  });
});

describe('a court’s day names the division too', () => {
  const open = async (day: MatchDay) => {
    await openList(day);
    fireEvent.click(
      screen.getByRole('button', {
        name: new RegExp(`^${en['matchday.court.openDay'].replace('{court}', 'Court 2')}, `),
      }),
    );
    await settle();
  };

  it('shows it under every row of the day when the day lists two divisions', async () => {
    await open(TWO());
    const inDay = within(screen.getByTestId('court-day-screen'));
    expect(divisions(inDay)).toEqual([MEN, WOMEN, MEN]);
    expect(labelsIn(inDay)[1]).toBe(`R1, ${WOMEN}, ${en['matchday.row.next']}, Kim v Lee`);
  });

  it('shows nothing for one division', async () => {
    await open(ONE);
    expect(divisions(within(screen.getByTestId('court-day-screen')))).toEqual([]);
  });
});

describe('the Call sheet names the division', () => {
  const candidate = (match: Row): Candidate => ({
    match,
    source: 'thisCourt',
    fromCourtName: null,
    called: false,
    firstInQueue: true,
    plannedAt: null,
    waitingMinutes: 0,
    behindMinutes: 0,
    blocked: null,
  });
  const openSheet = async (day: MatchDay) => {
    const free = { ...(day.courts[0] as Court), state: 'free' as const, now: null };
    const view = await openList({ ...day, canCall: true, courts: [free, ...day.courts.slice(1)] });
    view.matchDay.answerCandidates({
      ok: true,
      value: {
        courtId: 'c-2',
        courtName: 'Court 2',
        candidates: [
          candidate(row('a-1', 'Kim', 'Lee', WOMEN)),
          candidate(row('a-2', 'Eve', 'Fay', MEN)),
        ],
      },
    });
    fireEvent.click(
      screen.getByRole('button', {
        name: en['matchday.call.actionNamed'].replace('{court}', 'Court 2'),
      }),
    );
    await settle();
    return within(screen.getByTestId('call-screen'));
  };

  it('under each candidate when the day lists two divisions, and in the preview of the one picked', async () => {
    const sheet = await openSheet(TWO());
    expect(divisions(sheet)).toEqual([WOMEN, MEN]);
    fireEvent.click(sheet.getByRole('button', { name: new RegExp('Kim v Lee') }));
    await settle();
    expect(divisions(within(screen.getByTestId('call-screen')))).toEqual([WOMEN]);
  });

  it('draws nothing for one division', async () => {
    const sheet = await openSheet(ONE);
    expect(sheet.getAllByTestId('candidate')).toHaveLength(2);
    expect(divisions(sheet)).toEqual([]);
  });
});
