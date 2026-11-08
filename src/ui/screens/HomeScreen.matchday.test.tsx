import { act, fireEvent, renderHook, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { MatchDay } from '@/domain/matchday/matchDay';
import { decodeSavedCode, encodeSavedCode, type SavedCode } from '@/domain/mode/savedCode';
import { useHome } from '@/hooks/useHome';
import en from '@/i18n/en.json';
import es from '@/i18n/es.json';
import fr from '@/i18n/fr.json';
import nl from '@/i18n/nl.json';
import type { Lang } from '@/i18n/language';
import { FAKE_DAY } from '@/services/fakeMatchDayPort';
import { createMemoryKeyValueStore } from '@/services/KeyValueStore';
import { createMatchDayStore, MATCHDAY_KEYS } from '@/services/matchDayStore';
import { createModeStore, STORE_KEYS } from '@/services/modeStore';
import { HomeScreen } from '@/ui/screens/HomeScreen';
import { createFakePorts, TEST_NOW, type FakePorts } from '../../../test/fakePorts';
import { dayLink, FIXTURE_DAY_TOKEN } from '../../../test/fixtures/dayCode';
import { savedStreamCode } from '../../../test/fixtures/savedStream';
import { pairCode } from '../../../test/pairCode';
import { renderWithPorts, wrapperFor } from '../../../test/renderWithPorts';
import { FAKE_MATCH, RAW } from '../../../test/scoringHomeFixtures';

async function renderHome(options?: Parameters<typeof renderWithPorts>[1]) {
  const home = renderWithPorts(<HomeScreen />, options);
  await act(() => home.ports.modeStore.load());
  return home;
}
type Home = Awaited<ReturnType<typeof renderHome>>;

const DICTIONARY: Readonly<Record<Lang, Record<string, string>>> = { en, es, fr, nl };
const word = (lang: Lang, key: string): string => {
  const text = DICTIONARY[lang][key];
  if (text === undefined) throw new Error(`no ${key} in ${lang}`);
  return text;
};
const tileOf = (lang: Lang) => () =>
  screen.getByRole('button', { name: new RegExp(word(lang, 'mode.matchday')) });
const matchDayTile = tileOf('en');
const liveStreamTile = () => screen.getByRole('button', { name: new RegExp(en['mode.stream']) });
const scoringTile = () => screen.getByRole('button', { name: new RegExp(en['mode.scoring']) });
/** A tile under the check's panel, which hides Home from a screen reader: a tap there still lands (jsdom has no dim). */
const tileUnderPanel = (name: string) =>
  screen.getByRole('button', { name: new RegExp(name), hidden: true });

/** The code as the port is handed it: the build's origin and the made-up token. */
const DAY_CODE = { origin: 'https://stg.seazn.club', token: FIXTURE_DAY_TOKEN };
/** Saturday 7 November 2026, 00:00 in London (GMT), the fakes' phone zone. */
const OPENS_AT = new Date('2026-11-07T00:00:00.000Z');

const SAVED_DAY: SavedCode = {
  mode: 'matchday',
  raw: dayLink(),
  slot: null,
  savedAt: TEST_NOW,
  expiresAt: null,
  stream: null,
  scoring: null,
};

/** The store's contents with the day code saved and, unless `day` is null, the day's last good copy beside it. */
async function savedDay(
  options: { day?: MatchDay | null; active?: boolean } = {},
): Promise<Record<string, string>> {
  const kv = createMemoryKeyValueStore();
  if (options.day !== null) {
    await createMatchDayStore(kv).writeCache(DAY_CODE, options.day ?? FAKE_DAY, TEST_NOW);
  }
  return {
    ...Object.fromEntries(kv.entries),
    [STORE_KEYS.code('matchday')]: encodeSavedCode(SAVED_DAY),
    ...(options.active === false ? {} : { [STORE_KEYS.active]: 'matchday' }),
  };
}

/** Nothing of the day code is kept: no saved code, no active mode, no copy of a day, and the token in no stored value. */
function keptNothing(home: FakePorts): void {
  expect(home.kv.entries.has(STORE_KEYS.code('matchday'))).toBe(false);
  expect(home.kv.entries.has(STORE_KEYS.active)).toBe(false);
  expect(home.kv.entries.has(MATCHDAY_KEYS.cache)).toBe(false);
  const stored = [...home.kv.entries.values()];
  expect(stored.some((value) => value.includes(FIXTURE_DAY_TOKEN))).toBe(false);
}

const savedCodeIn = (home: FakePorts) =>
  decodeSavedCode(home.kv.entries.get(STORE_KEYS.code('matchday')) ?? '');
const dayCalls = (home: FakePorts) => home.matchDay.calls.filter((call) => call.op === 'day');
const kinds = (home: FakePorts) => home.engine.intents.map((intent) => intent.kind);
const scanDay = (home: Home, tile = matchDayTile) => {
  home.scanner.queue({ outcome: 'scanned', raw: dayLink() });
  fireEvent.click(tile());
};
const pairedStream = () => {
  const stream = savedStreamCode();
  const seed = {
    [STORE_KEYS.active]: 'stream',
    [STORE_KEYS.code('stream')]: encodeSavedCode(stream),
  };
  return { stream, seed };
};

describe('Home: the Match Day tile, with no code saved', () => {
  it('takes a tap and scans', async () => {
    const home = await renderHome();
    expect(matchDayTile().getAttribute('aria-disabled')).not.toBe('true');
    act(() => matchDayTile().click());
    await act(async () => undefined);
    expect(home.scanner.scans).toBe(1);
    expect(home.navigation.current()).toBe('home');
  });

  it.each<Lang>(['en', 'es', 'fr', 'nl'])(
    'says what it does and which code opens it in %s',
    async (lang) => {
      await renderHome({ deviceLanguages: [lang] });
      const tile = tileOf(lang)();
      expect(within(tile).getByText(word(lang, 'home.tile.matchday.purpose'))).toBeTruthy();
      expect(within(tile).getByText(word(lang, 'home.tile.matchday.hint'))).toBeTruthy();
    },
  );

  // S4 design §4 "First time"; the brief: nothing is saved before the server has answered.
  it('a first scan checks the code with the server before saving it, then saves it and opens the day', async () => {
    const home = await renderHome();
    home.matchDay.hold();
    scanDay(home);
    await screen.findByText('Checking code…');
    expect(dayCalls(home)).toEqual([{ op: 'day', code: DAY_CODE }]);
    keptNothing(home);
    act(() => home.matchDay.release());
    await waitFor(() => expect(home.navigation.current()).toBe('matchday'));
    expect(savedCodeIn(home)).toEqual(SAVED_DAY);
    expect(home.kv.entries.get(STORE_KEYS.active)).toBe('matchday');
    expect(await home.ports.matchDayStore.readCache(DAY_CODE)).toEqual({
      day: FAKE_DAY,
      at: TEST_NOW,
    });
    expect(screen.queryByText('Checking code…')).toBeNull();
  });

  // Question 3: a process death while the code is being checked leaves nothing behind to reopen.
  it('a process death between the scan and the answer keeps nothing', async () => {
    const home = await renderHome();
    home.matchDay.hold();
    scanDay(home);
    await screen.findByText('Checking code…');
    home.unmount();
    const relaunched = createModeStore(home.kv);
    await relaunched.load();
    const snapshot = relaunched.getSnapshot();
    expect(snapshot.status === 'ready' && snapshot.saved).toEqual({ active: null, codes: {} });
    keptNothing(home);
  });

  it('MD_WITHDRAWN saves nothing and shows "Match Day code withdrawn", with Scan again', async () => {
    const home = await renderHome();
    home.matchDay.answerDay({ ok: false, refusal: 'MD_WITHDRAWN' });
    scanDay(home);
    await screen.findByText('Match Day code withdrawn');
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();
    expect(home.navigation.current()).toBe('home');
    keptNothing(home);
    // Scan again scans from the Match Day tile, and the same code says the same again.
    home.scanner.queue({ outcome: 'scanned', raw: dayLink() });
    fireEvent.click(screen.getByRole('button', { name: 'Scan again' }));
    await waitFor(() => expect(dayCalls(home)).toHaveLength(2));
    await screen.findByText('Match Day code withdrawn');
    expect(home.scanner.scans).toBe(2);
    keptNothing(home);
  });

  it.each([
    ['MD_ENDED', 'Match Day ended'],
    ['MD_UNKNOWN', 'Match Day code not recognised'],
  ] as const)('%s saves nothing and says "%s"', async (refusal, line) => {
    const home = await renderHome();
    home.matchDay.answerDay({ ok: false, refusal });
    scanDay(home);
    await screen.findByText(line);
    expect(home.navigation.current()).toBe('home');
    keptNothing(home);
  });

  it.each([
    ['offline', { ok: false, offline: true }],
    ['gone', { ok: false, gone: true }],
    ['a word the scan has no use for', { ok: false, refusal: 'MD_OUT_OF_SCOPE' }],
  ] as const)(
    '%s at the first scan saves nothing and says there is no connection',
    async (_, answer) => {
      const home = await renderHome();
      home.matchDay.answerDay(answer);
      scanDay(home);
      await screen.findByText('No connection');
      expect(screen.getByText("Can't check this code — no connection. Try again.")).toBeTruthy();
      expect(home.navigation.current()).toBe('home');
      keptNothing(home);
    },
  );

  // Questions 1 and 3: Try again asks again, once for a double press, and its answer then opens the day.
  it('Try again after no connection checks the same code again, once for a double press, and opens the day', async () => {
    const home = await renderHome();
    home.matchDay.answerDay({ ok: false, offline: true });
    scanDay(home);
    await screen.findByText('No connection');
    home.matchDay.answerDay({ ok: true, value: FAKE_DAY });
    home.matchDay.hold();
    const tryAgain = screen.getByRole('button', { name: 'Try again' });
    fireEvent.click(tryAgain);
    fireEvent.click(tryAgain);
    act(() => home.matchDay.release());
    await waitFor(() => expect(home.navigation.current()).toBe('matchday'));
    expect(dayCalls(home)).toHaveLength(2);
    expect(home.scanner.scans).toBe(1);
    expect(savedCodeIn(home)?.raw).toBe(dayLink());
  });

  // Question 1: a second tap while the first scan's code is being checked starts nothing.
  it('a second tap while the code is being checked scans and asks nothing more', async () => {
    const home = await renderHome();
    home.matchDay.hold();
    scanDay(home);
    await screen.findByText('Checking code…');
    fireEvent.click(tileUnderPanel(en['mode.matchday']));
    act(() => home.matchDay.release());
    await waitFor(() => expect(home.navigation.current()).toBe('matchday'));
    expect([home.scanner.scans, dayCalls(home).length]).toEqual([1, 1]);
  });

  // Question 1, under the scan flight: the panel's Open is not under it, so the check keeps its own one-at-a-time guard.
  it('a second check of the same code while the first is in flight asks nothing more', async () => {
    const fakes = createFakePorts();
    const hook = renderHook(() => useHome(), { wrapper: wrapperFor(fakes) });
    await act(() => fakes.ports.modeStore.load());
    const code = { mode: 'matchday', raw: dayLink(), token: FIXTURE_DAY_TOKEN } as const;
    fakes.matchDay.hold();
    act(() => {
      hook.result.current.actions.openFromPanel(code);
      hook.result.current.actions.openFromPanel(code);
    });
    await act(async () => undefined);
    expect(dayCalls(fakes)).toHaveLength(1);
    act(() => fakes.matchDay.release());
    await waitFor(() => expect(fakes.navigation.current()).toBe('matchday'));
    expect(dayCalls(fakes)).toHaveLength(1);
  });

  // S4 design §3: before the day starts, the tile says when it opens and lists nothing; the code is kept.
  it('a code scanned before its day is kept, opens nothing, and the line says when it opens', async () => {
    const home = await renderHome();
    home.matchDay.answerDay({ ok: false, refusal: 'MD_NOT_OPEN', opensAt: OPENS_AT });
    scanDay(home);
    await screen.findByText('Match Day opens Sat 7 Nov');
    expect(home.navigation.current()).toBe('home');
    expect(savedCodeIn(home)).toEqual(SAVED_DAY);
    // Kept, not opened: the last mode is still the last mode.
    expect(home.kv.entries.has(STORE_KEYS.active)).toBe(false);
    expect(home.kv.entries.has(MATCHDAY_KEYS.cache)).toBe(false);
    expect(screen.queryByText('Checking code…')).toBeNull();
  });

  it('a refusal that names no opening says the day has not opened yet', async () => {
    const home = await renderHome();
    home.matchDay.answerDay({ ok: false, refusal: 'MD_NOT_OPEN' });
    scanDay(home);
    await screen.findByText("Match Day hasn't opened yet");
    expect(savedCodeIn(home)?.raw).toBe(dayLink());
  });

  it('a code kept before its day leaves a paired Live Stream alone: nothing opens, so nothing is asked', async () => {
    const { stream, seed } = pairedStream();
    const home = await renderHome({ kvSeed: seed });
    pairCode(home.engine, stream);
    home.matchDay.answerDay({ ok: false, refusal: 'MD_NOT_OPEN', opensAt: OPENS_AT });
    scanDay(home);
    await screen.findByText('Match Day opens Sat 7 Nov');
    expect(screen.queryByRole('button', { name: 'Unpair & open' })).toBeNull();
    expect(kinds(home)).toEqual(['pair']);
    expect(home.kv.entries.get(STORE_KEYS.active)).toBe('stream');
    expect(savedCodeIn(home)?.raw).toBe(dayLink());
  });

  // A7 asks before another mode unpairs Live Stream; its confirm unpairs, forgets the stream code, then opens the day.
  it('asks first while Live Stream is paired, and opens the day only on Unpair & open', async () => {
    const { stream, seed } = pairedStream();
    const home = await renderHome({ kvSeed: seed });
    pairCode(home.engine, stream);
    scanDay(home);
    const confirm = await screen.findByRole('button', { name: 'Unpair & open' });
    expect(kinds(home)).toEqual(['pair']);
    expect(home.kv.entries.get(STORE_KEYS.active)).toBe('stream');
    expect(home.kv.entries.has(STORE_KEYS.code('matchday'))).toBe(false);
    fireEvent.click(confirm);
    await waitFor(() => expect(home.navigation.current()).toBe('matchday'));
    expect(kinds(home)).toEqual(['pair', 'unpair']);
    expect(home.kv.entries.has(STORE_KEYS.code('stream'))).toBe(false);
    expect(home.kv.entries.get(STORE_KEYS.active)).toBe('matchday');
    expect(savedCodeIn(home)?.raw).toBe(dayLink());
  });

  it('keeps the pairing and opens nothing on Cancel', async () => {
    const { stream, seed } = pairedStream();
    const home = await renderHome({ kvSeed: seed });
    pairCode(home.engine, stream);
    scanDay(home);
    await screen.findByRole('button', { name: 'Unpair & open' });
    const [, cancel] = screen.getAllByRole('button', { name: 'Cancel' });
    if (cancel === undefined) throw new Error('the sheet has its own Cancel');
    fireEvent.click(cancel);
    await act(async () => undefined);
    expect(kinds(home)).toEqual(['pair']);
    expect(home.kv.entries.get(STORE_KEYS.active)).toBe('stream');
    expect(home.kv.entries.has(STORE_KEYS.code('matchday'))).toBe(false);
    expect(home.navigation.current()).toBe('home');
  });

  // Decision record ruling 2, both ways round.
  it('a day code scanned from another tile is named, and Open checks it and opens Match Day', async () => {
    const home = await renderHome();
    scanDay(home, liveStreamTile);
    await screen.findByText('This is a Match Day code');
    expect(dayCalls(home)).toEqual([]);
    fireEvent.click(screen.getByRole('button', { name: 'Open Match Day' }));
    await waitFor(() => expect(home.navigation.current()).toBe('matchday'));
    expect(dayCalls(home)).toHaveLength(1);
    expect(savedCodeIn(home)?.raw).toBe(dayLink());
  });

  it('a scoring code scanned from it offers to switch', async () => {
    const home = await renderHome();
    home.scanner.queue({ outcome: 'scanned', raw: 'https://stg.seazn.club/score/abc123' });
    fireEvent.click(matchDayTile());
    await screen.findByText('This is a Remote Scoring code');
    expect(screen.getByRole('button', { name: 'Open Remote Scoring' })).toBeTruthy();
    expect(home.navigation.current()).toBe('home');
  });

  // Question 4: every language. The dates are Node's ICU for each locale (formatDay.test.ts pins them).
  it.each<[Lang, string]>([
    ['en', 'Match Day opens Sat 7 Nov'],
    ['es', 'El Día de partidos se abre el sáb, 7 nov'],
    ['fr', 'Le Jour de match ouvre le sam. 7 nov.'],
    ['nl', 'Speeldag opent za 7 nov'],
  ])('in %s, says the code is withdrawn, and when a day opens', async (lang, opens) => {
    const home = await renderHome({ deviceLanguages: [lang] });
    home.matchDay.answerDay({ ok: false, refusal: 'MD_WITHDRAWN' });
    scanDay(home, tileOf(lang));
    await screen.findByText(word(lang, 'matchday.withdrawn'));
    fireEvent.click(screen.getByRole('button', { name: word(lang, 'panel.close') }));
    home.matchDay.answerDay({ ok: false, refusal: 'MD_NOT_OPEN', opensAt: OPENS_AT });
    scanDay(home, tileOf(lang));
    await screen.findByText(opens);
  });
});

describe('Home: the Match Day tile, with a code saved', () => {
  it('the matchday tile with a saved code opens the day without calling the scanner', async () => {
    const home = await renderHome({ kvSeed: await savedDay() });
    fireEvent.click(matchDayTile());
    await waitFor(() => expect(home.navigation.current()).toBe('matchday'));
    expect(home.scanner.scans).toBe(0);
    expect(dayCalls(home)).toEqual([{ op: 'day', code: DAY_CODE }]);
    expect(home.kv.entries.get(STORE_KEYS.active)).toBe('matchday');
  });

  it('a code kept before its day opens once the server answers it, and its day is kept', async () => {
    const home = await renderHome({ kvSeed: await savedDay({ day: null, active: false }) });
    fireEvent.click(matchDayTile());
    await waitFor(() => expect(home.navigation.current()).toBe('matchday'));
    expect(home.scanner.scans).toBe(0);
    expect(home.kv.entries.get(STORE_KEYS.active)).toBe('matchday');
    expect((await home.ports.matchDayStore.readCache(DAY_CODE))?.day).toEqual(FAKE_DAY);
  });

  // Question 3: no connection. The day opens anyway, and its list shows its last copy (S4 design §5).
  it.each([
    ['offline', { ok: false, offline: true }],
    ['gone', { ok: false, gone: true }],
  ] as const)('%s: the tile still opens the day, and keeps the code', async (_, answer) => {
    const home = await renderHome({ kvSeed: await savedDay() });
    home.matchDay.answerDay(answer);
    fireEvent.click(matchDayTile());
    await waitFor(() => expect(home.navigation.current()).toBe('matchday'));
    expect(home.scanner.scans).toBe(0);
    expect(savedCodeIn(home)?.raw).toBe(dayLink());
    expect((await home.ports.matchDayStore.readCache(DAY_CODE))?.day).toEqual(FAKE_DAY);
  });

  // S4 design §4 "The day ends": past the code's expiry, known from the last copy, so no server is asked.
  it('the tile with an ended code shows the scanner with "Match Day ended" and forgets the code', async () => {
    const home = await renderHome({ kvSeed: await savedDay() });
    act(() => home.setNow(FAKE_DAY.expiresAt));
    fireEvent.click(matchDayTile());
    await waitFor(() => expect(home.scanner.scans).toBe(1));
    await screen.findByText('Match Day ended');
    expect(dayCalls(home)).toEqual([]);
    expect(home.navigation.current()).toBe('home');
    keptNothing(home);
  });

  it('one millisecond before its end, the day still opens', async () => {
    const home = await renderHome({ kvSeed: await savedDay() });
    act(() => home.setNow(new Date(FAKE_DAY.expiresAt.getTime() - 1)));
    fireEvent.click(matchDayTile());
    await waitFor(() => expect(home.navigation.current()).toBe('matchday'));
    expect(home.scanner.scans).toBe(0);
  });

  // S4 design §4: the day ending and the organiser withdrawing the code read the same way, each with its own line.
  it.each([
    ['MD_ENDED', 'Match Day ended'],
    ['MD_WITHDRAWN', 'Match Day code withdrawn'],
    ['MD_UNKNOWN', 'Match Day code not recognised'],
  ] as const)(
    'the tile with a code the server calls %s shows the scanner with "%s" and forgets the code',
    async (refusal, line) => {
      const home = await renderHome({ kvSeed: await savedDay() });
      home.matchDay.answerDay({ ok: false, refusal });
      fireEvent.click(matchDayTile());
      await waitFor(() => expect(home.scanner.scans).toBe(1));
      await screen.findByText(line);
      expect(home.navigation.current()).toBe('home');
      keptNothing(home);
    },
  );

  it('the scan after an ended day takes the code scanned, checked as a first scan is', async () => {
    const home = await renderHome({ kvSeed: await savedDay() });
    home.matchDay.answerDay({ ok: false, refusal: 'MD_ENDED' });
    home.scanner.queue({ outcome: 'scanned', raw: dayLink() });
    fireEvent.click(matchDayTile());
    await waitFor(() => expect(dayCalls(home)).toHaveLength(2));
    expect(home.scanner.scans).toBe(1);
    // The line the tile set, and the scan's own panel over it: the same code, ended again.
    await waitFor(() => expect(screen.getAllByText('Match Day ended')).toHaveLength(2));
    keptNothing(home);
  });

  it('the tile before opens_at shows "Match Day opens Sat 7 Nov" and keeps the code', async () => {
    const home = await renderHome({ kvSeed: await savedDay({ day: null, active: false }) });
    home.matchDay.answerDay({ ok: false, refusal: 'MD_NOT_OPEN', opensAt: OPENS_AT });
    fireEvent.click(matchDayTile());
    await screen.findByText('Match Day opens Sat 7 Nov');
    expect(home.scanner.scans).toBe(0);
    expect(home.navigation.current()).toBe('home');
    expect(savedCodeIn(home)).toEqual(SAVED_DAY);
    // The check's panel goes with its answer: the line is all there is to read.
    expect(screen.queryByText('Checking code…')).toBeNull();
  });

  // Question 1: one check at a time, under the same flight as a scan.
  it('a second tap while the saved day is being checked asks nothing more', async () => {
    const home = await renderHome({ kvSeed: await savedDay() });
    home.matchDay.hold();
    fireEvent.click(matchDayTile());
    await screen.findByText('Checking code…');
    fireEvent.click(tileUnderPanel(en['mode.matchday']));
    fireEvent.click(tileUnderPanel(en['mode.stream']));
    act(() => home.matchDay.release());
    await waitFor(() => expect(home.navigation.current()).toBe('matchday'));
    expect([dayCalls(home).length, home.scanner.scans]).toEqual([1, 0]);
  });

  it('asks first while Live Stream is paired', async () => {
    const { stream, seed } = pairedStream();
    const home = await renderHome({ kvSeed: { ...(await savedDay({ active: false })), ...seed } });
    pairCode(home.engine, stream);
    fireEvent.click(matchDayTile());
    await screen.findByRole('button', { name: 'Unpair & open' });
    expect(kinds(home)).toEqual(['pair']);
    expect(home.navigation.current()).toBe('home');
  });

  // Review Focus 4 (S4 design §4: "Another kind of code scanned while Match Day is saved").
  it('a scoring code scanned while Match Day is saved opens Remote Scoring and leaves code.matchday in place', async () => {
    const seed = await savedDay();
    const home = await renderHome({ kvSeed: seed });
    home.scanner.queue({ outcome: 'scanned', raw: RAW });
    fireEvent.click(scoringTile());
    await waitFor(() => expect(home.navigation.current()).toBe('scoring'));
    expect(home.kv.entries.get(STORE_KEYS.active)).toBe('scoring');
    const scoring = decodeSavedCode(home.kv.entries.get(STORE_KEYS.code('scoring')) ?? '');
    expect(scoring?.scoring?.fixtureId).toBe(FAKE_MATCH);
    expect(home.kv.entries.get(STORE_KEYS.code('matchday'))).toBe(
      seed[STORE_KEYS.code('matchday')],
    );
    expect(home.kv.entries.get(MATCHDAY_KEYS.cache)).toBe(seed[MATCHDAY_KEYS.cache]);
    expect(dayCalls(home)).toEqual([]);
  });
});

describe('Home: the Match Day Continue card', () => {
  it('the Home Continue card reads "Match Day · SAFE Open · Hall A", and Continue opens the day with no scan', async () => {
    const home = await renderHome({ kvSeed: await savedDay() });
    const card = await screen.findByTestId('continue-card');
    expect(within(card).getByText('Match Day · SAFE Open · Hall A')).toBeTruthy();
    // Exit is under ⋯ on the day's own bar, with a confirm (S4 design §4): the card has no Forget.
    expect(within(card).queryByRole('button', { name: 'Forget' })).toBeNull();
    fireEvent.click(within(card).getByRole('button', { name: 'Continue' }));
    await waitFor(() => expect(home.navigation.current()).toBe('matchday'));
    expect(home.scanner.scans).toBe(0);
  });

  it('a code for the whole competition names the competition alone', async () => {
    const whole: MatchDay = { ...FAKE_DAY, scope: { kind: 'competition', label: 'SAFE Open' } };
    await renderHome({ kvSeed: await savedDay({ day: whole }) });
    const card = await screen.findByTestId('continue-card');
    expect(within(card).getByText('Match Day · SAFE Open')).toBeTruthy();
  });

  // Question 2: nothing to say, no card. The day's copy belongs to its code: a new code never shows an old day.
  it('shows no card with no code, no copy of its day, a copy of another code’s day, or a day that has ended', async () => {
    const other = createMemoryKeyValueStore();
    const elsewhere = {
      origin: DAY_CODE.origin,
      token: 'md_Other-Day_0123456789abcdefghijklmnopqrstuv',
    };
    await createMatchDayStore(other).writeCache(elsewhere, FAKE_DAY, TEST_NOW);
    const cases: Record<string, string>[] = [
      {},
      await savedDay({ day: null }),
      { ...(await savedDay({ day: null })), ...Object.fromEntries(other.entries) },
      await savedDay({ day: { ...FAKE_DAY, expiresAt: TEST_NOW } }),
    ];
    for (const kvSeed of cases) {
      const home = await renderHome({ kvSeed });
      await act(async () => undefined);
      expect(screen.queryByTestId('continue-card')).toBeNull();
      home.unmount();
    }
    expect(cases).toHaveLength(4);
  });

  it('goes with the code: a day the server ends forgets it, and the card leaves', async () => {
    const home = await renderHome({ kvSeed: await savedDay() });
    await screen.findByTestId('continue-card');
    home.matchDay.answerDay({ ok: false, refusal: 'MD_ENDED' });
    fireEvent.click(matchDayTile());
    await screen.findByText('Match Day ended');
    expect(screen.queryByTestId('continue-card')).toBeNull();
  });

  it.each<[Lang, string]>([
    ['en', 'Match Day · SAFE Open · Hall A'],
    ['es', 'Día de partidos · SAFE Open · Hall A'],
    ['fr', 'Jour de match · SAFE Open · Hall A'],
    ['nl', 'Speeldag · SAFE Open · Hall A'],
  ])('reads in %s', async (lang, title) => {
    await renderHome({ kvSeed: await savedDay(), deviceLanguages: [lang] });
    const card = await screen.findByTestId('continue-card');
    expect(within(card).getByText(title)).toBeTruthy();
    const open = word(lang, 'home.continue.open');
    expect(within(card).getByRole('button', { name: open })).toBeTruthy();
  });
});
