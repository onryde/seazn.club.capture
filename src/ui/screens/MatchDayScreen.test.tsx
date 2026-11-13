import { act, cleanup, fireEvent, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Approval, Court, MatchDay, Row } from '@/domain/matchday/matchDay';
import { encodeSavedCode, type SavedCode } from '@/domain/mode/savedCode';
import { MATCHDAY_POLL_MS } from '@/hooks/useMatchDay';
import en from '@/i18n/en.json';
import es from '@/i18n/es.json';
import fr from '@/i18n/fr.json';
import nl from '@/i18n/nl.json';
import type { Lang } from '@/i18n/language';
import { FAKE_DAY } from '@/services/fakeMatchDayPort';
import { createMemoryKeyValueStore } from '@/services/KeyValueStore';
import { createLogger } from '@/services/logger';
import { createMatchDayStore, MATCHDAY_KEYS } from '@/services/matchDayStore';
import { STORE_KEYS } from '@/services/modeStore';
import { createRingRecord } from '@/services/sessionRecord';
import { MatchDayScreen } from '@/ui/screens/MatchDayScreen';
import { colour } from '@/ui/theme/tokens';
import { TEST_NOW, type FakePorts } from '../../../test/fakePorts';
import { dayLink, FIXTURE_DAY_TOKEN } from '../../../test/fixtures/dayCode';
import { createMemoryQueueFiles } from '../../../test/memoryQueueFiles';
import { edgeOf } from '../../../test/pressState';
import { renderWithPorts } from '../../../test/renderWithPorts';
import { queueHolding } from '../../../test/scoringHomeFixtures';

// MD-2 Task 4: Match Day's list by court (S4 design §5, layout B), on react-native-web over the fake ports. Copy comes
// from the dictionaries, never from the screen; what the phone draws (colour on glass, a pull to refresh, the real
// fonts) is the device check's.

const DICTIONARY: Readonly<Record<Lang, Record<string, string>>> = { en, es, fr, nl };
const word = (lang: Lang, key: string): string => {
  const text = DICTIONARY[lang][key];
  if (text === undefined) throw new Error(`no ${key} in ${lang}`);
  return text;
};
const DAY_CODE = { origin: 'https://stg.seazn.club', token: FIXTURE_DAY_TOKEN };
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
  scheduledAt: new Date('2026-10-03T14:20:00.000Z'),
  summary: null,
  ...more,
});
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
const dayWith = (more: Partial<MatchDay>): MatchDay => ({ ...FAKE_DAY, ...more });

/** 09:42Z on the fakes' day: 10:42 in London (BST), the fakes' venue and phone zone. */
const COPIED_AT = new Date('2026-10-03T09:42:00.000Z');

async function copyOf(day: MatchDay): Promise<Record<string, string>> {
  const files = createMemoryQueueFiles();
  const logger = createLogger({ record: createRingRecord(), now: () => 0 });
  const store = createMatchDayStore({ kv: createMemoryKeyValueStore(), files, logger });
  await store.writeCache(DAY_CODE, day, COPIED_AT);
  return Object.fromEntries(files.files);
}

type Open = {
  readonly day?: MatchDay;
  readonly copy?: MatchDay;
  readonly lang?: Lang;
  /** The phone's zone, when not the venue's. */
  readonly zone?: string;
  readonly kv?: Record<string, string>;
  readonly prepare?: (fakes: FakePorts) => void | Promise<void>;
};

/** The list as Home's tile opens it: the day code saved and active, the route Match Day's, the server's day `day`. */
async function openList(open: Open = {}) {
  const view = renderWithPorts(<MatchDayScreen />, {
    kvSeed: {
      [STORE_KEYS.code('matchday')]: encodeSavedCode(SAVED_DAY),
      [STORE_KEYS.active]: 'matchday',
      ...open.kv,
    },
    dayFilesSeed: open.copy === undefined ? {} : await copyOf(open.copy),
    deviceLanguages: [open.lang ?? 'en'],
    ...(open.zone === undefined ? {} : { phoneZone: open.zone }),
  });
  view.matchDay.answerDay({ ok: true, value: open.day ?? FAKE_DAY });
  await open.prepare?.(view);
  act(() => view.navigation.go('matchday'));
  await act(() => view.ports.modeStore.load());
  await settle();
  return view;
}

const settle = (ms = 0) => act(() => vi.advanceTimersByTimeAsync(ms));
const cards = () => screen.getAllByTestId('court-card');
const cardAt = (at: number) => within(cards()[at] as HTMLElement);
const rows = () => screen.queryAllByTestId('match-row');
const style = (element: Element) => getComputedStyle(element);

beforeEach(() => vi.useFakeTimers({ now: TEST_NOW }));
afterEach(() => vi.useRealTimers());

describe('MatchDayScreen: the day by court (S4 design §5)', () => {
  it('ready shows Court 1, Ng v Brown, 14-9 and Patel v Okafor', async () => {
    await openList();
    expect(cardAt(0).getByText('Court 1')).toBeTruthy();
    expect(cardAt(0).getByText('Ng v Brown')).toBeTruthy();
    expect(cardAt(0).getByText('14-9')).toBeTruthy();
    expect(cardAt(0).getByText('Patel v Okafor')).toBeTruthy();
    // 13:40Z is 14:40 in London, the venue's zone, which is the phone's: no zone name.
    expect(cardAt(0).getByText('14:40')).toBeTruthy();
    expect(cardAt(1).getByText('Court 2')).toBeTruthy();
    // No court has a finished match: no heading for none.
    expect(screen.queryByText(en['matchday.row.finished'])).toBeNull();
  });

  it('heads the list with the competition, the code’s scope and its day', async () => {
    await openList();
    expect(screen.getByText('SAFE Open · Hall A · Sat 3 Oct')).toBeTruthy();
    expect(screen.getByText(en['mode.matchday'])).toBeTruthy();
  });

  it('says "All courts" for a code over the whole competition', async () => {
    await openList({ day: dayWith({ scope: { kind: 'competition', label: 'SAFE Open' } }) });
    expect(screen.getByText('SAFE Open · All courts · Sat 3 Oct')).toBeTruthy();
  });

  it('says a courts code’s own label, as the server wrote it', async () => {
    await openList({ day: dayWith({ scope: { kind: 'courts', label: 'Court 1, Court 2' } }) });
    expect(screen.getByText('SAFE Open · Court 1, Court 2 · Sat 3 Oct')).toBeTruthy();
  });

  it('a phone in another zone: the code’s own day, and the venue’s times with the zone named', async () => {
    // 13:00Z on the 3rd is already the 4th in Auckland: the day is still the code's own.
    await openList({ zone: 'Pacific/Auckland' });
    expect(screen.getByText('SAFE Open · Hall A · Sat 3 Oct')).toBeTruthy();
    expect(screen.getByLabelText('R2, Next, Patel v Okafor, 14:40 BST')).toBeTruthy();
  });

  it('reads each card’s court and state word to a screen reader, and each row with its label', async () => {
    await openList();
    expect(screen.getByLabelText('Court 1, Playing')).toBeTruthy();
    expect(screen.getByLabelText('Court 2, Free')).toBeTruthy();
    expect(screen.getByLabelText('R2, Now, Ng v Brown, 14-9')).toBeTruthy();
    expect(screen.getByLabelText('R2, Next, Patel v Okafor, 14:40')).toBeTruthy();
  });

  it('shows Then for the second match of a queue, and no third', async () => {
    const queue = [row('n-1', 'Lee', 'Tan'), row('n-2', 'Kim', 'Rossi'), row('n-3', 'Park', 'Ito')];
    await openList({ day: dayWith({ courts: [court('c-1', 'Court 1', { next: queue })] }) });
    expect(screen.getByLabelText('Next, Lee v Tan, 15:20')).toBeTruthy();
    expect(screen.getByLabelText('Then, Kim v Rossi, 15:20')).toBeTruthy();
    expect(screen.queryByText('Park v Ito')).toBeNull();
  });

  it('says "To be decided" for a seat with no player yet, never TBD', async () => {
    const queue = [row('n-1', null, 'Tan'), row('n-2', null, null)];
    await openList({ day: dayWith({ courts: [court('c-1', 'Court 1', { next: queue })] }) });
    expect(screen.getByText('To be decided v Tan')).toBeTruthy();
    expect(screen.getByText('To be decided v To be decided')).toBeTruthy();
    expect(screen.queryByText(/TBD/)).toBeNull();
  });

  it('a match with no planned time or no score yet shows no detail', async () => {
    const queue = [row('n-1', 'Lee', 'Tan', { scheduledAt: null })];
    const now = row('p-1', 'Ng', 'Brown', { status: 'inPlay', summary: null });
    await openList({ day: dayWith({ courts: [court('c-1', 'Court 1', { now, next: queue })] }) });
    expect(screen.getByLabelText('Now, Ng v Brown')).toBeTruthy();
    expect(screen.getByLabelText('Next, Lee v Tan')).toBeTruthy();
  });

  it('says each court state in words: Playing, Called, Free, In use', async () => {
    const courts = [
      court('c-1', 'Court 1', { state: 'playing' }),
      court('c-2', 'Court 2', { state: 'called' }),
      court('c-3', 'Court 3', { state: 'free' }),
      court('c-4', 'Court 4', { state: 'inUseElsewhere' }),
    ];
    await openList({ day: dayWith({ courts }) });
    for (const [name, key] of [
      ['Court 1', 'matchday.court.playing'],
      ['Court 2', 'matchday.court.called'],
      ['Court 3', 'matchday.court.free'],
      ['Court 4', 'matchday.court.inUseElsewhere'],
    ] as const) {
      const head = screen.getByLabelText(`${name}, ${en[key]}`);
      expect(within(head).getByText(en[key])).toBeTruthy();
    }
  });

  it('paints every state word in a token, never the Fabric default black', async () => {
    const courts = [
      court('c-1', 'Court 1', { state: 'playing' }),
      court('c-2', 'Court 2', { state: 'called' }),
      court('c-3', 'Court 3', { state: 'free' }),
      court('c-4', 'Court 4', { state: 'inUseElsewhere' }),
    ];
    await openList({ day: dayWith({ courts }) });
    const ink = (key: keyof typeof en) => style(screen.getByText(en[key])).color;
    expect(ink('matchday.court.playing')).toBe(edgeOf(colour.ground));
    expect(ink('matchday.court.called')).toBe(edgeOf(colour.lime));
    expect(ink('matchday.court.free')).toBe(edgeOf(colour.ink2));
    expect(ink('matchday.court.inUseElsewhere')).toBe(edgeOf(colour.ink3));
  });

  it('dims the finished matches under the court’s Next, under "Finished", with their result', async () => {
    const done = row('f-1', 'Ann', 'Cat', { status: 'finished', summary: '21-15 21-18' });
    const courts = [
      court('c-1', 'Court 1', { next: [row('n-1', 'Lee', 'Tan')], finished: [done] }),
    ];
    await openList({ day: dayWith({ courts }) });
    expect(cardAt(0).getByText(en['matchday.row.finished'])).toBeTruthy();
    const finished = screen.getByLabelText('Finished, Ann v Cat, 21-15 21-18');
    expect(style(within(finished).getByText('Ann v Cat')).color).toBe(edgeOf(colour.ink3));
    expect(style(within(finished).getByText('21-15 21-18')).color).toBe(edgeOf(colour.ink3));
    expect(style(screen.getByText('Lee v Tan')).color).toBe(edgeOf(colour.ink));
    const order = rows().map((one) => one.getAttribute('aria-label'));
    expect(order).toEqual(['Next, Lee v Tan, 15:20', 'Finished, Ann v Cat, 21-15 21-18']);
  });

  it('a light hairline divides a court’s matches and sets off Finished (owner: "why don’t have divide line in match day screen?")', async () => {
    const finished = [
      row('f-1', 'Ann', 'Cat', { status: 'finished', summary: '21-15 21-18' }),
      row('f-2', 'Dee', 'Eve', { status: 'finished', summary: '21-9 21-7' }),
    ];
    const courts = [
      court('c-1', 'Court 1', {
        state: 'playing',
        now: row('p-1', 'Ng', 'Brown', { status: 'inPlay' }),
        next: [row('n-1', 'Lee', 'Tan'), row('n-2', 'Kim', 'Roe')],
        finished,
      }),
    ];
    await openList({ day: dayWith({ courts }) });
    fireEvent.click(cardAt(0).getByRole('button', { name: /more finished/i }));
    await settle();
    const hairline = (element: Element) => {
      const { borderTopWidth, borderTopStyle, borderTopColor } = style(element);
      return [borderTopWidth, borderTopStyle, borderTopColor];
    };
    const line = ['1px', 'solid', edgeOf(colour.rule)];
    const [now, next, then, done, doneToo] = cardAt(0).getAllByTestId('court-row');
    // The first match sits under the court's head with no line; every match after it has one.
    expect(style(now as Element).borderTopWidth).not.toBe('1px');
    for (const one of [next, then, doneToo]) expect(hairline(one as Element)).toEqual(line);
    // Finished is set off by its heading's line, so the first finished row under it needs none.
    expect(hairline(cardAt(0).getByText(en['matchday.row.finished']))).toEqual(line);
    expect(style(done as Element).borderTopWidth).not.toBe('1px');
  });

  it('lists the matches on no court under "Not on a court yet" with their count, then the online boards', async () => {
    const noCourt = [row('x-1', 'Singh', 'Murphy', { scheduledAt: null })];
    const online = [
      row('o-1', 'Novak', 'Haddad', { sportKey: 'boardgame', status: 'finished', summary: '1-0' }),
    ];
    await openList({ day: dayWith({ noCourt, online }) });
    expect(screen.getByText(`${en['matchday.noCourt']} · 1`)).toBeTruthy();
    expect(screen.getByLabelText('Singh v Murphy')).toBeTruthy();
    expect(screen.getByText(en['matchday.online'])).toBeTruthy();
    expect(screen.getByLabelText('Novak v Haddad, 1-0')).toBeTruthy();
    const order = rows().map((one) => one.getAttribute('aria-label'));
    expect(order.slice(-2)).toEqual(['Singh v Murphy', 'Novak v Haddad, 1-0']);
  });

  it('draws no section for an empty list: no "Not on a court yet", no "Online"', async () => {
    await openList();
    expect(screen.queryByText(new RegExp(en['matchday.noCourt']))).toBeNull();
    expect(screen.queryByText(en['matchday.online'])).toBeNull();
  });

  it('a court’s rows open their match (Task 5); the matches on no court and the online boards are read-only', async () => {
    const online = [row('o-1', 'Novak', 'Haddad', { sportKey: 'boardgame' })];
    await openList({ day: dayWith({ noCourt: [row('x-1', 'Singh', 'Murphy')], online }) });
    expect(rows()).toHaveLength(4);
    const pressable = rows().map((one) => one.getAttribute('role') === 'button');
    expect(pressable).toEqual([true, true, false, false]);
    const names = screen
      .getAllByRole('button')
      .map((one) => one.getAttribute('aria-label') ?? one.textContent);
    expect(names).toEqual([
      en['stream.home'],
      en['matchday.menu'],
      'R2, Now, Ng v Brown, 14-9',
      expect.stringMatching(/^R2, Next, Patel v Okafor/),
    ]);
  });

  it('says so when the code has no match today', async () => {
    await openList({ day: dayWith({ courts: [], noCourt: [], online: [] }) });
    expect(screen.getByText(en['matchday.empty'])).toBeTruthy();
    expect(screen.queryAllByTestId('court-card')).toEqual([]);
  });

  it('does not say the day is empty while it has a court, even a free one', async () => {
    await openList({
      day: dayWith({ courts: [court('c-1', 'Court 1')], noCourt: [], online: [] }),
    });
    expect(screen.queryByText(en['matchday.empty'])).toBeNull();
  });

  it('a new answer redraws the list in place', async () => {
    const view = await openList();
    const moved = dayWith({
      courts: [court('c-9', 'Court 9', { state: 'called', next: [row('n-1', 'Lee', 'Tan')] })],
    });
    view.matchDay.answerDay({ ok: true, value: moved });
    await settle(MATCHDAY_POLL_MS);
    expect(screen.queryByText('Ng v Brown')).toBeNull();
    expect(screen.getByLabelText('Court 9, Called')).toBeTruthy();
  });
});

describe('MatchDayScreen: the copy, offline and loading', () => {
  it('offline shows "Offline · updated 10:42" over the cached list', async () => {
    await openList({
      copy: FAKE_DAY,
      prepare: (fakes) => fakes.matchDay.answerDay({ ok: false, offline: true }),
    });
    expect(screen.getByText('Offline · updated 10:42')).toBeTruthy();
    expect(screen.getByText('Ng v Brown')).toBeTruthy();
    expect(style(screen.getByText('Offline · updated 10:42')).color).toBe(edgeOf(colour.caution));
  });

  it('says nothing of offline once the server answers again', async () => {
    const view = await openList({
      copy: FAKE_DAY,
      prepare: (fakes) => fakes.matchDay.answerDay({ ok: false, offline: true }),
    });
    view.matchDay.answerDay({ ok: true, value: FAKE_DAY });
    await settle(MATCHDAY_POLL_MS);
    expect(screen.queryByText(/Offline/)).toBeNull();
  });

  it('offline with no copy shows "Offline" with no list, and Try again reads the day again', async () => {
    const view = await openList({
      prepare: (fakes) => fakes.matchDay.answerDay({ ok: false, offline: true }),
    });
    expect(screen.getByText(en['matchday.offlineEmpty'])).toBeTruthy();
    expect(screen.queryAllByTestId('court-card')).toEqual([]);
    expect(screen.queryByText(en['matchday.empty'])).toBeNull();
    view.matchDay.answerDay({ ok: true, value: FAKE_DAY });
    fireEvent.click(screen.getByRole('button', { name: en['panel.tryAgain'] }));
    await settle();
    expect(view.matchDay.calls.filter((call) => call.op === 'day')).toHaveLength(2);
    expect(screen.getByText('Ng v Brown')).toBeTruthy();
    expect(screen.queryByRole('button', { name: en['panel.tryAgain'] })).toBeNull();
  });

  it('a second Try again while the first is out asks nothing more', async () => {
    const view = await openList({
      prepare: (fakes) => fakes.matchDay.answerDay({ ok: false, offline: true }),
    });
    view.matchDay.hold();
    const retry = screen.getByRole('button', { name: en['panel.tryAgain'] });
    fireEvent.click(retry);
    fireEvent.click(retry);
    expect(view.matchDay.calls.filter((call) => call.op === 'day')).toHaveLength(2);
  });

  it('while Try again’s read is out, it waits and says the day is being fetched (review M4)', async () => {
    const view = await openList({
      prepare: (fakes) => fakes.matchDay.answerDay({ ok: false, offline: true }),
    });
    expect(screen.queryByText(en['matchday.loading.body'])).toBeNull();
    view.matchDay.hold();
    fireEvent.click(screen.getByRole('button', { name: en['panel.tryAgain'] }));
    await settle();
    expect(screen.getByText(en['matchday.loading.body'])).toBeTruthy();
    const retry = screen.getByRole('button', { name: en['panel.tryAgain'] });
    expect(retry.getAttribute('aria-disabled')).toBe('true');
    view.matchDay.release();
    await settle();
    expect(screen.queryByText(en['matchday.loading.body'])).toBeNull();
    expect(
      screen.getByRole('button', { name: en['panel.tryAgain'] }).getAttribute('aria-disabled'),
    ).not.toBe('true');
  });

  it('shows the copy at once while the first read is out, with no Offline line', async () => {
    await openList({ copy: FAKE_DAY, prepare: (fakes) => fakes.matchDay.hold() });
    expect(screen.getByText('Ng v Brown')).toBeTruthy();
    expect(screen.queryByText(/Offline/)).toBeNull();
  });

  it('with no copy, says the day is being opened until the server answers', async () => {
    const view = await openList({ prepare: (fakes) => fakes.matchDay.hold() });
    expect(screen.getByText(en['matchday.loading.title'])).toBeTruthy();
    expect(screen.getByText(en['matchday.loading.body'])).toBeTruthy();
    view.matchDay.release();
    await settle();
    expect(screen.queryByText(en['matchday.loading.title'])).toBeNull();
    expect(screen.getByText('Ng v Brown')).toBeTruthy();
  });
});

describe('MatchDayScreen: venue chips (S4 design §5)', () => {
  const twoHalls = [
    court('c-1', 'Court 1', { venueName: 'Hall A' }),
    court('c-2', 'Court 2', { venueName: 'Hall B' }),
    court('c-3', 'Court 3', { venueName: 'Hall A' }),
  ];
  const competition = { kind: 'competition', label: 'SAFE Open' } as const;
  const chip = (name: string) => screen.getByRole('button', { name });
  const courtNames = () =>
    cards().map((card) => within(card).getByTestId('court-name').textContent);

  it('venue chips show only on a competition code with two venues, and filter the courts', async () => {
    await openList({ day: dayWith({ scope: competition, courts: twoHalls }) });
    expect(chip(en['matchday.venues.all']).getAttribute('aria-selected')).toBe('true');
    expect(chip('Hall A').getAttribute('aria-selected')).toBe('false');
    fireEvent.click(chip('Hall B'));
    expect(courtNames()).toEqual(['Court 2']);
    expect(chip('Hall B').getAttribute('aria-selected')).toBe('true');
    expect(chip(en['matchday.venues.all']).getAttribute('aria-selected')).toBe('false');
    fireEvent.click(chip('Hall A'));
    expect(courtNames()).toEqual(['Court 1', 'Court 3']);
    fireEvent.click(chip(en['matchday.venues.all']));
    expect(courtNames()).toEqual(['Court 1', 'Court 2', 'Court 3']);
  });

  it('a picked venue that leaves the day shows every court again, with All venues lit', async () => {
    const threeHalls = [...twoHalls, court('c-4', 'Court 4', { venueName: 'Hall C' })];
    const view = await openList({ day: dayWith({ scope: competition, courts: threeHalls }) });
    fireEvent.click(chip('Hall C'));
    expect(courtNames()).toEqual(['Court 4']);
    view.matchDay.answerDay({ ok: true, value: dayWith({ scope: competition, courts: twoHalls }) });
    await settle(MATCHDAY_POLL_MS);
    expect(courtNames()).toEqual(['Court 1', 'Court 2', 'Court 3']);
    expect(screen.queryByRole('button', { name: 'Hall C' })).toBeNull();
    expect(chip(en['matchday.venues.all']).getAttribute('aria-selected')).toBe('true');
  });

  it.each([
    [
      'a venue code over two venues',
      { scope: { kind: 'venue', label: 'Hall A' }, courts: twoHalls },
    ],
    ['a competition code over one venue', { scope: competition, courts: twoHalls.slice(0, 1) }],
  ] as const)('show none on %s', async (_what, more) => {
    await openList({ day: dayWith(more) });
    expect(screen.queryByRole('button', { name: en['matchday.venues.all'] })).toBeNull();
  });
});

describe('MatchDayScreen: the approval banner (S4 design §7)', () => {
  const swiss: Approval = {
    kind: 'swiss',
    stageId: '4c9d0e1f-2a3b-4c4d-8e5f-7a8b9c0d1e2f',
    divisionName: 'Open',
    label: 'Swiss',
    round: 4,
    waiting: null,
  };
  const draw: Approval = {
    kind: 'draw',
    stageId: '3b8c9d0e-1f2a-4b3c-bd4e-6f7a8b9c0d1e',
    divisionName: "Men's singles",
    label: 'Finals',
    round: null,
    waiting: null,
  };

  it.each([
    ['Swiss, can approve', [swiss], true, 'Round 3 complete · Round 4 pairings are ready'],
    ['Swiss, web only', [swiss], false, 'Round 3 complete · pair on the web desk'],
    [
      'a draw, can approve',
      [draw],
      true,
      "Groups finished · Men's singles · Knockout bracket is ready",
    ],
    [
      'a draw, web only',
      [draw],
      false,
      "Groups finished · Men's singles · bracket on the web desk",
    ],
    ['Swiss with no round', [{ ...swiss, round: null }], true, 'Swiss · pair on the web desk'],
    ['Swiss round 1 (review M5)', [{ ...swiss, round: 1 }], true, 'Swiss · pair on the web desk'],
    [
      'Swiss round 2',
      [{ ...swiss, round: 2 }],
      true,
      'Round 1 complete · Round 2 pairings are ready',
    ],
    [
      'two waiting',
      [draw, swiss],
      true,
      "Groups finished · Men's singles · Knockout bracket is ready",
    ],
  ] as const)('%s: says the first approval waiting', async (_what, approvals, canApprove, line) => {
    await openList({ day: dayWith({ approvals, canApprove }) });
    expect(within(screen.getByTestId('approval-banner')).getByText(line)).toBeTruthy();
  });

  it('shows no banner when nothing waits', async () => {
    await openList();
    expect(screen.queryByTestId('approval-banner')).toBeNull();
  });

  it('has a Review button where the phone may approve and name a round', async () => {
    await openList({ day: dayWith({ approvals: [swiss], canApprove: true }) });
    const banner = within(screen.getByTestId('approval-banner'));
    expect(banner.getByRole('button', { name: en['matchday.approve.review'] })).toBeTruthy();
    cleanup();
    await openList({ day: dayWith({ approvals: [draw], canApprove: true }) });
    expect(
      within(screen.getByTestId('approval-banner')).getByRole('button', {
        name: en['matchday.approve.review'],
      }),
    ).toBeTruthy();
  });

  it.each([
    ['a code without approvals', [swiss], false],
    ['a Swiss stage with no round', [{ ...swiss, round: null }], true],
    ['a Swiss round 1', [{ ...swiss, round: 1 }], true],
    ['a draw on a code without approvals', [draw], false],
  ] as const)('%s: the banner is a line with no button', async (_what, approvals, canApprove) => {
    await openList({ day: dayWith({ approvals, canApprove }) });
    expect(within(screen.getByTestId('approval-banner')).queryByRole('button')).toBeNull();
  });

  it('Review opens the approval screen for that stage, and reads its review once', async () => {
    const view = await openList({ day: dayWith({ approvals: [swiss], canApprove: true }) });
    view.matchDay.answerReview({ ok: false, offline: true });
    fireEvent.click(screen.getByRole('button', { name: en['matchday.approve.review'] }));
    await settle();
    expect(screen.getByTestId('approval-screen')).toBeTruthy();
    expect(view.matchDay.calls.filter((call) => call.op === 'review')).toEqual([
      expect.objectContaining({ kind: 'swiss', stageId: swiss.stageId }),
    ]);
  });
});

describe('MatchDayScreen: Sending N (S4 design §5)', () => {
  const ng = FAKE_DAY.courts[0]?.now?.fixtureId ?? '';
  const sending = (count: number) =>
    en[count === 1 ? 'matchday.sending.one' : 'matchday.sending.other'].replace(
      '{count}',
      String(count),
    );

  it('shows the unsent taps on the card of the court whose match holds them, and on no other', async () => {
    await openList({
      kv: { [MATCHDAY_KEYS.opened]: JSON.stringify([ng]) },
      prepare: async (fakes) => {
        await fakes.tapQueue.save(queueHolding(ng, 3));
      },
    });
    expect(cardAt(0).getByText(sending(3))).toBeTruthy();
    expect(cardAt(1).queryByText(/Sending/)).toBeNull();
  });

  it('says one tap in the singular', async () => {
    await openList({
      kv: { [MATCHDAY_KEYS.opened]: JSON.stringify([ng]) },
      prepare: async (fakes) => {
        await fakes.tapQueue.save(queueHolding(ng, 1));
      },
    });
    expect(cardAt(0).getByText(sending(1))).toBeTruthy();
  });

  it('shows nothing once the taps have gone', async () => {
    const view = await openList({
      kv: { [MATCHDAY_KEYS.opened]: JSON.stringify([ng]) },
      prepare: async (fakes) => {
        await fakes.tapQueue.save(queueHolding(ng, 1));
      },
    });
    await act(() => view.tapQueue.save(queueHolding(ng, 0)));
    await settle(MATCHDAY_POLL_MS);
    expect(screen.queryByText(/Sending/)).toBeNull();
  });

  it('counts no match the operator did not open from Match Day', async () => {
    await openList({
      prepare: async (fakes) => {
        await fakes.tapQueue.save(queueHolding(ng, 3));
      },
    });
    expect(screen.queryByText(/Sending/)).toBeNull();
  });

  it('a queue it cannot read says the court’s taps are at risk, in caution, on that court only (review I1)', async () => {
    const lee = 'x-2';
    const second = court('c-2', 'Court 2', { state: 'called', next: [row(lee, 'Lee', 'Tan')] });
    await openList({
      day: dayWith({ courts: [FAKE_DAY.courts[0] as Court, second] }),
      kv: { [MATCHDAY_KEYS.opened]: JSON.stringify([ng, lee]) },
      prepare: async (fakes) => {
        fakes.queueFiles.files.set(`${ng}.json`, '{garbled');
        await fakes.tapQueue.save(queueHolding(lee, 2));
      },
    });
    const atRisk = cardAt(0).getByText(en['matchday.sending.atRisk']);
    expect(style(atRisk).color).toBe(edgeOf(colour.caution));
    expect(cardAt(0).queryByText(/Sending/)).toBeNull();
    expect(cardAt(1).getByText(sending(2))).toBeTruthy();
    expect(cardAt(1).queryByText(en['matchday.sending.atRisk'])).toBeNull();
    expect(style(cardAt(1).getByText(sending(2))).color).toBe(edgeOf(colour.ink2));
  });

  it('the matches on no court say their unsent taps and their taps at risk too (review M2)', async () => {
    const noCourt = [row('x-1', 'Singh', 'Murphy'), row('x-2', 'Ahmed', 'Ross')];
    const view = await openList({
      day: dayWith({ noCourt }),
      kv: { [MATCHDAY_KEYS.opened]: JSON.stringify(['x-1', 'x-2']) },
      prepare: async (fakes) => {
        await fakes.tapQueue.save(queueHolding('x-1', 4));
      },
    });
    const section = screen.getByText(`${en['matchday.noCourt']} · 2`).parentElement as HTMLElement;
    expect(within(section).getByText(sending(4))).toBeTruthy();
    expect(cards().every((card) => within(card).queryByText(/Sending/) === null)).toBe(true);
    view.queueFiles.files.set('x-2.json', '{garbled');
    await settle(MATCHDAY_POLL_MS);
    expect(within(section).getByText(en['matchday.sending.atRisk'])).toBeTruthy();
  });
});

describe('MatchDayScreen: the top bar', () => {
  it('has a visible way back to Home (Task 3 review M6), and ⋯ for Exit (Task 7)', async () => {
    const view = await openList();
    // Back, ⋯ (Exit's), and the court's two rows (Task 5): nothing else is a button.
    expect(screen.getAllByRole('button')).toHaveLength(4);
    fireEvent.click(screen.getByRole('button', { name: en['stream.home'] }));
    expect(view.navigation.current()).toBe('home');
  });

  it('Android Back returns Home', async () => {
    const view = await openList();
    let handled = false;
    act(() => {
      handled = view.back.press();
    });
    expect(handled).toBe(true);
    expect(view.navigation.current()).toBe('home');
  });
});

describe('MatchDayScreen: what a thumb hits and what never grows', () => {
  it('every pressable is at least 48 dp tall: Home, ⋯ and the venue chips', async () => {
    const twoHalls = [court('c-1', 'Court 1'), court('c-2', 'Court 2', { venueName: 'Hall B' })];
    await openList({
      day: dayWith({ scope: { kind: 'competition', label: 'SAFE Open' }, courts: twoHalls }),
    });
    const tall = screen
      .getAllByRole('button')
      .map((one) =>
        Math.max(parseFloat(style(one).minHeight) || 0, parseFloat(style(one).height) || 0),
      );
    expect(tall).toEqual([48, 48, 48, 48, 48]);
  });

  it('Try again is 48 dp tall too', async () => {
    await openList({ prepare: (fakes) => fakes.matchDay.answerDay({ ok: false, offline: true }) });
    expect(style(screen.getByRole('button', { name: en['panel.tryAgain'] })).minHeight).toBe(
      '48px',
    );
  });

  it('every match row is 48 dp tall, the size Task 5’s targets will be', async () => {
    await openList({ day: dayWith({ noCourt: [row('x-1', 'Singh', 'Murphy')] }) });
    expect(rows().map((one) => style(one).minHeight)).toEqual(['48px', '48px', '48px']);
  });

  it('each name line and the court’s name is one line, cut with an ellipsis, so a card never grows', async () => {
    await openList();
    for (const text of [
      screen.getByText('Ng v Brown'),
      screen.getByText('Patel v Okafor'),
      cardAt(0).getByTestId('court-name'),
    ]) {
      expect(style(text).whiteSpace).toBe('nowrap');
      expect(style(text).textOverflow).toBe('ellipsis');
    }
  });
});

describe('MatchDayScreen: in four languages', () => {
  it.each(['es', 'fr', 'nl'] as const)(
    '%s: the row labels, the state words and the offline line',
    async (lang) => {
      await openList({
        lang,
        copy: FAKE_DAY,
        prepare: (fakes) => fakes.matchDay.answerDay({ ok: false, offline: true }),
      });
      expect(
        screen.getByLabelText(`Court 1, ${word(lang, 'matchday.court.playing')}`),
      ).toBeTruthy();
      expect(screen.getByLabelText(`Court 2, ${word(lang, 'matchday.court.free')}`)).toBeTruthy();
      expect(
        screen.getByLabelText(`R2, ${word(lang, 'matchday.row.now')}, Ng v Brown, 14-9`),
      ).toBeTruthy();
      expect(
        screen.getByText(word(lang, 'matchday.offline').replace('{time}', '10:42')),
      ).toBeTruthy();
      expect(screen.getByRole('button', { name: word(lang, 'stream.home') })).toBeTruthy();
    },
  );
});

describe('finished matches: the latest, then "+N more finished" (F-T8-5)', () => {
  const done = (id: string, home: string, away: string): Row =>
    row(id, home, away, { status: 'finished', summary: '21-10' });
  const three = [done('f-3', 'Cy', 'Di'), done('f-2', 'Bo', 'Eve'), done('f-1', 'Ann', 'Cat')];
  const finishedLabels = () =>
    rows()
      .map((one) => one.getAttribute('aria-label') ?? '')
      .filter((label) => label.startsWith('Finished'));
  const moreOf = (at: number) => cardAt(at).queryByTestId('finished-more');
  const tap = (at: number) => fireEvent.click(moreOf(at) as HTMLElement);

  it('shows the newest finished match and one row for the rest; a tap shows them all, and a tap hides them', async () => {
    await openList({ day: dayWith({ courts: [court('c-1', 'Court 1', { finished: three })] }) });
    expect(finishedLabels()).toEqual(['Finished, Cy v Di, 21-10']);
    const more = moreOf(0) as HTMLElement;
    expect(more.textContent).toBe('+2 more finished');
    expect(more.getAttribute('aria-expanded')).toBe('false');
    expect(style(within(more).getByText('+2 more finished')).color).toBe(edgeOf(colour.ink3));
    tap(0);
    expect(finishedLabels()).toHaveLength(3);
    expect(moreOf(0)?.textContent).toBe(en['matchday.finished.less']);
    expect(moreOf(0)?.getAttribute('aria-expanded')).toBe('true');
    tap(0);
    expect(finishedLabels()).toHaveLength(1);
    expect(moreOf(0)?.textContent).toBe('+2 more finished');
  });

  it('says one more in the singular', async () => {
    await openList({
      day: dayWith({ courts: [court('c-1', 'Court 1', { finished: three.slice(0, 2) })] }),
    });
    expect(moreOf(0)?.textContent).toBe(en['matchday.finished.more.one'].replace('{count}', '1'));
  });

  it('has no row for a court with one finished match or none', async () => {
    const courts = [
      court('c-1', 'Court 1', { finished: three.slice(0, 1) }),
      court('c-2', 'Court 2'),
    ];
    await openList({ day: dayWith({ courts }) });
    expect(screen.queryAllByTestId('finished-more')).toEqual([]);
    expect(finishedLabels()).toHaveLength(1);
  });

  it('opens each court on its own', async () => {
    const other = [done('g-2', 'Fay', 'Gus'), done('g-1', 'Hal', 'Ivy')];
    const courts = [
      court('c-1', 'Court 1', { finished: three }),
      court('c-2', 'Court 2', { finished: other }),
    ];
    await openList({ day: dayWith({ courts }) });
    tap(1);
    expect(cardAt(0).getAllByLabelText(/^Finished/)).toHaveLength(1);
    expect(cardAt(1).getAllByLabelText(/^Finished/)).toHaveLength(2);
    expect(moreOf(0)?.getAttribute('aria-expanded')).toBe('false');
  });

  it('stays open when the day is read again with more than one finished, and closes cleanly when it drops to one', async () => {
    const view = await openList({
      day: dayWith({ courts: [court('c-1', 'Court 1', { finished: three })] }),
    });
    tap(0);
    view.matchDay.answerDay({
      ok: true,
      value: dayWith({ courts: [court('c-1', 'Court 1', { finished: [...three] })] }),
    });
    await settle(MATCHDAY_POLL_MS);
    expect(finishedLabels()).toHaveLength(3);
    view.matchDay.answerDay({
      ok: true,
      value: dayWith({ courts: [court('c-1', 'Court 1', { finished: three.slice(0, 1) })] }),
    });
    await settle(MATCHDAY_POLL_MS);
    expect(screen.queryAllByTestId('finished-more')).toEqual([]);
    expect(finishedLabels()).toHaveLength(1);
    view.matchDay.answerDay({
      ok: true,
      value: dayWith({ courts: [court('c-1', 'Court 1', { finished: three })] }),
    });
    await settle(MATCHDAY_POLL_MS);
    expect(finishedLabels()).toHaveLength(1);
    expect(moreOf(0)?.getAttribute('aria-expanded')).toBe('false');
  });

  it('flips once per tap: two taps leave it as it was', async () => {
    await openList({ day: dayWith({ courts: [court('c-1', 'Court 1', { finished: three })] }) });
    tap(0);
    tap(0);
    expect(finishedLabels()).toHaveLength(1);
  });

  it.each(['es', 'fr', 'nl'] as const)('reads in %s', async (lang) => {
    await openList({
      lang,
      day: dayWith({ courts: [court('c-1', 'Court 1', { finished: three })] }),
    });
    expect(moreOf(0)?.textContent).toBe(
      word(lang, 'matchday.finished.more.other').replace('{count}', '2'),
    );
    tap(0);
    expect(moreOf(0)?.textContent).toBe(word(lang, 'matchday.finished.less'));
  });
});

describe('MatchDayScreen: the round chip, the slot words and the waiting draw (task 8d-B)', () => {
  const tagged = (id: string, home: string | null, away: string | null, more: Partial<Row> = {}) =>
    row(id, home, away, { roundTag: 'SF·1', ...more });
  const chips = () => screen.queryAllByTestId('round-chip').map((chip) => chip.textContent);

  it('every row kind starts with its chip: Now, Next, Then, a finished match, no court and online', async () => {
    const day = dayWith({
      courts: [
        court('c-1', 'Court 1', {
          now: tagged('p-1', 'Ng', 'Brown', { status: 'inPlay', roundTag: 'R1' }),
          next: [
            tagged('n-1', 'Lee', 'Tan', { roundTag: 'QF·1' }),
            tagged('n-2', 'Kim', 'Rossi', { roundTag: 'QF·2' }),
          ],
          finished: [tagged('f-1', 'Ann', 'Cat', { status: 'finished', roundTag: 'R2' })],
        }),
      ],
      noCourt: [tagged('c-9', 'Singh', 'Murphy', { roundTag: 'SF·2' })],
      online: [tagged('o-1', 'Ola', 'Pia', { roundTag: 'F' })],
    });
    await openList({ day });
    expect(chips()).toEqual(['R1', 'QF·1', 'QF·2', 'R2', 'SF·2', 'F']);
  });

  it('the tag is read first: "SF·1, Now, Eva Novak v Bea Lund, 14-9"', async () => {
    const now = tagged('p-1', 'Eva Novak', 'Bea Lund', { status: 'inPlay', summary: '14-9' });
    await openList({ day: dayWith({ courts: [court('c-1', 'Court 1', { now })] }) });
    expect(screen.getByLabelText('SF·1, Now, Eva Novak v Bea Lund, 14-9')).toBeTruthy();
  });

  it('a finished row reads its tag before its heading', async () => {
    const done = tagged('f-1', 'Ann', 'Cat', { status: 'finished', summary: '2–0' });
    await openList({ day: dayWith({ courts: [court('c-1', 'Court 1', { finished: [done] })] }) });
    expect(screen.getByLabelText('SF·1, Finished, Ann v Cat, 2–0')).toBeTruthy();
  });

  it('with no tag the chip is the round label, and with neither there is none', async () => {
    const queue = [
      row('n-1', 'Lee', 'Tan', { roundTag: null, roundLabel: 'QF' }),
      row('n-2', 'Kim', 'Rossi', { roundTag: null, roundLabel: null }),
    ];
    await openList({ day: dayWith({ courts: [court('c-1', 'Court 1', { next: queue })] }) });
    expect(chips()).toEqual(['QF']);
    expect(screen.getByLabelText('QF, Next, Lee v Tan, 15:20')).toBeTruthy();
    expect(screen.getByLabelText('Then, Kim v Rossi, 15:20')).toBeTruthy();
  });

  it('an empty seat says what it waits for, dimmed; a seated one stays in cream', async () => {
    const queue = [
      tagged('n-1', 'Eva Novak', null, { awaySlot: 'Winner of SF·2' }),
      tagged('n-2', null, null, {
        homeSlot: 'Winner of Group A',
        awaySlot: 'Runner-up of Group B',
      }),
    ];
    await openList({ day: dayWith({ courts: [court('c-1', 'Court 1', { next: queue })] }) });
    expect(style(screen.getByText('Winner of SF·2')).color).toBe(edgeOf(colour.ink3));
    expect(style(screen.getByText('Winner of Group A')).color).toBe(edgeOf(colour.ink3));
    expect(style(screen.getByText('Runner-up of Group B')).color).toBe(edgeOf(colour.ink3));
    expect(style(screen.getByText(/^Eva Novak/)).color).toBe(edgeOf(colour.ink));
    expect(screen.getByLabelText('SF·1, Next, Eva Novak v Winner of SF·2, 15:20')).toBeTruthy();
    expect(
      screen.getByLabelText('SF·1, Then, Winner of Group A v Runner-up of Group B, 15:20'),
    ).toBeTruthy();
    expect(screen.queryByText(en['matchday.seat.tbd'])).toBeNull();
  });

  it('a slot the web sent as "" is no words: the seat says "To be decided", never blank', async () => {
    const queue = [row('n-1', null, null, { roundTag: 'SF·1', homeSlot: '', awaySlot: '' })];
    await openList({ day: dayWith({ courts: [court('c-1', 'Court 1', { next: queue })] }) });
    const tbd = en['matchday.seat.tbd'];
    expect(screen.getByText(`${tbd} v ${tbd}`)).toBeTruthy();
  });

  it('"To be decided" only for a seat whose slot is null too', async () => {
    const queue = [tagged('n-1', null, null, { homeSlot: 'Winner of Group A' })];
    await openList({ day: dayWith({ courts: [court('c-1', 'Court 1', { next: queue })] }) });
    expect(
      screen.getByLabelText(`SF·1, Next, Winner of Group A v ${en['matchday.seat.tbd']}, 15:20`),
    ).toBeTruthy();
  });

  it.each(['es', 'fr', 'nl'] as const)(
    'says "To be decided" in %s from its dictionary',
    async (lang) => {
      const queue = [tagged('n-1', 'Eva', null)];
      await openList({
        lang,
        day: dayWith({ courts: [court('c-1', 'Court 1', { next: queue })] }),
      });
      expect(screen.getByText(`Eva v ${word(lang, 'matchday.seat.tbd')}`)).toBeTruthy();
    },
  );

  it('a match with an empty seat is not a control, slot words or not: the pad never opens on it', async () => {
    const view = await openList({
      day: dayWith({
        courts: [
          court('c-1', 'Court 1', {
            next: [
              tagged('n-3', 'Kim', 'Rossi'),
              tagged('n-1', 'Eva', null, { awaySlot: 'Winner of SF·2' }),
            ],
          }),
          court('c-2', 'Court 2', { next: [tagged('n-2', null, null)] }),
        ],
      }),
    });
    const [seatedRow, half, none] = rows();
    expect(seatedRow?.getAttribute('role')).toBe('button');
    expect(half?.getAttribute('role')).not.toBe('button');
    expect(none?.getAttribute('role')).not.toBe('button');
    fireEvent.click(half as HTMLElement);
    fireEvent.click(none as HTMLElement);
    await settle();
    expect(view.matchDay.calls.filter((call) => call.op === 'open')).toEqual([]);
    // Anti-vacuity: the seated row's tap does ask the server to open it.
    fireEvent.click(seatedRow as HTMLElement);
    await settle();
    expect(view.matchDay.calls.filter((call) => call.op === 'open')).toHaveLength(1);
  });

  describe('a draw the web holds as waiting', () => {
    const draw: Approval = {
      kind: 'draw',
      stageId: '3b8c9d0e-1f2a-4b3c-bd4e-6f7a8b9c0d1e',
      divisionName: "Men's singles",
      label: 'Finals',
      round: null,
      waiting: 'stageComplete',
    };
    const line = (lang: Lang) =>
      word(lang, 'matchday.approve.waiting').replace('{division}', "Men's singles");

    it.each([true, false])(
      'says to complete the stage on the web desk, with no button (can approve: %s)',
      async (canApprove) => {
        await openList({ day: dayWith({ approvals: [draw], canApprove }) });
        const banner = within(screen.getByTestId('approval-banner'));
        expect(banner.getByText(line('en'))).toBeTruthy();
        expect(line('en')).toBe(
          "Groups finished · Men's singles · complete the stage on the web desk",
        );
        expect(banner.queryByRole('button')).toBeNull();
      },
    );

    it.each(['es', 'fr', 'nl'] as const)('says it in %s', async (lang) => {
      await openList({ lang, day: dayWith({ approvals: [draw], canApprove: true }) });
      const banner = within(screen.getByTestId('approval-banner'));
      expect(banner.getByText(line(lang))).toBeTruthy();
      expect(banner.queryByRole('button')).toBeNull();
    });

    it('a ready draw is unchanged: its own words and its Review button', async () => {
      await openList({
        day: dayWith({ approvals: [{ ...draw, waiting: null }], canApprove: true }),
      });
      const banner = within(screen.getByTestId('approval-banner'));
      expect(
        banner.getByText("Groups finished · Men's singles · Knockout bracket is ready"),
      ).toBeTruthy();
      expect(banner.getByRole('button', { name: en['matchday.approve.review'] })).toBeTruthy();
    });

    it('a list refresh that flips the draw from waiting to ready brings the Review button, and back takes it away', async () => {
      const view = await openList({ day: dayWith({ approvals: [draw], canApprove: true }) });
      expect(within(screen.getByTestId('approval-banner')).queryByRole('button')).toBeNull();
      view.matchDay.answerDay({
        ok: true,
        value: dayWith({ approvals: [{ ...draw, waiting: null }], canApprove: true }),
      });
      await settle(MATCHDAY_POLL_MS);
      const banner = within(screen.getByTestId('approval-banner'));
      expect(
        banner.getByText("Groups finished · Men's singles · Knockout bracket is ready"),
      ).toBeTruthy();
      expect(banner.getByRole('button', { name: en['matchday.approve.review'] })).toBeTruthy();
      view.matchDay.answerDay({
        ok: true,
        value: dayWith({ approvals: [draw], canApprove: true }),
      });
      await settle(MATCHDAY_POLL_MS);
      expect(within(screen.getByTestId('approval-banner')).queryByRole('button')).toBeNull();
    });
  });
});
