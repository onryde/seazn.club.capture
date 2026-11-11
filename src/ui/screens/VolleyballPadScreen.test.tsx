import { act, fireEvent, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { encodeSavedCode } from '@/domain/mode/savedCode';
import en from '@/i18n/en.json';
import fr from '@/i18n/fr.json';
import nl from '@/i18n/nl.json';
import type { FakeMatchSeed } from '@/services/fakeScoringPort';
import {
  AWAY_ENTRANT,
  beachSeed,
  HOME_ENTRANT,
  indoorSeed,
  VOLLEYBALL_DECIDING_SEED,
  VOLLEYBALL_INDOOR_SEED,
} from '@/services/fakeVolleyballPad';
import { STORE_KEYS } from '@/services/modeStore';
import { colour } from '@/ui/theme/tokens';
import { TEST_NOW } from '../../../test/fakePorts';
import { screenIsHeld, type HoldLog } from '../../../test/heldScreen';
import { edgeOf, fillOf, paintOf } from '../../../test/pressState';
import { linkKey } from '../../../test/scoringHomeFixtures';
import { halfNeeds } from '@/ui/theme/scoreRole';
import { typeScale } from '@/ui/theme/type';
import { layOut } from '../../../test/layOut';
import { flush, launchApp, type LaunchedApp } from '../../../test/routedApp';

const holds = vi.hoisted((): HoldLog => []);
vi.mock('@/hooks/keepAwake', async () => {
  const { recordingHold } = await import('../../../test/heldScreen');
  return { holdScreenOn: recordingHold(holds) };
});

beforeEach(() => {
  seconds = 0;
  vi.useFakeTimers();
  holds.length = 0;
});
afterEach(() => vi.useRealTimers());

// S2-6 Task 11: volleyball's pad screen (spec §5, layout A, ruling 178) on the fake server with the real runner, queue,
// sender and fold under it. Each test reads what the scorer sees, in English, French and Dutch. Portrait only, so the
// orientation question does not apply. What jsdom cannot see (the card's and the counts' colour on a phone, a press's
// feedback, real font metrics at 320 dp: `volleyballFit.test.ts` measures those) is the device check's.

const DICTIONARIES = { en, fr, nl } as const;
type Lang = keyof typeof DICTIONARIES;
const LINK = { origin: 'https://stg.seazn.club', token: 'dl_madeUpTokenForVolleyball01' };

function inMatch(seed: FakeMatchSeed): Record<string, string> {
  return {
    [STORE_KEYS.active]: 'scoring',
    [STORE_KEYS.code('scoring')]: encodeSavedCode({
      mode: 'scoring',
      raw: '',
      slot: null,
      savedAt: TEST_NOW,
      expiresAt: null,
      stream: null,
      scoring: { fixtureId: seed.fixtureId, label: 'Match 2' },
    }),
    [linkKey(seed.fixtureId)]: JSON.stringify({ ...LINK, sportKey: 'volleyball' }),
  };
}

let seconds = 0;
const aSecondOn = (app: LaunchedApp) => {
  seconds += 1;
  app.setNow(new Date(TEST_NOW.getTime() + seconds * 1000));
};
const half = (side: 'first' | 'second') => screen.getByTestId(`half-${side}`);
const score = (side: 'first' | 'second') => within(half(side)).getByTestId('score').textContent;
const counts = (side: 'first' | 'second') =>
  within(half(side)).queryByTestId('half-counts')?.textContent ?? null;
const cardFills = (side: 'first' | 'second') =>
  within(half(side))
    .queryAllByTestId('mark-card')
    .map((card) => paintOf(card).fill);
const lastTap = () => screen.getByTestId('last-tap-sentence').textContent;
const tools = () =>
  within(screen.getByTestId('tool-row'))
    .getAllByRole('button')
    .map((button) => button.getAttribute('aria-label'));
const drawn = () =>
  within(screen.getByTestId('tool-row'))
    .getAllByRole('button')
    .map((button) => button.textContent);
const buttons = (of: HTMLElement) =>
  within(of)
    .getAllByRole('button')
    .map((button) => button.textContent);
const fill = (text: string, vars: Record<string, string | number>) =>
  Object.entries(vars).reduce(
    (out, [name, value]) => out.replace(`{${name}}`, String(value)),
    text,
  );

const press = (name: string) => act(() => fireEvent.click(screen.getByRole('button', { name })));
async function tap(app: LaunchedApp, name: string): Promise<void> {
  aSecondOn(app);
  press(name);
  await flush(400);
}
async function rally(app: LaunchedApp, side: 'first' | 'second', times = 1): Promise<void> {
  for (let at = 0; at < times; at += 1) {
    aSecondOn(app);
    act(() => fireEvent.click(half(side)));
    await flush(0);
  }
}

/** The match opened and started by this phone, the first side serving, a minute before the test's taps. */
async function started(
  seed: FakeMatchSeed = VOLLEYBALL_INDOOR_SEED,
  lang: Lang = 'en',
): Promise<LaunchedApp> {
  const app = await launchApp({
    scoringSeed: seed,
    kvSeed: inMatch(seed),
    deviceLanguages: [lang],
  });
  await flush(200);
  app.setNow(new Date(TEST_NOW.getTime() - 60_000));
  act(() => fireEvent.click(screen.getAllByRole('radio')[0]!));
  act(() =>
    fireEvent.click(
      screen.getByRole('button', { name: DICTIONARIES[lang]['scoring.start.confirm'] }),
    ),
  );
  app.setNow(TEST_NOW);
  await flush(200);
  return app;
}

describe.each(['en', 'fr', 'nl'] as const)('layout A, indoor, in %s', (lang) => {
  const words = DICTIONARIES[lang];

  it('the tool row is Set score, Timeout, Sub and More, and each half’s foot counts its timeouts and subs', async () => {
    await started(VOLLEYBALL_INDOOR_SEED, lang);
    expect(tools()).toEqual([
      words['scoring.volleyball.tool.setScore'],
      words['scoring.volleyball.tool.timeout'],
      words['scoring.volleyball.sheet.sub'],
      words['scoring.volleyball.tool.more'],
    ]);
    // A row of four draws Timeout and Sub in their short words; the full words are spoken.
    expect(drawn()).toEqual([
      words['scoring.volleyball.tool.setScore'],
      words['scoring.volleyball.tool.timeoutShort'],
      words['scoring.volleyball.tool.sub'],
      words['scoring.volleyball.tool.more'],
    ]);
    const foot = fill(words['scoring.volleyball.foot.indoor'], {
      timeouts: 0,
      timeoutCap: 2,
      subs: 0,
      subCap: 6,
    });
    expect([counts('first'), counts('second')]).toEqual([foot, foot]);
    // A screen reader hears the counts in the half's name (the line itself is hidden from it).
    const spoken = fill(words['scoring.volleyball.foot.indoorSaid'], {
      timeouts: 0,
      timeoutCap: 2,
      subs: 0,
      subCap: 6,
    });
    expect(half('first').getAttribute('aria-label')).toContain(spoken);
    expect(half('first').getAttribute('aria-label')).not.toContain(foot);
  });

  it('a timeout counts on the side’s foot, and at the FIVB number the foot turns caution', async () => {
    const app = await started(VOLLEYBALL_INDOOR_SEED, lang);
    await rally(app, 'first');
    for (let n = 1; n <= 2; n += 1) {
      await tap(app, words['scoring.volleyball.tool.timeout']);
      expect(screen.getByTestId('step-sheet')).toBeTruthy();
      await tap(app, 'Herons');
      expect(counts('second')).toBe(
        fill(words['scoring.volleyball.foot.indoor'], {
          timeouts: n,
          timeoutCap: 2,
          subs: 0,
          subCap: 6,
        }),
      );
    }
    // Both counts in the caution colour at 2 of 2; the other side's foot is as it was, in ink.
    const colourOf = (side: 'first' | 'second') =>
      getComputedStyle(within(half(side)).getByTestId('half-counts')).color;
    expect(colourOf('second')).toBe(edgeOf(colour.caution));
    expect(colourOf('first')).toBe(edgeOf(colour.ink2));
    expect(counts('first')).toContain('0');
  });

  it('a warning is one yellow card in the side’s corner, and the done line is the sentence', async () => {
    const app = await started(VOLLEYBALL_INDOOR_SEED, lang);
    await tap(app, words['scoring.volleyball.tool.more']);
    await tap(app, fill(words['scoring.volleyball.more.sanction'], { side: 'Falcons' }));
    await tap(app, words['scoring.sanction.warning']);
    await tap(app, 'F. Adams');
    expect(screen.queryByTestId('step-sheet')).toBeNull();
    expect(cardFills('first')).toEqual([fillOf(colour.cardCaution)]);
    expect(cardFills('second')).toEqual([]);
  });

  it('a penalty is the red card icon, and the last-tap line says whose rally to tap', async () => {
    const app = await started(VOLLEYBALL_INDOOR_SEED, lang);
    await tap(app, words['scoring.volleyball.tool.more']);
    await tap(app, fill(words['scoring.volleyball.more.sanction'], { side: 'Herons' }));
    await tap(app, words['scoring.sanction.penalty']);
    await tap(app, 'H. Adams');
    expect(cardFills('second')).toEqual([fillOf(colour.cardDismissal)]);
    expect(lastTap()).toBe(fill(words['scoring.volleyball.done.penalty'], { side: 'Falcons' }));
  });

  // Review M3/M5: an expulsion's note starts with the level's word, and the sentence says it in the language.
  it('an expulsion’s last-tap line names the level, then the organiser’s part', async () => {
    const app = await started(VOLLEYBALL_INDOOR_SEED, lang);
    await tap(app, words['scoring.volleyball.tool.more']);
    await tap(app, fill(words['scoring.volleyball.more.sanction'], { side: 'Falcons' }));
    await tap(app, words['scoring.sanction.expulsion']);
    await tap(app, 'F. Adams');
    expect(lastTap()).toBe(
      fill(words['scoring.volleyball.done.fieldSix'], {
        level: words['scoring.sanction.expulsion'],
        team: 'Falcons',
      }),
    );
    expect(lastTap()?.startsWith(words['scoring.sanction.expulsion'])).toBe(true);
  });

  // Review I1 (ruling 178): indoors the counts share the bottom row with "Tap"; they are not a line of their own.
  it('the counts sit in the bottom row beside Tap', async () => {
    await started(VOLLEYBALL_INDOOR_SEED, lang);
    // Its parent is the bottom row (which holds Tap), not the half itself.
    const row = within(half('first')).getByTestId('half-counts').parentElement as HTMLElement;
    expect(row).not.toBe(half('first'));
    expect(within(row).queryByText(words['scoring.pad.tap'])).not.toBeNull();
    // "Tap" holds its width and the counts give way first (jsdom reads the declared styles, not the layout).
    const tapWord = within(row).getByText(words['scoring.pad.tap']);
    expect(getComputedStyle(tapWord).flexShrink).toBe('0');
    expect(getComputedStyle(within(row).getByTestId('half-counts')).flexShrink).toBe('1');
  });

  it('Timeout opens a two-choice side sheet', async () => {
    const app = await started(VOLLEYBALL_INDOOR_SEED, lang);
    await tap(app, words['scoring.volleyball.tool.timeout']);
    const sheet = screen.getByTestId('step-sheet');
    expect(within(sheet).getByText(words['scoring.volleyball.sheet.timeout'])).toBeTruthy();
    expect(buttons(sheet)).toEqual(['Falcons', 'Herons', words['scoring.sheet.cancel']]);
  });
});

describe.each(['en', 'fr', 'nl'] as const)(
  'the deciding set’s toss, on the screen, in %s',
  (lang) => {
    const words = DICTIONARIES[lang];

    it('the first tap at set 5 0-0 asks Who serves first in set 5?, and the answer’s side serves, shown on its plate', async () => {
      const app = await launchApp({
        scoringSeed: VOLLEYBALL_DECIDING_SEED,
        kvSeed: inMatch(VOLLEYBALL_DECIDING_SEED),
        deviceLanguages: [lang],
      });
      await flush(200);
      await rally(app, 'second');
      const sheet = screen.getByTestId('step-sheet');
      expect(
        within(sheet).getByText(fill(words['scoring.volleyball.sheet.serving'], { set: 5 }), {
          normalizer: (text) => text,
        }),
      ).toBeTruthy();
      expect(buttons(sheet)).toEqual(['Falcons', 'Herons', words['scoring.sheet.cancel']]);
      await tap(app, 'Falcons');
      expect(score('second')).toBe('1');
      // The tapped rally was the second side's, served by the side picked; the winner serves next (side-out).
      expect(within(half('second')).queryByTestId('serving')).not.toBeNull();
      expect(within(half('first')).queryByTestId('serving')).toBeNull();
      const events = await app.scoring.events(LINK, VOLLEYBALL_DECIDING_SEED.fixtureId, 0);
      expect(Array.isArray(events) ? events.at(-1) : null).toMatchObject({
        type: 'volleyball.rally',
        payload: { wonBy: AWAY_ENTRANT, serving: HOME_ENTRANT },
      });
    });
  },
);

describe('Sub, indoors only', () => {
  it('Sub asks the side, who comes off, who comes on, and the foot counts it', async () => {
    const app = await started();
    await tap(app, en['scoring.volleyball.sheet.sub']);
    await tap(app, 'Falcons');
    expect(screen.getByText(en['scoring.volleyball.sheet.off'])).toBeTruthy();
    await tap(app, 'F. Adams');
    expect(screen.getByText(en['scoring.volleyball.sheet.on'])).toBeTruthy();
    await tap(app, 'F. Grant');
    expect(counts('first')).toBe(
      fill(en['scoring.volleyball.foot.indoor'], {
        timeouts: 0,
        timeoutCap: 2,
        subs: 1,
        subCap: 6,
      }),
    );
    const events = await app.scoring.events(LINK, VOLLEYBALL_INDOOR_SEED.fixtureId, 0);
    expect(Array.isArray(events) ? events.at(-1) : null).toMatchObject({
      type: 'volleyball.sub',
      payload: { by: HOME_ENTRANT, off: `${HOME_ENTRANT}-p1`, on: `${HOME_ENTRANT}-p7` },
    });
  });

  it('beach has no Sub, and the foot counts timeouts alone, of one', async () => {
    const seed = beachSeed({ fixtureId: 'screen-beach' });
    await started(seed);
    expect(tools()).toEqual([
      en['scoring.volleyball.tool.setScore'],
      en['scoring.volleyball.tool.timeout'],
      en['scoring.volleyball.tool.more'],
    ]);
    expect(counts('first')).toBe(
      fill(en['scoring.volleyball.foot.beach'], { timeouts: 0, timeoutCap: 1 }),
    );
    expect(screen.queryByRole('button', { name: en['scoring.volleyball.sheet.sub'] })).toBeNull();
  });

  it('a fixture with no team sheet records the sub for the side at once, with no player steps', async () => {
    const seed = indoorSeed({ fixtureId: 'screen-nosheet', sheet: 'none' });
    const app = await started(seed);
    await tap(app, en['scoring.volleyball.sheet.sub']);
    await tap(app, 'Falcons');
    expect(screen.queryByTestId('step-sheet')).toBeNull();
    expect(counts('first')).toContain('1/6');
    expect(AWAY_ENTRANT).toBe('ent-away');
  });
});

describe('the counts line takes its own room out of the half: beach only (ruling 178)', () => {
  const size = (side: 'first' | 'second') =>
    getComputedStyle(within(half(side)).getByTestId('score')).fontSize;

  it('beach: a half exactly as tall as the large score needs steps the score down once the counts line is under it', async () => {
    await started(beachSeed({ fixtureId: 'screen-beach-room' }));
    const needs = halfNeeds('scoreLarge');
    layOut(half('first'), { width: 300, height: needs });
    expect(size('first')).toBe(`${typeScale.score.fontSize}px`);
    layOut(half('first'), { width: 300, height: needs + typeScale.control.lineHeight });
    expect(size('first')).toBe(`${typeScale.scoreLarge.fontSize}px`);
  });

  it('beach: the counts are a line of their own, not in the bottom row beside Tap', async () => {
    await started(beachSeed({ fixtureId: 'screen-beach-line' }));
    // Its parent is the half itself: a line of its own above the bottom row.
    expect(within(half('first')).getByTestId('half-counts').parentElement).toBe(half('first'));
  });

  it('indoor: the large score needs no more height for its counts', async () => {
    await started();
    layOut(half('first'), { width: 300, height: halfNeeds('scoreLarge') });
    expect(size('first')).toBe(`${typeScale.scoreLarge.fontSize}px`);
  });
});

describe('the screen is held on while the pad is', () => {
  it('holds the screen awake on the pad', async () => {
    await started();
    expect(screenIsHeld(holds)).toBe(true);
  });
});
