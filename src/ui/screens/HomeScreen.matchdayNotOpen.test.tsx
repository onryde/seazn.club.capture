import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MatchDay } from '@/domain/matchday/matchDay';
import { decodeSavedCode, encodeSavedCode, type SavedCode } from '@/domain/mode/savedCode';
import en from '@/i18n/en.json';
import es from '@/i18n/es.json';
import fr from '@/i18n/fr.json';
import nl from '@/i18n/nl.json';
import type { Lang } from '@/i18n/language';
import { FAKE_DAY } from '@/services/fakeMatchDayPort';
import { createMemoryKeyValueStore } from '@/services/KeyValueStore';
import { createLogger } from '@/services/logger';
import { createMatchDayStore, MATCHDAY_KEYS } from '@/services/matchDayStore';
import { createModeStore, STORE_KEYS } from '@/services/modeStore';
import { createRingRecord } from '@/services/sessionRecord';
import { HomeScreen } from '@/ui/screens/HomeScreen';
import { createFakePorts, readRecord, TEST_NOW, type FakePorts } from '../../../test/fakePorts';
import { dayLink, FIXTURE_DAY_TOKEN } from '../../../test/fixtures/dayCode';
import { createMemoryQueueFiles } from '../../../test/memoryQueueFiles';
import { refusingStore } from '../../../test/refusingStore';
import { renderWithPorts } from '../../../test/renderWithPorts';

// Task 8c (owner, 2026-11-12): a Match Day code kept before its day shows a sheet with Close, and the tile says what is
// saved. Copy is read from the dictionaries, never from the code under test.

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
const said = (lang: Lang, key: string, vars: Record<string, string>): string =>
  Object.entries(vars).reduce(
    (all, [name, value]) => all.replaceAll(`{${name}}`, value),
    word(lang, key),
  );

const tileOf = (lang: Lang) => () =>
  screen.getByRole('button', { name: new RegExp(word(lang, 'mode.matchday')) });
const matchDayTile = tileOf('en');
const liveStreamTile = () => screen.getByRole('button', { name: new RegExp(en['mode.stream']) });

const DAY_CODE = { origin: 'https://stg.seazn.club', token: FIXTURE_DAY_TOKEN };
/** Friday 13 November 2026, 00:00 in London (GMT), the fakes' phone zone (13 Nov 2026 is a Friday: checked). */
const OPENS_AT = new Date('2026-11-13T00:00:00.000Z');
const SHEET = 'This Match Day code opens Fri 13 Nov at 00:00';

const SAVED_DAY: SavedCode = {
  mode: 'matchday',
  raw: dayLink(),
  slot: null,
  savedAt: TEST_NOW,
  expiresAt: null,
  stream: null,
  scoring: null,
};

async function dayCopy(day: MatchDay): Promise<Record<string, string>> {
  const files = createMemoryQueueFiles();
  const logger = createLogger({ record: createRingRecord(), now: () => 0 });
  const store = createMatchDayStore({ kv: createMemoryKeyValueStore(), files, logger });
  await store.writeCache(DAY_CODE, day, TEST_NOW);
  return Object.fromEntries(files.files);
}

type Seed = { kvSeed: Record<string, string>; dayFilesSeed: Record<string, string> };
async function savedDay(day: MatchDay | null): Promise<Seed> {
  return {
    kvSeed: { [STORE_KEYS.code('matchday')]: encodeSavedCode(SAVED_DAY) },
    dayFilesSeed: day === null ? {} : await dayCopy(day),
  };
}

const savedCodeIn = (home: FakePorts) =>
  decodeSavedCode(home.kv.entries.get(STORE_KEYS.code('matchday')) ?? '');
const scanDay = (home: Home) => {
  home.scanner.queue({ outcome: 'scanned', raw: dayLink() });
  fireEvent.click(matchDayTile());
};
const closeButton = () => screen.getByRole('button', { name: en['panel.close'], hidden: true });
const notOpenLines = (home: FakePorts) =>
  readRecord(home.record).filter((line) => line.event === 'matchday.notOpen');
const codeDeletes = (spy: { mock: { calls: unknown[][] } }): number =>
  spy.mock.calls.filter(([key]) => key === STORE_KEYS.code('matchday')).length;

describe('the not-yet-open sheet (ruling A)', () => {
  it('a scan before the day saves the code and shows the sheet with the day and time', async () => {
    const home = await renderHome();
    home.matchDay.answerDay({ ok: false, refusal: 'MD_NOT_OPEN', opensAt: OPENS_AT });
    scanDay(home);
    await screen.findByText(SHEET);
    expect(savedCodeIn(home)).toEqual(SAVED_DAY);
    expect(home.navigation.current()).toBe('home');
    expect(notOpenLines(home)).toEqual([expect.objectContaining({ fields: { action: 'shown' } })]);
  });

  it('a tile tap on a saved code before its day shows the sheet and opens no scanner', async () => {
    const home = await renderHome(await savedDay(null));
    home.matchDay.answerDay({ ok: false, refusal: 'MD_NOT_OPEN', opensAt: OPENS_AT });
    fireEvent.click(matchDayTile());
    await screen.findByText(SHEET);
    expect(home.scanner.scans).toBe(0);
    expect(screen.queryByText('Checking code…')).toBeNull();
    expect(savedCodeIn(home)).toEqual(SAVED_DAY);
  });

  it('an answer with no opening says the code is not open yet', async () => {
    const home = await renderHome(await savedDay(null));
    home.matchDay.answerDay({ ok: false, refusal: 'MD_NOT_OPEN' });
    fireEvent.click(matchDayTile());
    await screen.findByText(word('en', 'matchday.notOpenSheet.unknown'));
  });

  it('Close forgets the code and its copy, and the next Match Day tap scans; Live Stream scans as before', async () => {
    const home = await renderHome(await savedDay(null));
    home.matchDay.answerDay({ ok: false, refusal: 'MD_NOT_OPEN', opensAt: OPENS_AT });
    fireEvent.click(matchDayTile());
    await screen.findByText(SHEET);
    fireEvent.click(closeButton());
    await waitFor(() => expect(screen.queryByText(SHEET)).toBeNull());
    expect(home.kv.entries.has(STORE_KEYS.code('matchday'))).toBe(false);
    expect(home.dayFiles.files.size).toBe(0);
    expect(notOpenLines(home).map((line) => line.fields)).toEqual([
      { action: 'shown' },
      { action: 'closed' },
    ]);
    fireEvent.click(matchDayTile());
    await waitFor(() => expect(home.scanner.scans).toBe(1));
    fireEvent.click(liveStreamTile());
    await waitFor(() => expect(home.scanner.scans).toBe(2));
  });

  it('a second Close runs the forget once', async () => {
    const home = await renderHome(await savedDay(null));
    home.matchDay.answerDay({ ok: false, refusal: 'MD_NOT_OPEN', opensAt: OPENS_AT });
    fireEvent.click(matchDayTile());
    await screen.findByText(SHEET);
    const spy = vi.spyOn(home.kv, 'delete');
    const button = closeButton();
    fireEvent.click(button);
    fireEvent.click(button);
    await waitFor(() => expect(home.kv.entries.has(STORE_KEYS.code('matchday'))).toBe(false));
    await act(async () => undefined);
    expect(codeDeletes(spy)).toBe(1);
    expect(notOpenLines(home).filter((line) => line.fields?.action === 'closed')).toHaveLength(1);
  });

  it('Back hides the sheet and keeps the code, as Home’s other sheets do', async () => {
    const home = await renderHome(await savedDay(null));
    home.matchDay.answerDay({ ok: false, refusal: 'MD_NOT_OPEN', opensAt: OPENS_AT });
    fireEvent.click(matchDayTile());
    await screen.findByText(SHEET);
    let handled = false;
    act(() => {
      handled = home.back.press();
    });
    expect(handled).toBe(true);
    expect(screen.queryByText(SHEET)).toBeNull();
    expect(savedCodeIn(home)).toEqual(SAVED_DAY);
  });

  describe('a forget the phone refuses', () => {
    const rejections: unknown[] = [];
    const onRejection = (reason: unknown) => rejections.push(reason);
    beforeEach(() => {
      rejections.length = 0;
      process.on('unhandledRejection', onRejection);
    });
    afterEach(() => {
      process.off('unhandledRejection', onRejection);
    });

    it('says so, keeps the code and records it; it never looks closed', async () => {
      const seed = await savedDay(null);
      const refuse = (key: string) => key === STORE_KEYS.code('matchday') && refusing;
      let refusing = false;
      const home = await renderHome({ ...seed, modeStore: refusingStore(seed.kvSeed, refuse) });
      home.matchDay.answerDay({ ok: false, refusal: 'MD_NOT_OPEN', opensAt: OPENS_AT });
      fireEvent.click(matchDayTile());
      await screen.findByText(SHEET);
      refusing = true;
      fireEvent.click(closeButton());
      await screen.findByText(en['store.saveFailed']);
      expect(savedCodeIn(home)?.raw).toBe(dayLink());
      expect(readRecord(home.record)).toContainEqual(
        expect.objectContaining({ event: 'store.write-refused', fields: { action: 'forget' } }),
      );
      expect(notOpenLines(home).map((line) => line.fields)).toEqual([{ action: 'shown' }]);
      expect(rejections).toEqual([]);
    });
  });

  it.each(['es', 'fr', 'nl'] as const)('in %s the sheet names the day and time', async (lang) => {
    const home = await renderHome({ deviceLanguages: [lang] });
    home.matchDay.answerDay({ ok: false, refusal: 'MD_NOT_OPEN', opensAt: OPENS_AT });
    home.scanner.queue({ outcome: 'scanned', raw: dayLink() });
    fireEvent.click(tileOf(lang)());
    const days = { es: 'vie, 13 nov', fr: 'ven. 13 nov.', nl: 'vr 13 nov' } as const;
    await screen.findByText(
      said(lang, 'matchday.notOpenSheet', { day: days[lang], time: '00:00' }),
    );
  });
});

describe('the opening kept with the code (fix round 1)', () => {
  const OPENS_LINE = said('en', 'home.tile.matchday.opens', { day: 'Fri 13 Nov', time: '00:00' });
  const hide = (home: Home) => {
    act(() => {
      home.back.press();
    });
  };

  it('a scan before the day leaves the tile saying when it opens', async () => {
    const home = await renderHome();
    home.matchDay.answerDay({ ok: false, refusal: 'MD_NOT_OPEN', opensAt: OPENS_AT });
    scanDay(home);
    await screen.findByText(SHEET);
    hide(home);
    await screen.findByText(OPENS_LINE);
    expect(screen.queryByText(en['home.tile.matchday.saved'])).toBeNull();
  });

  it('a tile tap on a saved code with no copy does the same', async () => {
    const home = await renderHome(await savedDay(null));
    await screen.findByText(en['home.tile.matchday.saved']);
    home.matchDay.answerDay({ ok: false, refusal: 'MD_NOT_OPEN', opensAt: OPENS_AT });
    fireEvent.click(matchDayTile());
    await screen.findByText(SHEET);
    hide(home);
    await screen.findByText(OPENS_LINE);
  });

  it('an answer that names no opening keeps nothing: the tile says only that a code is saved', async () => {
    const home = await renderHome(await savedDay(null));
    home.matchDay.answerDay({ ok: false, refusal: 'MD_NOT_OPEN' });
    fireEvent.click(matchDayTile());
    await screen.findByText(word('en', 'matchday.notOpenSheet.unknown'));
    expect(home.kv.entries.has(MATCHDAY_KEYS.opensAt)).toBe(false);
    hide(home);
    await screen.findByText(en['home.tile.matchday.saved']);
  });

  it('Close takes the kept opening with the code', async () => {
    const home = await renderHome();
    home.matchDay.answerDay({ ok: false, refusal: 'MD_NOT_OPEN', opensAt: OPENS_AT });
    scanDay(home);
    await screen.findByText(SHEET);
    expect(home.kv.entries.has(MATCHDAY_KEYS.opensAt)).toBe(true);
    fireEvent.click(closeButton());
    await waitFor(() => expect(screen.queryByText(SHEET)).toBeNull());
    expect(home.kv.entries.has(MATCHDAY_KEYS.opensAt)).toBe(false);
    expect(screen.queryByText(OPENS_LINE)).toBeNull();
    await screen.findByText(en['home.tile.matchday.hint']);
  });

  it('a phone that refuses the write still shows the sheet, and records it', async () => {
    const home = await renderHome(await savedDay(null));
    const set = home.kv.set;
    vi.spyOn(home.kv, 'set').mockImplementation((key, value) =>
      key === MATCHDAY_KEYS.opensAt ? Promise.reject(new Error('locked')) : set(key, value),
    );
    home.matchDay.answerDay({ ok: false, refusal: 'MD_NOT_OPEN', opensAt: OPENS_AT });
    fireEvent.click(matchDayTile());
    await screen.findByText(SHEET);
    expect(readRecord(home.record)).toContainEqual(
      expect.objectContaining({ event: 'matchday.cache-refused', fields: { op: 'opens-at' } }),
    );
    hide(home);
    await screen.findByText(en['home.tile.matchday.saved']);
  });
});

describe('the Match Day tile says what is saved (ruling B)', () => {
  const tileLine = (text: string) => screen.getByText(text);
  const before = {
    ...FAKE_DAY,
    opensAt: OPENS_AT,
    expiresAt: new Date('2026-11-14T00:00:00.000Z'),
  };

  it('with no code saved: unchanged, Scan the Match Day code', async () => {
    await renderHome();
    expect(tileLine(en['home.tile.matchday.hint'])).toBeTruthy();
  });

  it('saved before its day with a copy: Opens {day} · {time}', async () => {
    await renderHome({ ...(await savedDay(before)) });
    await screen.findByText('Opens Fri 13 Nov · 00:00');
  });

  it('saved before its day with nothing cached: Code saved · tap to open', async () => {
    await renderHome(await savedDay(null));
    await screen.findByText(en['home.tile.matchday.saved']);
  });

  it('from its day’s start to its end: Tap to open', async () => {
    await renderHome({
      ...(await savedDay(before)),
      clock: () => new Date('2026-11-13T09:00:00.000Z'),
    });
    await screen.findByText(en['home.tile.matchday.tap']);
  });

  it('after the day’s end: Scan the Match Day code again', async () => {
    await renderHome({ ...(await savedDay(before)), clock: () => before.expiresAt });
    await screen.findByText(en['home.tile.matchday.hint']);
  });

  it('the other two tiles keep their own line', async () => {
    await renderHome(await savedDay(null));
    expect(screen.getAllByText(en['home.tile.stream.hint'])).toHaveLength(1);
    expect(screen.getAllByText(en['home.tile.scoring.hint'])).toHaveLength(1);
  });
});
