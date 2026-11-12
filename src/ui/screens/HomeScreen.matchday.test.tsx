import { act, fireEvent, renderHook, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NO_PICKS } from '@/domain/scoring/pendingPicks';
import { SINGLES_SEED } from '@/services/fakeScoringPort';
import { readScoringLink, saveScoringLink } from '@/services/scoringLinkStore';
import { FAKE_SCORING_SECRET } from '../../../test/fakeScoringLinkPort';
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
import { createLogger } from '@/services/logger';
import { createMatchDayStore } from '@/services/matchDayStore';
import { createRingRecord } from '@/services/sessionRecord';
import { createModeStore, STORE_KEYS } from '@/services/modeStore';
import { HomeScreen } from '@/ui/screens/HomeScreen';
import { createFakePorts, readRecord, TEST_NOW, type FakePorts } from '../../../test/fakePorts';
import { dayLink, FIXTURE_DAY_TOKEN } from '../../../test/fixtures/dayCode';
import { savedStreamCode } from '../../../test/fixtures/savedStream';
import { pairCode } from '../../../test/pairCode';
import { refusingStore } from '../../../test/refusingStore';
import { renderWithPorts, wrapperFor } from '../../../test/renderWithPorts';
import { createMemoryQueueFiles } from '../../../test/memoryQueueFiles';
import { FAKE_MATCH, queueHolding, RAW } from '../../../test/scoringHomeFixtures';

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

/** Match Day's folder holding a copy of `day` for `code`, as the real store writes it. */
async function dayCopy(
  code: typeof DAY_CODE,
  day: MatchDay = FAKE_DAY,
): Promise<Record<string, string>> {
  const files = createMemoryQueueFiles();
  const logger = createLogger({ record: createRingRecord(), now: () => 0 });
  const store = createMatchDayStore({ kv: createMemoryKeyValueStore(), files, logger });
  await store.writeCache(code, day, TEST_NOW);
  return Object.fromEntries(files.files);
}

type Seed = { kvSeed: Record<string, string>; dayFilesSeed: Record<string, string> };

/** The phone with the day code saved and, unless `day` is null, the day's last good copy in its folder. */
async function savedDay(options: { day?: MatchDay | null; active?: boolean } = {}): Promise<Seed> {
  return {
    kvSeed: {
      [STORE_KEYS.code('matchday')]: encodeSavedCode(SAVED_DAY),
      ...(options.active === false ? {} : { [STORE_KEYS.active]: 'matchday' }),
    },
    dayFilesSeed: options.day === null ? {} : await dayCopy(DAY_CODE, options.day),
  };
}

/** Nothing of the day code is kept: no saved code, no active mode, no copy of a day, and the token in no stored value. */
function keptNothing(home: FakePorts): void {
  expect(home.kv.entries.has(STORE_KEYS.code('matchday'))).toBe(false);
  expect(home.kv.entries.has(STORE_KEYS.active)).toBe(false);
  expect(home.dayFiles.files.size).toBe(0);
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
    expect(home.dayFiles.files.size).toBe(0);
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
    const home = await renderHome(await savedDay());
    fireEvent.click(matchDayTile());
    await waitFor(() => expect(home.navigation.current()).toBe('matchday'));
    expect(home.scanner.scans).toBe(0);
    expect(dayCalls(home)).toEqual([{ op: 'day', code: DAY_CODE }]);
    expect(home.kv.entries.get(STORE_KEYS.active)).toBe('matchday');
  });

  it('a code kept before its day opens once the server answers it, and its day is kept', async () => {
    const home = await renderHome(await savedDay({ day: null, active: false }));
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
    const home = await renderHome(await savedDay());
    home.matchDay.answerDay(answer);
    fireEvent.click(matchDayTile());
    await waitFor(() => expect(home.navigation.current()).toBe('matchday'));
    expect(home.scanner.scans).toBe(0);
    expect(savedCodeIn(home)?.raw).toBe(dayLink());
    expect((await home.ports.matchDayStore.readCache(DAY_CODE))?.day).toEqual(FAKE_DAY);
  });

  // S4 design §4 "The day ends": past the code's expiry, known from the last copy, so no server is asked.
  it('the tile with an ended code shows the scanner with "Match Day ended" and forgets the code', async () => {
    const home = await renderHome(await savedDay());
    act(() => home.setNow(FAKE_DAY.expiresAt));
    fireEvent.click(matchDayTile());
    await waitFor(() => expect(home.scanner.scans).toBe(1));
    await screen.findByText('Match Day ended');
    expect(dayCalls(home)).toEqual([]);
    expect(home.navigation.current()).toBe('home');
    keptNothing(home);
  });

  it('one millisecond before its end, the day still opens', async () => {
    const home = await renderHome(await savedDay());
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
      const home = await renderHome(await savedDay());
      home.matchDay.answerDay({ ok: false, refusal });
      fireEvent.click(matchDayTile());
      await waitFor(() => expect(home.scanner.scans).toBe(1));
      await screen.findByText(line);
      expect(home.navigation.current()).toBe('home');
      keptNothing(home);
    },
  );

  it('the scan after an ended day takes the code scanned, checked as a first scan is', async () => {
    const home = await renderHome(await savedDay());
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
    const home = await renderHome(await savedDay({ day: null, active: false }));
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
    const home = await renderHome(await savedDay());
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
    const day = await savedDay({ active: false });
    const home = await renderHome({ ...day, kvSeed: { ...day.kvSeed, ...seed } });
    pairCode(home.engine, stream);
    fireEvent.click(matchDayTile());
    await screen.findByRole('button', { name: 'Unpair & open' });
    expect(kinds(home)).toEqual(['pair']);
    expect(home.navigation.current()).toBe('home');
  });

  // Review Focus 4 (S4 design §4: "Another kind of code scanned while Match Day is saved").
  it('a scoring code scanned while Match Day is saved opens Remote Scoring and leaves code.matchday in place', async () => {
    const seed = await savedDay();
    const home = await renderHome(seed);
    home.scanner.queue({ outcome: 'scanned', raw: RAW });
    fireEvent.click(scoringTile());
    await waitFor(() => expect(home.navigation.current()).toBe('scoring'));
    expect(home.kv.entries.get(STORE_KEYS.active)).toBe('scoring');
    const scoring = decodeSavedCode(home.kv.entries.get(STORE_KEYS.code('scoring')) ?? '');
    expect(scoring?.scoring?.fixtureId).toBe(FAKE_MATCH);
    expect(home.kv.entries.get(STORE_KEYS.code('matchday'))).toBe(
      seed.kvSeed[STORE_KEYS.code('matchday')],
    );
    expect(Object.fromEntries(home.dayFiles.files)).toEqual(seed.dayFilesSeed);
    expect(dayCalls(home)).toEqual([]);
  });
});

/** A second day code, made up: `md_` and 43 characters, as the web mints them. */
const OTHER_TOKEN = 'md_Other-Day_0123456789abcdefghijklmnopqrstuvw';
const OTHER_DAY_CODE = { origin: DAY_CODE.origin, token: OTHER_TOKEN };
const SAVE_FAILED = en['store.saveFailed'];
const savedModeCodes = (home: FakePorts) => {
  const snapshot = home.ports.modeStore.getSnapshot();
  return snapshot.status === 'ready' ? snapshot.saved.codes : null;
};

describe('Home: Match Day when the phone or the port lets it down (questions 2 and 3)', () => {
  const rejections: unknown[] = [];
  const onRejection = (reason: unknown) => rejections.push(reason);
  beforeEach(() => {
    rejections.length = 0;
    process.on('unhandledRejection', onRejection);
  });
  afterEach(() => {
    process.off('unhandledRejection', onRejection);
  });
  const every = () => true;

  // Review I1: a port that throws is no answer. "Checking code…" never stays (its Close is refused while it shows).
  it('a port that throws at the first scan is no connection: the check’s panel goes, Close closes, nothing is kept', async () => {
    const home = await renderHome();
    home.matchDay.throwNext();
    scanDay(home);
    await screen.findByText('No connection');
    expect(screen.queryByText('Checking code…')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(screen.queryByText('No connection')).toBeNull();
    keptNothing(home);
    expect(readRecord(home.record)).toContainEqual(
      expect.objectContaining({
        event: 'matchday.answer',
        fields: { op: 'day', kind: 'offline', problem: 'port-threw' },
      }),
    );
    expect(rejections).toEqual([]);
  });

  it('a port that throws on the tile opens the day anyway, as no connection does', async () => {
    const home = await renderHome(await savedDay());
    home.matchDay.throwNext();
    fireEvent.click(matchDayTile());
    await waitFor(() => expect(home.navigation.current()).toBe('matchday'));
    expect(screen.queryByText('Checking code…')).toBeNull();
    expect(home.scanner.scans).toBe(0);
    expect(rejections).toEqual([]);
  });

  // A refused forget says so and scans nothing: the code stays, so the next tap tries again.
  it.each([
    ['ended by its copy', null],
    ['ended by the server', 'MD_ENDED'],
  ] as const)(
    'a code %s that the phone refuses to forget says so, keeps the code and its copy, and scans nothing',
    async (_, refusal) => {
      const seed = await savedDay();
      const home = await renderHome({ ...seed, modeStore: refusingStore(seed.kvSeed, every) });
      if (refusal === null) act(() => home.setNow(FAKE_DAY.expiresAt));
      else home.matchDay.answerDay({ ok: false, refusal });
      fireEvent.click(matchDayTile());
      await screen.findByText(SAVE_FAILED);
      expect(home.scanner.scans).toBe(0);
      expect(savedModeCodes(home)?.matchday?.raw).toBe(dayLink());
      expect(Object.fromEntries(home.dayFiles.files)).toEqual(seed.dayFilesSeed);
      expect(readRecord(home.record)).toContainEqual(
        expect.objectContaining({ event: 'store.write-refused', fields: { action: 'forget' } }),
      );
      expect(rejections).toEqual([]);
    },
  );

  it('a code scanned before its day that the phone refuses to keep says so, and keeps nothing', async () => {
    const home = await renderHome({ modeStore: refusingStore({}, every) });
    home.matchDay.answerDay({ ok: false, refusal: 'MD_NOT_OPEN', opensAt: OPENS_AT });
    scanDay(home);
    await screen.findByText(SAVE_FAILED);
    expect(screen.queryByText('Match Day opens Sat 7 Nov')).toBeNull();
    expect(savedModeCodes(home)).toEqual({});
    expect(home.navigation.current()).toBe('home');
    expect(readRecord(home.record)).toContainEqual(
      expect.objectContaining({ event: 'store.write-refused', fields: { action: 'open' } }),
    );
    expect(rejections).toEqual([]);
  });

  // The copy is a convenience: a disk that refuses it never stops the day.
  it('a copy the disk refuses to write is recorded, and the day still opens', async () => {
    const home = await renderHome();
    home.dayFiles.failNext('write');
    scanDay(home);
    await waitFor(() => expect(home.navigation.current()).toBe('matchday'));
    expect(savedCodeIn(home)?.raw).toBe(dayLink());
    await waitFor(() =>
      expect(readRecord(home.record)).toContainEqual(
        expect.objectContaining({ event: 'matchday.cache-refused', fields: { op: 'write' } }),
      ),
    );
    expect(home.dayFiles.files.size).toBe(0);
    expect(rejections).toEqual([]);
  });

  it('a copy the disk refuses to clear is recorded, and the code still goes and the scanner still opens', async () => {
    const home = await renderHome(await savedDay());
    home.matchDay.answerDay({ ok: false, refusal: 'MD_ENDED' });
    home.dayFiles.failNext('remove');
    fireEvent.click(matchDayTile());
    await waitFor(() => expect(home.scanner.scans).toBe(1));
    await screen.findByText('Match Day ended');
    expect(home.kv.entries.has(STORE_KEYS.code('matchday'))).toBe(false);
    expect(readRecord(home.record)).toContainEqual(
      expect.objectContaining({ event: 'matchday.cache-refused', fields: { op: 'clear' } }),
    );
    expect(rejections).toEqual([]);
  });
});

describe('Home: a second day code while one is saved', () => {
  // Review M1: a code's copy is written only once the code is saved, so a scan that goes no further never costs the
  // saved code its copy (its card and its offline list).
  it('a scanned code B never writes over saved code A’s copy when A7 is cancelled', async () => {
    const { stream, seed } = pairedStream();
    const day = await savedDay({ active: false });
    const home = await renderHome({ ...day, kvSeed: { ...day.kvSeed, ...seed } });
    pairCode(home.engine, stream);
    home.scanner.queue({ outcome: 'scanned', raw: dayLink('stg.seazn.club', OTHER_TOKEN) });
    fireEvent.click(liveStreamTile());
    fireEvent.click(await screen.findByRole('button', { name: 'Open Match Day' }));
    await screen.findByRole('button', { name: 'Unpair & open' });
    expect(dayCalls(home).map((call) => call.code)).toEqual([OTHER_DAY_CODE]);
    const [, cancel] = screen.getAllByRole('button', { name: 'Cancel' });
    if (cancel === undefined) throw new Error('the sheet has its own Cancel');
    fireEvent.click(cancel);
    await act(async () => undefined);
    expect(savedCodeIn(home)?.raw).toBe(dayLink());
    expect(Object.fromEntries(home.dayFiles.files)).toEqual(day.dayFilesSeed);
    expect((await home.ports.matchDayStore.readCache(DAY_CODE))?.day).toEqual(FAKE_DAY);
  });

  // Review M3: the button says Scan again, so it scans, even with another day code saved.
  it('Scan again on a refused code B scans, and never opens saved code A’s day', async () => {
    const home = await renderHome(await savedDay());
    home.scanner.queue({ outcome: 'scanned', raw: dayLink('stg.seazn.club', OTHER_TOKEN) });
    home.matchDay.answerDay({ ok: false, refusal: 'MD_WITHDRAWN' });
    fireEvent.click(liveStreamTile());
    fireEvent.click(await screen.findByRole('button', { name: 'Open Match Day' }));
    await screen.findByText('Match Day code withdrawn');
    home.matchDay.answerDay({ ok: true, value: FAKE_DAY });
    fireEvent.click(screen.getByRole('button', { name: 'Scan again' }));
    await waitFor(() => expect(home.scanner.scans).toBe(2));
    await act(async () => undefined);
    expect(home.navigation.current()).toBe('home');
    expect(dayCalls(home).map((call) => call.code)).toEqual([OTHER_DAY_CODE]);
    expect(savedCodeIn(home)?.raw).toBe(dayLink());
  });
});

// Final review M2 (on I1's path): a different day code saved lets go of what the first one opened. A match viewed and
// never tapped goes, link and boot cache; one with taps keeps its link for S2's tidy rule. The same code again, or one
// that is refused, lets go of nothing.
describe('Home: a different day code lets go of the first one’s opened matches (final review M2)', () => {
  const VIEWED = SINGLES_SEED.fixtureId;
  const TAPPED = 'fake-doubles';
  const LINK = { origin: 'https://stg.seazn.club', token: FAKE_SCORING_SECRET };
  const HOST = 'stg.seazn.club';

  /** Saved code A, which opened VIEWED (link and boot cache, never tapped) and TAPPED (a tap held back). */
  async function openedUnderA(): Promise<Home> {
    const home = await renderHome(await savedDay({ active: false }));
    for (const id of [VIEWED, TAPPED]) {
      await saveScoringLink(home.kv, id, LINK, HOST, 'badminton');
      await home.ports.matchDayStore.addOpened(id);
    }
    const read = await home.scoring.bootstrap(LINK);
    if (read.kind !== 'ok') throw new Error('the fake serves the match');
    await home.tapQueue.saveBoot(VIEWED, {
      bootstrap: read.bootstrap,
      toss: null,
      picks: NO_PICKS,
    });
    await home.tapQueue.save(queueHolding(TAPPED, 1, { askedAbout: [`${TAPPED}-k0`] }));
    return home;
  }
  const linkOf = async (home: FakePorts, id: string) =>
    (await readScoringLink(home.kv, id, HOST)).kind;
  const scanFromStream = async (home: Home, token: string) => {
    home.scanner.queue({ outcome: 'scanned', raw: dayLink('stg.seazn.club', token) });
    fireEvent.click(liveStreamTile());
    fireEvent.click(await screen.findByRole('button', { name: 'Open Match Day' }));
  };

  it('code B opened: the match A viewed goes, link and boot cache; the one with taps keeps its link', async () => {
    const home = await openedUnderA();
    await scanFromStream(home, OTHER_TOKEN);
    await waitFor(() => expect(home.navigation.current()).toBe('matchday'));
    await waitFor(async () => expect(await linkOf(home, VIEWED)).toBe('none'));
    expect(await home.tapQueue.loadBoot(VIEWED)).toBeNull();
    expect(await linkOf(home, TAPPED)).toBe('link');
    expect(await home.ports.matchDayStore.opened()).toEqual([]);
  });

  it('code B kept before its day: the same', async () => {
    const home = await openedUnderA();
    home.matchDay.answerDay({ ok: false, refusal: 'MD_NOT_OPEN', opensAt: OPENS_AT });
    await scanFromStream(home, OTHER_TOKEN);
    await screen.findByText('Match Day opens Sat 7 Nov');
    await waitFor(async () => expect(await linkOf(home, VIEWED)).toBe('none'));
    expect(await linkOf(home, TAPPED)).toBe('link');
    expect(await home.ports.matchDayStore.opened()).toEqual([]);
  });

  it('code A scanned again lets go of nothing', async () => {
    const home = await openedUnderA();
    await scanFromStream(home, FIXTURE_DAY_TOKEN);
    await waitFor(() => expect(home.navigation.current()).toBe('matchday'));
    await act(async () => undefined);
    expect(await linkOf(home, VIEWED)).toBe('link');
    expect(await home.ports.matchDayStore.opened()).toEqual([VIEWED, TAPPED]);
  });

  it('code B refused lets go of nothing: A stays saved with its matches', async () => {
    const home = await openedUnderA();
    home.matchDay.answerDay({ ok: false, refusal: 'MD_WITHDRAWN' });
    await scanFromStream(home, OTHER_TOKEN);
    await screen.findByText('Match Day code withdrawn');
    await act(async () => undefined);
    expect(savedCodeIn(home)?.raw).toBe(dayLink());
    expect(await linkOf(home, VIEWED)).toBe('link');
    expect(await home.ports.matchDayStore.opened()).toEqual([VIEWED, TAPPED]);
  });

  it('code B left at A7’s Cancel lets go of nothing: A stays saved with its matches', async () => {
    const { stream, seed } = pairedStream();
    const home = await openedUnderA();
    await home.kv.set(STORE_KEYS.code('stream'), seed[STORE_KEYS.code('stream')]);
    await home.kv.set(STORE_KEYS.active, 'stream');
    await act(() => home.ports.modeStore.load());
    pairCode(home.engine, stream);
    await scanFromStream(home, OTHER_TOKEN);
    await screen.findByRole('button', { name: 'Unpair & open' });
    const [, cancel] = screen.getAllByRole('button', { name: 'Cancel' });
    if (cancel === undefined) throw new Error('the sheet has its own Cancel');
    fireEvent.click(cancel);
    await act(async () => undefined);
    expect(savedCodeIn(home)?.raw).toBe(dayLink());
    expect(await linkOf(home, VIEWED)).toBe('link');
    expect(await home.ports.matchDayStore.opened()).toEqual([VIEWED, TAPPED]);
  });

  it('a first code with a list an Exit left behind (no code saved) lets go of it too', async () => {
    const home = await openedUnderA();
    await home.kv.delete(STORE_KEYS.code('matchday'));
    await act(() => home.ports.modeStore.load());
    scanDay(home);
    await waitFor(() => expect(home.navigation.current()).toBe('matchday'));
    await waitFor(async () => expect(await linkOf(home, VIEWED)).toBe('none'));
    expect(await linkOf(home, TAPPED)).toBe('link');
    expect(await home.ports.matchDayStore.opened()).toEqual([]);
  });

  it('a let-go the phone refuses is recorded, and code B still opens', async () => {
    const home = await openedUnderA();
    const refuse = vi
      .spyOn(home.ports.matchDayStore, 'clearOpened')
      .mockRejectedValue(new Error('refused'));
    await scanFromStream(home, OTHER_TOKEN);
    await waitFor(() => expect(home.navigation.current()).toBe('matchday'));
    await waitFor(() =>
      expect(readRecord(home.record).some((l) => l.event === 'matchday.let-go-refused')).toBe(true),
    );
    expect(savedCodeIn(home)?.raw).toBe(dayLink('stg.seazn.club', OTHER_TOKEN));
    refuse.mockRestore();
  });
});

describe('Home: the Match Day Continue card', () => {
  it('the Home Continue card reads "Match Day · SAFE Open · Hall A", and Continue opens the day with no scan', async () => {
    const home = await renderHome(await savedDay());
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
    await renderHome(await savedDay({ day: whole }));
    const card = await screen.findByTestId('continue-card');
    expect(within(card).getByText('Match Day · SAFE Open')).toBeTruthy();
  });

  // Question 2: nothing to say, no card. The day's copy belongs to its code: a new code never shows an old day.
  it('shows no card with no code, no copy of its day, a copy of another code’s day, or a day that has ended', async () => {
    const elsewhere = {
      origin: DAY_CODE.origin,
      token: 'md_Other-Day_0123456789abcdefghijklmnopqrstuv',
    };
    const cases: Seed[] = [
      { kvSeed: {}, dayFilesSeed: {} },
      await savedDay({ day: null }),
      { ...(await savedDay({ day: null })), dayFilesSeed: await dayCopy(elsewhere) },
      await savedDay({ day: { ...FAKE_DAY, expiresAt: TEST_NOW } }),
    ];
    for (const seed of cases) {
      const home = await renderHome(seed);
      await act(async () => undefined);
      expect(screen.queryByTestId('continue-card')).toBeNull();
      home.unmount();
    }
    expect(cases).toHaveLength(4);
  });

  it('goes with the code: a day the server ends forgets it, and the card leaves', async () => {
    const home = await renderHome(await savedDay());
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
    await renderHome({ ...(await savedDay()), deviceLanguages: [lang] });
    const card = await screen.findByTestId('continue-card');
    expect(within(card).getByText(title)).toBeTruthy();
    const open = word(lang, 'home.continue.open');
    expect(within(card).getByRole('button', { name: open })).toBeTruthy();
  });
});
