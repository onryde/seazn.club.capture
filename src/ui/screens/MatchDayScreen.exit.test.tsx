import { act, fireEvent, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MatchDay } from '@/domain/matchday/matchDay';
import { encodeSavedCode, type SavedCode } from '@/domain/mode/savedCode';
import type { Lang } from '@/i18n/language';
import en from '@/i18n/en.json';
import es from '@/i18n/es.json';
import fr from '@/i18n/fr.json';
import nl from '@/i18n/nl.json';
import { FAKE_DAY, FAKE_REVIEW, FAKE_STAGE } from '@/services/fakeMatchDayPort';
import { MATCHDAY_KEYS } from '@/services/matchDayStore';
import { STORE_KEYS } from '@/services/modeStore';
import { MatchDayScreen } from '@/ui/screens/MatchDayScreen';
import { TEST_NOW, type FakePorts } from '../../../test/fakePorts';
import { dayLink } from '../../../test/fixtures/dayCode';
import { renderWithPorts } from '../../../test/renderWithPorts';
import { queueHolding } from '../../../test/scoringHomeFixtures';

// MD-2 Task 7 on the list: ⋯ holds Exit (S4 design §4), the question it asks, and the bounce after an overlay closes
// (T6 fix c1): a touch, or an Android Back, that lands within 250 ms of the approval overlay or Exit's question closing
// does nothing to the list beneath. What the phone draws, and a real thumb, are Task 8's.

const DICTIONARY: Readonly<Record<Lang, Record<string, string>>> = { en, es, fr, nl };
const word = (lang: Lang, key: string): string => DICTIONARY[lang][key] as string;
const SAVED_DAY: SavedCode = {
  mode: 'matchday',
  raw: dayLink(),
  slot: null,
  savedAt: TEST_NOW,
  expiresAt: null,
  stream: null,
  scoring: null,
};
const NG = FAKE_DAY.courts[0]?.now?.fixtureId ?? '';
const WAITING: MatchDay = {
  ...FAKE_DAY,
  canApprove: true,
  canCall: false,
  approvals: [
    {
      kind: 'swiss',
      stageId: FAKE_STAGE,
      divisionName: "Men's singles",
      label: 'Swiss',
      round: 4,
      waiting: null,
    },
  ],
};

type Open = {
  readonly lang?: Lang;
  readonly day?: MatchDay;
  readonly taps?: number;
  readonly prepare?: (fakes: FakePorts) => void | Promise<void>;
};

async function openList(open: Open = {}) {
  const view = renderWithPorts(<MatchDayScreen />, {
    kvSeed: {
      [STORE_KEYS.code('matchday')]: encodeSavedCode(SAVED_DAY),
      [STORE_KEYS.active]: 'matchday',
      [MATCHDAY_KEYS.opened]: JSON.stringify([NG]),
    },
    deviceLanguages: [open.lang ?? 'en'],
    // A clock that moves with the fake timers, for the 250 ms after a cover closes.
    clock: () => new Date(),
  });
  view.matchDay.answerDay({ ok: true, value: open.day ?? FAKE_DAY });
  view.matchDay.answerReview({ ok: true, value: FAKE_REVIEW });
  if ((open.taps ?? 0) > 0) await view.tapQueue.save(queueHolding(NG, open.taps ?? 0));
  await open.prepare?.(view);
  act(() => view.navigation.go('matchday'));
  await act(() => view.ports.modeStore.load());
  await settle();
  return view;
}

const settle = (ms = 0) => act(() => vi.advanceTimersByTimeAsync(ms));
const more = (lang: Lang = 'en') =>
  screen.getByRole('button', { name: word(lang, 'matchday.menu') });
const press = async (button: HTMLElement) => {
  fireEvent.click(button);
  await settle();
};
const pressBack = (view: FakePorts): boolean => {
  let handled = false;
  act(() => {
    handled = view.back.press();
  });
  return handled;
};
const sheet = () => screen.queryByTestId('exit-confirm');
const opens = (view: FakePorts) => view.matchDay.calls.filter((call) => call.op === 'open');

beforeEach(() => vi.useFakeTimers({ now: TEST_NOW }));
afterEach(() => vi.useRealTimers());

describe('⋯ holds Exit', () => {
  it('shows ⋯ in the top bar, named More, 48 dp, after the title', async () => {
    await openList();
    const button = more();
    expect(getComputedStyle(button).height).toBe('48px');
    const bar = screen.getByText(en['mode.matchday']).parentElement as HTMLElement;
    expect(bar.lastElementChild).toBe(button);
  });

  it('is there with no day to list, offline, so a stuck code can still be left', async () => {
    await openList({ prepare: (fakes) => fakes.matchDay.answerDay({ ok: false, offline: true }) });
    expect(screen.getByText(en['matchday.offlineEmpty'])).toBeTruthy();
    expect(more()).toBeTruthy();
  });

  it('a press asks the question and changes nothing else', async () => {
    const view = await openList();
    expect(sheet()).toBeNull();
    await press(more());
    expect(sheet()).not.toBeNull();
    expect(screen.getByText('Exit Match Day?')).toBeTruthy();
    expect(screen.getByText("You'll need to scan again.")).toBeTruthy();
    expect(view.navigation.current()).toBe('matchday');
  });

  it('says how many taps will keep sending, from the opened matches’ queues', async () => {
    await openList({ taps: 3 });
    await press(more());
    expect(screen.getByText("3 taps still sending — they'll keep sending.")).toBeTruthy();
  });

  it('a queue it cannot read is taps at risk, not the plain body', async () => {
    await openList({
      prepare: (fakes) => {
        fakes.queueFiles.files.set(`${NG}.json`, '{garbled');
      },
    });
    await press(more());
    expect(screen.getByText(en['matchday.exit.bodyAtRisk'])).toBeTruthy();
    expect(screen.queryByText(en['matchday.exit.body'])).toBeNull();
  });

  it('covers the list for a screen reader while it is up, and gives it back on Stay', async () => {
    await openList();
    await press(more());
    expect(screen.queryByRole('button', { name: en['stream.home'] })).toBeNull();
    expect(screen.queryByRole('button', { name: en['matchday.menu'] })).toBeNull();
    await press(screen.getByRole('button', { name: 'Stay' }));
    expect(screen.getByRole('button', { name: en['stream.home'] })).toBeTruthy();
  });

  it.each(['es', 'fr', 'nl'] as const)('asks in %s from its dictionary', async (lang) => {
    await openList({ lang });
    await press(more(lang));
    const title = word(lang, 'matchday.exit.title').replace(/ /g, ' ');
    expect(screen.getByText(title)).toBeTruthy();
    expect(screen.getByRole('button', { name: word(lang, 'matchday.exit.stay') })).toBeTruthy();
  });

  it('a double tap on ⋯ asks once', async () => {
    await openList();
    fireEvent.click(more());
    fireEvent.click(more());
    await settle();
    expect(screen.getAllByTestId('exit-confirm')).toHaveLength(1);
  });
});

describe('Stay', () => {
  it('changes nothing: the code, the opened matches and the list stay', async () => {
    const view = await openList({ taps: 2 });
    await press(more());
    await press(screen.getByRole('button', { name: 'Stay' }));
    expect(sheet()).toBeNull();
    expect(view.kv.entries.has(STORE_KEYS.code('matchday'))).toBe(true);
    expect(await view.ports.matchDayStore.opened()).toEqual([NG]);
    expect(view.navigation.current()).toBe('matchday');
    expect(screen.getByText('Ng v Brown')).toBeTruthy();
  });

  it('the dim stays too', async () => {
    const view = await openList();
    await press(more());
    await press(screen.getByTestId('exit-dim'));
    expect(sheet()).toBeNull();
    expect(view.navigation.current()).toBe('matchday');
  });

  it('a touch within 250 ms of it closing does nothing beneath: not a row, not ⋯, not Back', async () => {
    const view = await openList();
    await press(more());
    await press(screen.getByRole('button', { name: 'Stay' }));
    await settle(100);
    fireEvent.click(screen.getByRole('button', { name: /^R2, Now, Ng v Brown/ }));
    fireEvent.click(more());
    fireEvent.click(screen.getByRole('button', { name: en['stream.home'] }));
    await settle();
    expect(opens(view)).toHaveLength(0);
    expect(sheet()).toBeNull();
    expect(view.navigation.current()).toBe('matchday');
  });

  it('the same touches land once the window has passed', async () => {
    const view = await openList();
    await press(more());
    await press(screen.getByRole('button', { name: 'Stay' }));
    await settle(260);
    fireEvent.click(screen.getByRole('button', { name: /^R2, Now, Ng v Brown/ }));
    await settle();
    expect(opens(view)).toHaveLength(1);
    await press(more());
    expect(sheet()).not.toBeNull();
  });
});

describe('Exit', () => {
  it('forgets the day code, lets go of the opened matches and goes Home', async () => {
    const view = await openList({ taps: 3 });
    await press(more());
    await press(screen.getByRole('button', { name: 'Exit' }));
    expect(view.navigation.current()).toBe('home');
    expect(view.kv.entries.has(STORE_KEYS.code('matchday'))).toBe(false);
    expect(view.kv.entries.has(MATCHDAY_KEYS.opened)).toBe(false);
    // The taps are the queue's, and stay.
    expect((await view.tapQueue.load(NG))?.pending).toHaveLength(3);
  });

  it('a double tap on Exit leaves once', async () => {
    const view = await openList({ taps: 1 });
    await press(more());
    const go = vi.spyOn(view.navigation, 'go');
    const exit = screen.getByRole('button', { name: 'Exit' });
    fireEvent.click(exit);
    fireEvent.click(exit);
    await settle();
    expect(go.mock.calls.filter(([route]) => route === 'home')).toHaveLength(2);
    expect(view.record.lines().filter((line) => line.includes('matchday.exit'))).toHaveLength(1);
  });
});

describe('Android Back and the bounce (T6 fix c1)', () => {
  it('Back on the list goes Home, as it always did', async () => {
    const view = await openList();
    expect(pressBack(view)).toBe(true);
    expect(view.navigation.current()).toBe('home');
  });

  it('Back with the question up means Stay, and a second Back within 250 ms does nothing', async () => {
    const view = await openList();
    await press(more());
    expect(pressBack(view)).toBe(true);
    await settle();
    expect(sheet()).toBeNull();
    expect(view.navigation.current()).toBe('matchday');
    await settle(80);
    expect(pressBack(view)).toBe(true);
    expect(view.navigation.current()).toBe('matchday');
    await settle(200);
    expect(pressBack(view)).toBe(true);
    expect(view.navigation.current()).toBe('home');
  });

  it('Back that closes the approval overlay, and a second Back within 250 ms, stay on the list', async () => {
    const view = await openList({ day: WAITING });
    await press(screen.getByRole('button', { name: en['matchday.approve.review'] }));
    expect(screen.getByTestId('approval-screen')).toBeTruthy();
    expect(pressBack(view)).toBe(true);
    await settle();
    expect(screen.queryByTestId('approval-screen')).toBeNull();
    await settle(80);
    expect(pressBack(view)).toBe(true);
    expect(view.navigation.current()).toBe('matchday');
    await settle(200);
    expect(pressBack(view)).toBe(true);
    expect(view.navigation.current()).toBe('home');
  });

  it('a Back with nothing closed just before it goes Home at once (the guard is only for a bounce)', async () => {
    const view = await openList();
    await settle(5_000);
    expect(pressBack(view)).toBe(true);
    expect(view.navigation.current()).toBe('home');
  });
});
