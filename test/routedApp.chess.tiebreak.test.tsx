import { act, fireEvent, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { chessCfg } from '@/domain/scoring/chessEngine';
import en from '@/i18n/en.json';
import { AWAY_ENTRANT, HOME_ENTRANT, bracketChessSeed, chessSeed } from '@/services/fakeChessPad';
import type { FakeMatchSeed } from '@/services/fakeScoringPort';
import {
  DICTIONARIES,
  aSecondOn,
  fill,
  half,
  howSheet,
  inMatch,
  lastTap,
  ledger,
  live,
  pick,
  plain,
  plate,
  press,
  record,
  resetChessClock,
  startPressed,
  strip,
  tally,
  toolNames,
  typesOf,
  undoCell,
  type Words,
} from './chessRouted';
import { backgroundAndBack, flush, launchApp, type LaunchedApp } from './routedApp';

beforeEach(() => {
  resetChessClock();
  vi.useFakeTimers();
});
afterEach(() => vi.useRealTimers());

// S2-3b Task 3: the tie-break of a drawn knockout game, from the Tie-break tile to the ledger, through the route's table on
// the fake server with the real runner, queue, sender and fold under it; the real engine judges every event and decides who
// advances (BG-KO-2). Each test reads what the scorer sees. Copy comes from the dictionaries and expected states from the
// design (docs/specs/2026-11-05-s2-3b-chess-tiebreak-design.md §3, §5), never from the code under test. What jsdom cannot
// see (how the rows and chips wrap at 320 dp, the dim over the pad, a screen reader reading the sheet, a press's feedback)
// is the device check's: nothing here claims it. The four questions: a second call (the bounce tests, Undo twice), an empty
// input (a stage that lists no rung, a division without colours), an interruption (the background, a queued tap), another
// language (the last block); orientation does not apply (Remote Scoring is portrait only).

const sheet = () => screen.queryByTestId('tiebreak-sheet');
const inSheet = () => within(screen.getByTestId('tiebreak-sheet'));
/** The sheet's step, by its title, and the buttons on it (rows, Record, Cancel) in the order they are drawn. */
const stepTitle = (title: string) => inSheet().getByText(plain(title));
const sheetButtons = () =>
  inSheet()
    .getAllByRole('button')
    .map((button) => button.textContent);
const chips = () =>
  inSheet()
    .getAllByRole('radio')
    .map((chip) => chip.textContent);
const isPicked = (name: string) =>
  inSheet().getByRole('radio', { name }).getAttribute('aria-checked') === 'true';

const T = {
  tile: en['scoring.chess.tiebreak.tool'],
  record: en['scoring.chess.how.record'],
  cancel: en['scoring.sheet.cancel'],
  rung: {
    rapid: en['scoring.chess.tiebreak.rung.rapid'],
    blitz: en['scoring.chess.tiebreak.rung.blitz'],
    armageddon: en['scoring.chess.tiebreak.rung.armageddon'],
  },
  titles: {
    rung: en['scoring.chess.tiebreak.rung.title'],
    winner: en['scoring.chess.tiebreak.winner.title'],
    score: en['scoring.chess.tiebreak.score.title'],
    black: en['scoring.chess.tiebreak.black.title'],
    result: en['scoring.chess.tiebreak.result.title'],
    confirm: en['scoring.chess.tiebreak.confirm.title'],
  },
  none: en['scoring.chess.tiebreak.score.none'],
  lots: en['scoring.chess.tiebreak.lotsHint'],
} as const;

/** "L. Chen advances · Rapid", as the dictionary says it; "L. Chen advances · by lot" for the organiser's lots (ruling 63b). */
const advances = (name: string, rung: keyof typeof T.rung | 'lots', words: Words = en) =>
  fill(words['scoring.chess.tiebreak.advances']!, {
    name,
    how: words[`scoring.chess.tiebreak.rung.${rung}`]!,
  });

const tileButton = () => screen.queryByRole('button', { name: T.tile });

/** The knockout game drawn: started, a draw recorded with no method, the pad now owing a tie-break. */
async function drawn(
  seed: FakeMatchSeed = bracketChessSeed(),
  words: Words = en,
): Promise<LaunchedApp> {
  const app = await live(seed);
  await record(app, null, undefined, words);
  return app;
}

/** The Tie-break tile pressed: the sheet opens on its first step. */
const openTiebreak = (app: LaunchedApp) => press(app, T.tile);

/** The last event on the fake server's ledger. */
async function lastEvent(app: LaunchedApp, seed: FakeMatchSeed) {
  return (await ledger(app, seed)).at(-1);
}

const BEFORE = ['core.start', 'boardgame.result'];

/**
 * What the pad says once the organiser has settled a drawn game by lot (ruling 63b, owner, "apply rec", 2026-11-07): the strip
 * and the last-tap line name the player the lot sent through, "{name} advances · by lot"; the game stays a draw, so the
 * header says "½", under the "Result recorded" card, with nothing to tap.
 */
function expectSettledByLot(name: string, lastTapLine = true): void {
  expect(strip()).toBe(advances(name, 'lots'));
  expect(strip()).toBe(`${name} advances · by lot`);
  // A refusal on the line takes the last-tap sentence's place until the scorer's next tap.
  if (lastTapLine) expect(lastTap()).toBe(advances(name, 'lots'));
  expect(tally()).toBe('½');
  expect(screen.getByTestId('pad-card').textContent).toContain(
    en['scoring.card.resultRecorded.title'],
  );
  expect(tileButton()).toBeNull();
  expect(toolNames()).toEqual([]);
  expect(half('first').getAttribute('aria-disabled')).toBe('true');
  expect(half('second').getAttribute('aria-disabled')).toBe('true');
}

describe('the Tie-break tile of a drawn knockout game', () => {
  it('puts the Tie-break tile in place of Draw and Swap colours, leaves the halves where they are but not tappable, and the strip says nothing: the tile is the call', async () => {
    const seed = bracketChessSeed();
    const app = await drawn(seed);
    // The draw is recorded as the game's result, and the pad is not decided yet: no card, no result line, no strip note.
    expect(await typesOf(app, seed)).toEqual(BEFORE);
    expect(toolNames()).toEqual([T.tile]);
    expect(strip()).toBe('');
    expect(tally()).toBe('');
    expect(screen.queryByTestId('pad-card')).toBeNull();
    expect(half('first').getAttribute('aria-disabled')).toBe('true');
    expect(half('second').getAttribute('aria-disabled')).toBe('true');
    expect(sheet()).toBeNull();
  });

  it('opens on the rungs the stage plays, in the stage’s order and no others, with the line that sends lots to the organiser', async () => {
    const seed = bracketChessSeed(['armageddon', 'rapid']);
    const app = await drawn(seed);
    await openTiebreak(app);
    expect(stepTitle(T.titles.rung)).toBeTruthy();
    expect(sheetButtons()).toEqual([T.rung.armageddon, T.rung.rapid, T.cancel]);
    expect(inSheet().getByText(T.lots)).toBeTruthy();
    // Opening the sheet records nothing.
    expect(await typesOf(app, seed)).toEqual(BEFORE);
  });

  it('lists all three rungs when the stage names none', async () => {
    const app = await drawn();
    await openTiebreak(app);
    expect(sheetButtons()).toEqual([T.rung.rapid, T.rung.blitz, T.rung.armageddon, T.cancel]);
  });

  it.each([
    ['Cancel', () => screen.getByRole('button', { name: T.cancel })],
    ['the dim', () => screen.getByTestId('tiebreak-dim')],
  ] as const)(
    '%s closes the sheet with nothing recorded, and the tile is still owed',
    async (_name, closer) => {
      const seed = bracketChessSeed();
      const app = await drawn(seed);
      await openTiebreak(app);
      await press(app, T.rung.rapid);
      expect(stepTitle(T.titles.winner)).toBeTruthy();
      aSecondOn(app);
      act(() => fireEvent.click(closer()));
      await flush(400);
      expect(sheet()).toBeNull();
      expect(await typesOf(app, seed)).toEqual(BEFORE);
      expect(toolNames()).toEqual([T.tile]);
      // Asked again, the sheet starts over with nothing picked.
      await openTiebreak(app);
      expect(stepTitle(T.titles.rung)).toBeTruthy();
    },
  );
});

describe('a Rapid or Blitz tie-break', () => {
  it('Rapid, who won, a score: the ledger gets the rung, the winner and the score, and the pad names who advances', async () => {
    const seed = bracketChessSeed();
    const app = await drawn(seed);
    await openTiebreak(app);
    await press(app, T.rung.rapid);
    // Who won: both players by name, and the heading says it is the tie-break's.
    expect(stepTitle(T.titles.winner)).toBeTruthy();
    expect(sheetButtons()).toEqual(['A. Sharma', 'L. Chen', T.cancel]);
    await press(app, 'L. Chen');
    // The score is optional: No score is picked, the others are 2–0 and 1½–½, and the line says who advances.
    expect(stepTitle(T.titles.score)).toBeTruthy();
    expect(inSheet().getByText(advances('L. Chen', 'rapid'))).toBeTruthy();
    expect(chips()).toEqual([T.none, '2–0', '1½–½']);
    expect(isPicked(T.none)).toBe(true);
    await pick(app, '1½–½');
    expect(isPicked('1½–½')).toBe(true);
    expect(isPicked(T.none)).toBe(false);
    // Nothing is sent before Record.
    expect(await typesOf(app, seed)).toEqual(BEFORE);
    await press(app, T.record);

    expect(sheet()).toBeNull();
    expect(await lastEvent(app, seed)).toMatchObject({
      type: 'boardgame.tiebreak',
      payload: { rung: 'rapid', winner: AWAY_ENTRANT, score: '1½–½' },
    });
    expect(Object.keys((await lastEvent(app, seed))?.payload as object).sort()).toEqual([
      'rung',
      'score',
      'winner',
    ]);
    // The header stays level (the game itself was a draw), and the strip and the last-tap line name who goes through.
    expect(tally()).toBe('½');
    expect(strip()).toBe(advances('L. Chen', 'rapid'));
    expect(lastTap()).toBe(advances('L. Chen', 'rapid'));
    expect(screen.getByTestId('pad-card').textContent).toContain(
      en['scoring.card.resultRecorded.title'],
    );
    expect(toolNames()).toEqual([]);
    expect(tileButton()).toBeNull();
    expect(half('first').getAttribute('aria-disabled')).toBe('true');
    expect(undoCell()).toBeTruthy();
  });

  it('Home’s Finished card keeps the game’s own result, ½–½, while the pad names who advances', async () => {
    const app = await drawn();
    await openTiebreak(app);
    await press(app, T.rung.rapid);
    await press(app, 'L. Chen');
    await press(app, T.record);
    expect(strip()).toBe(advances('L. Chen', 'rapid'));
    act(() => {
      app.back.press();
    });
    await flush(400);
    expect(app.nav.current()).toBe('home');
    expect(
      within(screen.getByTestId('scoring-continue')).getByText(
        fill(en['home.scoring.finishedScore'], { score: '½–½' }),
      ),
    ).toBeTruthy();
  });

  it('Rapid with no score, or a score taken back with No score, sends no score at all', async () => {
    const seed = bracketChessSeed();
    const app = await drawn(seed);
    await openTiebreak(app);
    await press(app, T.rung.rapid);
    await press(app, 'A. Sharma');
    // A score chosen and then taken back is none.
    await pick(app, '2–0');
    expect(isPicked('2–0')).toBe(true);
    await pick(app, T.none);
    expect(isPicked(T.none)).toBe(true);
    await press(app, T.record);
    const event = await lastEvent(app, seed);
    expect(event).toMatchObject({
      type: 'boardgame.tiebreak',
      payload: { rung: 'rapid', winner: HOME_ENTRANT },
    });
    expect(Object.keys(event?.payload as object)).not.toContain('score');
    expect(strip()).toBe(advances('A. Sharma', 'rapid'));
  });

  it('Blitz, with the score 2–0: the rung is the wire’s, and the first player advances', async () => {
    const seed = bracketChessSeed();
    const app = await drawn(seed);
    await openTiebreak(app);
    await press(app, T.rung.blitz);
    await press(app, 'A. Sharma');
    expect(inSheet().getByText(advances('A. Sharma', 'blitz'))).toBeTruthy();
    await pick(app, '2–0');
    await press(app, T.record);
    expect(await lastEvent(app, seed)).toMatchObject({
      type: 'boardgame.tiebreak',
      payload: { rung: 'blitz', winner: HOME_ENTRANT, score: '2–0' },
    });
    expect(strip()).toBe(advances('A. Sharma', 'blitz'));
    expect(lastTap()).toBe(advances('A. Sharma', 'blitz'));
  });

  it('Blitz with no score: the second player advances, with no score key', async () => {
    const seed = bracketChessSeed();
    const app = await drawn(seed);
    await openTiebreak(app);
    await press(app, T.rung.blitz);
    await press(app, 'L. Chen');
    await press(app, T.record);
    const event = await lastEvent(app, seed);
    expect(event).toMatchObject({
      type: 'boardgame.tiebreak',
      payload: { rung: 'blitz', winner: AWAY_ENTRANT },
    });
    expect(Object.keys(event?.payload as object)).not.toContain('score');
    expect(strip()).toBe(advances('L. Chen', 'blitz'));
  });
});

describe('an Armageddon', () => {
  // The scorer never names a winner (BG-KO-2): who had Black and how it ended from White's side. White won sends the other
  // entrant than Black through, which is White; Black won, or a draw, sends Black. The engine works that out.
  const BOTH = [
    { black: 'first', blackName: 'A. Sharma', whiteName: 'L. Chen', entrant: HOME_ENTRANT },
    { black: 'second', blackName: 'L. Chen', whiteName: 'A. Sharma', entrant: AWAY_ENTRANT },
  ] as const;
  const RESULTS = ['white', 'black', 'draw'] as const;
  const CASES = BOTH.flatMap((b) => RESULTS.map((result) => ({ ...b, result })));
  const advancing = (c: (typeof CASES)[number]) =>
    c.result === 'white' ? c.whiteName : c.blackName;
  const label = (c: (typeof CASES)[number]) => {
    if (c.result === 'draw') return en['scoring.chess.tiebreak.result.draw'];
    const name = c.result === 'white' ? c.whiteName : c.blackName;
    return fill(en[`scoring.chess.result.${c.result}`], { name });
  };

  it('has six cases: each Black seat against the three results', () => {
    expect(CASES).toHaveLength(6);
    expect(new Set(CASES.map((c) => `${c.black}/${c.result}`)).size).toBe(6);
  });

  it.each(CASES)(
    '$blackName had Black and the result was $result: $blackName/$whiteName, and the right player advances',
    async (c) => {
      const seed = bracketChessSeed();
      const app = await drawn(seed);
      await openTiebreak(app);
      await press(app, T.rung.armageddon);
      // Who had Black: both names, and nothing about the result yet.
      expect(stepTitle(T.titles.black)).toBeTruthy();
      expect(sheetButtons()).toEqual(['A. Sharma', 'L. Chen', T.cancel]);
      await press(app, c.blackName);
      // The three results, each naming its player by colour, so "White won" never asks the scorer to remember a mapping.
      expect(stepTitle(T.titles.result)).toBeTruthy();
      expect(sheetButtons()).toEqual([
        fill(en['scoring.chess.result.white'], { name: c.whiteName }),
        fill(en['scoring.chess.result.black'], { name: c.blackName }),
        en['scoring.chess.tiebreak.result.draw'],
        T.cancel,
      ]);
      await press(app, label(c));
      // The read-back says who advances before anything is written.
      expect(stepTitle(T.titles.confirm)).toBeTruthy();
      expect(inSheet().getByText(advances(advancing(c), 'armageddon'))).toBeTruthy();
      expect(sheetButtons()).toEqual([T.record, T.cancel]);
      expect(await typesOf(app, seed)).toEqual(BEFORE);
      await press(app, T.record);

      const event = await lastEvent(app, seed);
      expect(event).toMatchObject({ type: 'boardgame.tiebreak' });
      // Facts only: who had Black and the result. The winner is never on the wire.
      expect(event?.payload).toEqual({ rung: 'armageddon', black: c.entrant, result: c.result });
      expect(strip()).toBe(advances(advancing(c), 'armageddon'));
      expect(lastTap()).toBe(advances(advancing(c), 'armageddon'));
      expect(tally()).toBe('½');
      // The colours of the main game are not touched by the tie-break's own: no pairing, the plates as they were.
      expect(await typesOf(app, seed)).toEqual([...BEFORE, 'boardgame.tiebreak']);
      expect(plate('first')).toBe(en['scoring.chess.chip.white']);
      expect(plate('second')).toBe(en['scoring.chess.chip.black']);
    },
  );

  it('a division without colours: the pad draws no plates, and the sheet still names Black and White for the tie-break', async () => {
    const seed = chessSeed({ cfg: chessCfg({ tiebreak: true, colors: false }) });
    const app = await live(seed);
    expect(plate('first')).toBeUndefined();
    expect(toolNames()).toEqual([en['scoring.chess.tool.draw']]);
    await record(app, null);
    expect(toolNames()).toEqual([T.tile]);
    await openTiebreak(app);
    await press(app, T.rung.armageddon);
    await press(app, 'L. Chen');
    expect(sheetButtons()).toEqual([
      fill(en['scoring.chess.result.white'], { name: 'A. Sharma' }),
      fill(en['scoring.chess.result.black'], { name: 'L. Chen' }),
      en['scoring.chess.tiebreak.result.draw'],
      T.cancel,
    ]);
    await press(app, en['scoring.chess.tiebreak.result.draw']);
    expect(inSheet().getByText(advances('L. Chen', 'armageddon'))).toBeTruthy();
    await press(app, T.record);
    expect((await lastEvent(app, seed))?.payload).toEqual({
      rung: 'armageddon',
      black: AWAY_ENTRANT,
      result: 'draw',
    });
    expect(strip()).toBe(advances('L. Chen', 'armageddon'));
    // Still no colours on the pad, and no pairing written.
    expect(plate('first')).toBeUndefined();
    expect(await typesOf(app, seed)).toEqual([...BEFORE, 'boardgame.tiebreak']);
  });

  it('a division without colours: a Rapid tie-break goes the same way', async () => {
    const seed = chessSeed({ cfg: chessCfg({ tiebreak: true, colors: false }) });
    const app = await live(seed);
    await record(app, null);
    await openTiebreak(app);
    await press(app, T.rung.rapid);
    await press(app, 'A. Sharma');
    await press(app, T.record);
    expect((await lastEvent(app, seed))?.payload).toEqual({ rung: 'rapid', winner: HOME_ENTRANT });
    expect(strip()).toBe(advances('A. Sharma', 'rapid'));
  });
});

describe('a stage that lists one rung, or none', () => {
  it.each([
    ['blitz', T.titles.winner, 'A. Sharma'],
    ['rapid', T.titles.winner, 'L. Chen'],
  ] as const)(
    'a stage that plays only %s skips the rung step: the sheet opens on who won, and no lots line is drawn',
    async (rung, title, winner) => {
      const seed = bracketChessSeed([rung]);
      const app = await drawn(seed);
      await openTiebreak(app);
      expect(stepTitle(title)).toBeTruthy();
      expect(sheetButtons()).toEqual(['A. Sharma', 'L. Chen', T.cancel]);
      // The lots line belongs to the rung step, as the web's does: a stage with one rung has no such step, so no such line.
      expect(screen.queryByText(T.lots)).toBeNull();
      expect(screen.queryByText(T.titles.rung)).toBeNull();
      await press(app, winner);
      await press(app, T.record);
      expect((await lastEvent(app, seed))?.payload).toEqual({
        rung,
        winner: winner === 'A. Sharma' ? HOME_ENTRANT : AWAY_ENTRANT,
      });
      expect(strip()).toBe(advances(winner, rung));
    },
  );

  it('a stage that plays only Armageddon opens on who had Black', async () => {
    const seed = bracketChessSeed(['armageddon']);
    const app = await drawn(seed);
    await openTiebreak(app);
    expect(stepTitle(T.titles.black)).toBeTruthy();
    expect(screen.queryByText(T.lots)).toBeNull();
    await press(app, 'A. Sharma');
    await press(app, en['scoring.chess.tiebreak.result.draw']);
    await press(app, T.record);
    expect((await lastEvent(app, seed))?.payload).toEqual({
      rung: 'armageddon',
      black: HOME_ENTRANT,
      result: 'draw',
    });
  });

  it('a stage that lists no rung holds a drawn game for the organiser: the line says so, there is no tile, and the phone offers nothing', async () => {
    const seed = bracketChessSeed([]);
    const app = await drawn(seed);
    expect(strip()).toBe(en['scoring.chess.waiting.tiebreak']);
    expect(strip()).toBe('Waiting for the organiser');
    expect(tileButton()).toBeNull();
    expect(toolNames()).toEqual([]);
    expect(half('first').getAttribute('aria-disabled')).toBe('true');
    expect(half('second').getAttribute('aria-disabled')).toBe('true');
    expect(sheet()).toBeNull();
    expect(await typesOf(app, seed)).toEqual(BEFORE);
  });

  it('a held game the organiser then settles by lot: the waiting line goes, nothing is offered, and the phone sent nothing', async () => {
    const seed = bracketChessSeed([]);
    const app = await drawn(seed);
    expect(strip()).toBe(en['scoring.chess.waiting.tiebreak']);
    app.scoring.addOtherScorerEvent('core.settle', { winner: HOME_ENTRANT, method: 'lot' });
    app.realtime.ping();
    await flush(400);
    expectSettledByLot('A. Sharma');
    expect(await typesOf(app, seed)).toEqual([...BEFORE, 'core.settle']);
  });
});

describe('Undo of a tie-break', () => {
  it('within the window voids this phone’s own tie-break, owes the tile again, and a different tie-break then records', async () => {
    const seed = bracketChessSeed();
    const app = await drawn(seed);
    await openTiebreak(app);
    await press(app, T.rung.rapid);
    await press(app, 'L. Chen');
    await press(app, T.record);
    expect(strip()).toBe(advances('L. Chen', 'rapid'));
    const tiebreakRow = (await ledger(app, seed)).at(-1);

    await press(app, en['scoring.pad.undo']);
    const rows = await ledger(app, seed);
    expect(rows.map((event) => event.type)).toEqual([...BEFORE, 'boardgame.tiebreak', 'core.void']);
    // The void names the tie-break, not the draw before it.
    expect(rows.at(-1)?.voids).toBe(tiebreakRow?.id);
    // The game is back to owing a tie-break: the tile, an empty header and strip, the sentence that says what was undone.
    expect(toolNames()).toEqual([T.tile]);
    expect(tally()).toBe('');
    expect(strip()).toBe('');
    expect(lastTap()).toBe(
      fill(en['scoring.chess.last.undone'], { what: advances('L. Chen', 'rapid') }),
    );
    expect(screen.queryByTestId('pad-card')).toBeNull();
    expect(undoCell()?.getAttribute('aria-disabled')).toBe('true');

    // A different tie-break: another rung, the other player, a score.
    await openTiebreak(app);
    await press(app, T.rung.blitz);
    await press(app, 'A. Sharma');
    await pick(app, '2–0');
    await press(app, T.record);
    expect((await lastEvent(app, seed))?.payload).toEqual({
      rung: 'blitz',
      winner: HOME_ENTRANT,
      score: '2–0',
    });
    expect(await typesOf(app, seed)).toEqual([
      ...BEFORE,
      'boardgame.tiebreak',
      'core.void',
      'boardgame.tiebreak',
    ]);
    expect(strip()).toBe(advances('A. Sharma', 'blitz'));
    // The new tie-break is this phone's own, inside its window: Undo is there and live (an absent cell is not "enabled").
    expect(undoCell()).not.toBeNull();
    expect(undoCell()?.getAttribute('aria-disabled')).not.toBe('true');
  });

  it('Undo twice in the same moment voids it once', async () => {
    const seed = bracketChessSeed();
    const app = await drawn(seed);
    await openTiebreak(app);
    await press(app, T.rung.rapid);
    await press(app, 'L. Chen');
    await press(app, T.record);
    const append = vi.spyOn(app.scoring, 'append');
    const undo = screen.getByRole('button', { name: en['scoring.pad.undo'] });
    aSecondOn(app);
    act(() => {
      fireEvent.click(undo);
      fireEvent.click(undo);
    });
    await flush(2_000);
    expect(append).toHaveBeenCalledTimes(1);
    expect(await typesOf(app, seed)).toEqual([...BEFORE, 'boardgame.tiebreak', 'core.void']);
  });

  // A double tap on Record: the first closes the sheet and records, the second lands on what was under it. Undo is there
  // under the finger (the review of 2026-11-01: a sheet's recording button opens the bounce window for every tap), and it
  // must not take back the tie-break the same tap just made.
  it('a second touch on Undo straight after Record counts once, and the tie-break stands', async () => {
    const seed = bracketChessSeed();
    const app = await drawn(seed);
    await openTiebreak(app);
    await press(app, T.rung.rapid);
    await press(app, 'L. Chen');
    const recordButton = screen.getByRole('button', { name: T.record });
    const append = vi.spyOn(app.scoring, 'append');
    aSecondOn(app);
    act(() => fireEvent.click(recordButton));
    // A moment on (the tie-break reaches the pad and Undo is live), the phone's clock still inside the 250 ms window.
    await flush(60);
    const undo = screen.getByRole('button', { name: en['scoring.pad.undo'] });
    expect(undo.getAttribute('aria-disabled')).not.toBe('true');
    act(() => fireEvent.click(undo));
    await flush(2_000);
    expect(append).toHaveBeenCalledTimes(1);
    expect(await typesOf(app, seed)).toEqual([...BEFORE, 'boardgame.tiebreak']);
    expect(strip()).toBe(advances('L. Chen', 'rapid'));
    // Only a touch after the window is the scorer’s own Undo.
    await press(app, en['scoring.pad.undo']);
    expect(await typesOf(app, seed)).toEqual([...BEFORE, 'boardgame.tiebreak', 'core.void']);
  });

  it('after the 45 s window Undo is gone and the card sends the scorer to the organiser; nothing is voided', async () => {
    const seed = bracketChessSeed();
    const app = await drawn(seed);
    await openTiebreak(app);
    await press(app, T.rung.rapid);
    await press(app, 'L. Chen');
    await press(app, T.record);
    expect(undoCell()).toBeTruthy();
    expect(screen.getByTestId('pad-card').textContent).toContain(
      en['scoring.card.resultRecorded.bodyOpen'],
    );
    // Jump the clock past the window once, and let the window's own timer see it.
    aSecondOn(app, 46);
    await flush(1_000);
    expect(undoCell()).toBeNull();
    expect(screen.getByTestId('pad-card').textContent).toContain(
      en['scoring.card.resultRecorded.bodyClosed'],
    );
    expect(strip()).toBe(advances('L. Chen', 'rapid'));
    expect(await typesOf(app, seed)).toEqual([...BEFORE, 'boardgame.tiebreak']);
  });

  // A tie-break the phone could not reach the server with is still the phone's own to take back, but a send of it may have
  // got through before the answer was lost, so Undo cannot discard it (`awaitAnswer`): it waits for the answer and then
  // voids the event the answer names. The sender retries on the phone's clock, which a test must move.
  it('with no network, Undo queues a void behind the unsent tie-break: when the network returns both reach the ledger in order, and the tile is owed again', async () => {
    const seed = bracketChessSeed();
    const app = await drawn(seed);
    app.scoring.goOffline(true);
    const append = vi.spyOn(app.scoring, 'append');
    await openTiebreak(app);
    await press(app, T.rung.blitz);
    await press(app, 'L. Chen');
    await pick(app, '2–0');
    await press(app, T.record);
    // The pad shows the tie-break at once; the server was asked and could not be reached.
    expect(strip()).toBe(advances('L. Chen', 'blitz'));
    expect(append.mock.calls.map((call) => call[2].type)).toContain('boardgame.tiebreak');
    expect(undoCell()?.getAttribute('aria-disabled')).not.toBe('true');
    await press(app, en['scoring.pad.undo']);
    expect(toolNames()).toEqual([T.tile]);
    expect(strip()).toBe('');

    // The network returns and the sender retries when its backoff is due on the phone's clock.
    app.scoring.goOffline(false);
    aSecondOn(app, 120);
    app.realtime.ping();
    await flush(10_000);
    aSecondOn(app, 120);
    await flush(10_000);
    const rows = await ledger(app, seed);
    expect(rows.map((event) => event.type)).toEqual([...BEFORE, 'boardgame.tiebreak', 'core.void']);
    // The tie-break arrived whole, once, and the void names it.
    expect(rows[2]?.payload).toEqual({ rung: 'blitz', winner: AWAY_ENTRANT, score: '2–0' });
    expect(rows[3]?.voids).toBe(rows[2]?.id);
    expect(toolNames()).toEqual([T.tile]);
    expect(strip()).toBe('');
    expect(tally()).toBe('');
  });

  // The same tap with Undo left alone: it reaches the ledger once, with its score, when the sender retries.
  it('with no network, a tie-break recorded reaches the ledger once with its score when the network returns', async () => {
    const seed = bracketChessSeed();
    const app = await drawn(seed);
    app.scoring.goOffline(true);
    await openTiebreak(app);
    await press(app, T.rung.rapid);
    await press(app, 'L. Chen');
    await pick(app, '1½–½');
    await press(app, T.record);
    expect(strip()).toBe(advances('L. Chen', 'rapid'));
    // Unsent, it is still this phone's own to take back: Undo is there and live.
    expect(undoCell()).not.toBeNull();
    expect(undoCell()?.getAttribute('aria-disabled')).not.toBe('true');
    // Nothing can be read from the server while it is out of reach; the pad's sync badge is the scorer's sign of it.
    app.scoring.goOffline(false);
    aSecondOn(app, 120);
    app.realtime.ping();
    await flush(10_000);
    aSecondOn(app, 120);
    await flush(10_000);
    const rows = await ledger(app, seed);
    expect(rows.map((event) => event.type)).toEqual([...BEFORE, 'boardgame.tiebreak']);
    expect(rows[2]?.payload).toEqual({ rung: 'rapid', winner: AWAY_ENTRANT, score: '1½–½' });
    expect(strip()).toBe(advances('L. Chen', 'rapid'));
    // The phone's clock moved 240 s while the sender retried, past the 45 s window the tap opened: Undo is gone, and the
    // card sends the scorer to the organiser.
    expect(undoCell()).toBeNull();
    expect(screen.getByTestId('pad-card').textContent).toContain(
      en['scoring.card.resultRecorded.bodyClosed'],
    );
  });
});

describe('another scorer, or the organiser, moves the game while the sheet is open', () => {
  it('a second scorer records the tie-break first: the sheet closes and the pad shows theirs, without Undo', async () => {
    const seed = bracketChessSeed();
    const app = await drawn(seed);
    await openTiebreak(app);
    await press(app, T.rung.rapid);
    expect(stepTitle(T.titles.winner)).toBeTruthy();
    app.scoring.addOtherScorerEvent('boardgame.tiebreak', { rung: 'blitz', winner: AWAY_ENTRANT });
    app.realtime.ping();
    await flush(400);
    expect(sheet()).toBeNull();
    expect(strip()).toBe(advances('L. Chen', 'blitz'));
    expect(lastTap()).toBe(advances('L. Chen', 'blitz'));
    expect(toolNames()).toEqual([]);
    expect(undoCell()).toBeNull();
    expect(await typesOf(app, seed)).toEqual([...BEFORE, 'boardgame.tiebreak']);
  });

  // The web's seq conflict, reconciled as S2 does (spec §8): the other scorer's tie-break is on the server before this
  // phone has read it, and Record is pressed on a pad that does not know. Theirs stands, ours is never written, and the
  // scorer is told.
  it('records between this scorer’s pick and Record, unseen: their tie-break stands, ours never lands, and the scorer is told', async () => {
    const seed = bracketChessSeed();
    const app = await drawn(seed);
    await openTiebreak(app);
    await press(app, T.rung.rapid);
    await press(app, 'A. Sharma');
    app.scoring.addOtherScorerEvent('boardgame.tiebreak', { rung: 'blitz', winner: AWAY_ENTRANT });
    await press(app, T.record);
    await flush(1_000);
    expect(sheet()).toBeNull();
    expect(await typesOf(app, seed)).toEqual([...BEFORE, 'boardgame.tiebreak']);
    expect((await lastEvent(app, seed))?.payload).toEqual({ rung: 'blitz', winner: AWAY_ENTRANT });
    expect(strip()).toBe(advances('L. Chen', 'blitz'));
    expect(screen.getByTestId('refusal').textContent).toBe(en['scoring.refusal.notCounted']);
    expect(undoCell()).toBeNull();
  });

  // The sheet is stale as soon as no tie-break is owed, whichever step the scorer is on.
  it.each([
    ['the rung', T.titles.rung, async () => undefined],
    ['who won', T.titles.winner, (app: LaunchedApp) => press(app, T.rung.rapid)],
    [
      'the score',
      T.titles.score,
      async (app: LaunchedApp) => {
        await press(app, T.rung.rapid);
        await press(app, 'A. Sharma');
      },
    ],
    ['who had Black', T.titles.black, (app: LaunchedApp) => press(app, T.rung.armageddon)],
    [
      'the Armageddon result',
      T.titles.result,
      async (app: LaunchedApp) => {
        await press(app, T.rung.armageddon);
        await press(app, 'A. Sharma');
      },
    ],
    [
      'the Armageddon read-back',
      T.titles.confirm,
      async (app: LaunchedApp) => {
        await press(app, T.rung.armageddon);
        await press(app, 'A. Sharma');
        await press(app, en['scoring.chess.tiebreak.result.draw']);
      },
    ],
  ] as const)(
    'the organiser settles the game by lot while the sheet is on %s: the sheet closes with its draft, and nothing of this phone’s is sent',
    async (_step, title, walk) => {
      const seed = bracketChessSeed();
      const app = await drawn(seed);
      await openTiebreak(app);
      await walk(app);
      expect(stepTitle(title)).toBeTruthy();
      app.scoring.addOtherScorerEvent('core.settle', { winner: AWAY_ENTRANT, method: 'lot' });
      app.realtime.ping();
      await flush(400);
      expect(sheet()).toBeNull();
      expectSettledByLot('L. Chen');
      expect(await typesOf(app, seed)).toEqual([...BEFORE, 'core.settle']);
      // No Record is left to press and no lots line stands: the scorer's draft went with the sheet.
      expect(screen.queryByRole('button', { name: T.record })).toBeNull();
      expect(screen.queryByText(T.lots)).toBeNull();
    },
  );

  // The settle is on the server before this phone has read it, and Record is pressed on a pad that does not know. The
  // append meets the web's seq; the phone reads the ledger, finds no tie-break owed, and the scorer is told.
  it('the organiser settles by lot between this scorer’s pick and Record, unseen: nothing of this phone’s lands, the sheet is closed, and the scorer is told', async () => {
    const seed = bracketChessSeed();
    const app = await drawn(seed);
    await openTiebreak(app);
    await press(app, T.rung.rapid);
    await press(app, 'L. Chen');
    app.scoring.addOtherScorerEvent('core.settle', { winner: HOME_ENTRANT, method: 'lot' });
    await press(app, T.record);
    await flush(1_000);
    expect(sheet()).toBeNull();
    expect(await typesOf(app, seed)).toEqual([...BEFORE, 'core.settle']);
    expect(screen.getByTestId('refusal').textContent).toBe(en['scoring.refusal.notCounted']);
    expectSettledByLot('A. Sharma', false);
    expect(undoCell()).toBeNull();
  });

  // The organiser corrected the stage's format (a new rules version) after this scorer opened the sheet and picked a rung
  // that is no longer played: the server answers rulesChanged, the phone reads the rules again and judges the tie-break by
  // them. It is not recorded, the scorer is told, and the tile is owed again with what the stage plays now.
  it('the organiser takes the picked rung out of the stage: Record is not counted, the tile is still owed, and the sheet then offers what is left', async () => {
    const seed = bracketChessSeed(['rapid', 'blitz']);
    const app = await drawn(seed);
    await openTiebreak(app);
    await press(app, T.rung.rapid);
    await press(app, 'L. Chen');
    app.scoring.setRulesVersion(1, { tiebreak: true, tiebreakRungs: ['blitz'] });
    await press(app, T.record);
    await flush(3_000);
    expect(sheet()).toBeNull();
    expect(await typesOf(app, seed)).toEqual(BEFORE);
    expect(screen.getByTestId('refusal').textContent).toBe(en['scoring.refusal.notCounted']);
    expect(toolNames()).toEqual([T.tile]);
    expect(strip()).toBe('');

    // One rung is left, so the sheet skips the rung step; a Blitz tie-break goes in under the new rules.
    await openTiebreak(app);
    expect(stepTitle(T.titles.winner)).toBeTruthy();
    await press(app, 'L. Chen');
    await press(app, T.record);
    expect((await lastEvent(app, seed))?.payload).toEqual({ rung: 'blitz', winner: AWAY_ENTRANT });
    expect(strip()).toBe(advances('L. Chen', 'blitz'));
  });

  it('the organiser voids the draw itself: the game is live again, the sheet closes, and Draw and Swap colours are back', async () => {
    const seed = bracketChessSeed();
    const app = await drawn(seed);
    const draw = (await ledger(app, seed)).at(-1);
    await openTiebreak(app);
    await press(app, T.rung.rapid);
    app.scoring.addOtherScorerEvent('core.void', { event_id: draw?.id });
    app.realtime.ping();
    await flush(400);
    expect(sheet()).toBeNull();
    expect(toolNames()).toEqual([en['scoring.chess.tool.draw'], en['scoring.chess.tool.swap']]);
    expect(tileButton()).toBeNull();
    expect(half('first').getAttribute('aria-disabled')).not.toBe('true');
    expect(await typesOf(app, seed)).toEqual([...BEFORE, 'core.void']);
  });

  it('the organiser voids this phone’s tie-break: the tile is owed again, Undo is gone, and a new tie-break records', async () => {
    const seed = bracketChessSeed();
    const app = await drawn(seed);
    await openTiebreak(app);
    await press(app, T.rung.rapid);
    await press(app, 'L. Chen');
    await press(app, T.record);
    const mine = (await ledger(app, seed)).at(-1);
    app.scoring.addOtherScorerEvent('core.void', { event_id: mine?.id });
    app.realtime.ping();
    await flush(400);
    expect(toolNames()).toEqual([T.tile]);
    expect(strip()).toBe('');
    expect(screen.queryByTestId('pad-card')).toBeNull();
    expect(undoCell()?.getAttribute('aria-disabled')).toBe('true');

    await openTiebreak(app);
    await press(app, T.rung.rapid);
    await press(app, 'A. Sharma');
    await press(app, T.record);
    expect((await lastEvent(app, seed))?.payload).toEqual({ rung: 'rapid', winner: HOME_ENTRANT });
    expect(strip()).toBe(advances('A. Sharma', 'rapid'));
  });

  it('the organiser locks the result after this phone’s tie-break: the strip stands, no tool is offered, and Undo is closed', async () => {
    const seed = bracketChessSeed();
    const app = await drawn(seed);
    await openTiebreak(app);
    await press(app, T.rung.rapid);
    await press(app, 'L. Chen');
    await press(app, T.record);
    app.scoring.finalize();
    app.realtime.ping();
    await flush(400);
    expect(strip()).toBe(advances('L. Chen', 'rapid'));
    expect(toolNames()).toEqual([]);
    expect(undoCell()).toBeNull();
  });

  // The tie-break sent L. Chen on and the web carried the result forward (the next round seated): it refuses every write
  // from a device link, an Undo inside the window included (403 RESULT_CARRIED_FORWARD, judged before the void). The
  // scorer's Undo is refused once: the card says the result has moved on, the tie-break stands, and Undo is off.
  it('the web carries the tie-break forward, then the scorer takes Undo: the carried-forward card, no void on the ledger, and Undo disabled', async () => {
    const seed = bracketChessSeed();
    const app = await drawn(seed);
    await openTiebreak(app);
    await press(app, T.rung.rapid);
    await press(app, 'L. Chen');
    await press(app, T.record);
    expect(undoCell()).not.toBeNull();
    expect(undoCell()?.getAttribute('aria-disabled')).not.toBe('true');
    app.scoring.carryForward(true);
    const append = vi.spyOn(app.scoring, 'append');
    aSecondOn(app, 5);
    await flush(1_000);
    await press(app, en['scoring.pad.undo']);
    await flush(1_000);
    // The void was asked for once, refused, and never asked for again: the ledger ends on the tie-break.
    expect(await typesOf(app, seed)).toEqual([...BEFORE, 'boardgame.tiebreak']);
    expect(append.mock.calls.map((call) => call[2].type)).toEqual(['core.void']);
    expect(screen.getByTestId('pad-card').textContent).toBe(
      en['scoring.card.carriedForward.title'] + en['scoring.card.carriedForward.body'],
    );
    expect(strip()).toBe(advances('L. Chen', 'rapid'));
    expect(tally()).toBe('½');
    expect(undoCell()).not.toBeNull();
    expect(undoCell()?.getAttribute('aria-disabled')).toBe('true');
  });
});

describe('after an interruption', () => {
  it('the app sent away and back with the sheet open closes it, records nothing, and the sheet starts over', async () => {
    const seed = bracketChessSeed();
    const app = await drawn(seed);
    await openTiebreak(app);
    await press(app, T.rung.armageddon);
    await press(app, 'L. Chen');
    expect(stepTitle(T.titles.result)).toBeTruthy();
    await backgroundAndBack(app);
    await flush(500);
    expect(sheet()).toBeNull();
    expect(screen.getByTestId('pad-content').getAttribute('aria-hidden')).not.toBe('true');
    expect(await typesOf(app, seed)).toEqual(BEFORE);
    expect(toolNames()).toEqual([T.tile]);
    // The question starts again, on the rung, with nothing picked.
    await openTiebreak(app);
    expect(stepTitle(T.titles.rung)).toBeTruthy();
    await press(app, T.rung.armageddon);
    expect(stepTitle(T.titles.black)).toBeTruthy();
  });

  it('Back closes the sheet and nothing else: no tie-break is recorded and the scorer stays on the pad', async () => {
    const seed = bracketChessSeed();
    const app = await drawn(seed);
    await openTiebreak(app);
    await press(app, T.rung.rapid);
    await press(app, 'L. Chen');
    let handled = false;
    act(() => {
      handled = app.back.press();
    });
    await flush(200);
    expect(handled).toBe(true);
    expect(sheet()).toBeNull();
    expect(app.nav.current()).toBe('scoring');
    expect(await typesOf(app, seed)).toEqual(BEFORE);
    expect(toolNames()).toEqual([T.tile]);
  });

  it('a cold start in a drawn game reopens on the pad with the tile, the tie-break goes in from there, and Undo takes it back', async () => {
    const seed = bracketChessSeed(undefined, {
      events: [
        { type: 'core.start', payload: {} },
        { type: 'boardgame.result', payload: { winner: null } },
      ],
    });
    const app = await launchApp({ scoringSeed: seed, kvSeed: inMatch(seed) });
    await flush(200);
    expect(app.nav.current()).toBe('scoring');
    expect(toolNames()).toEqual([T.tile]);
    await openTiebreak(app);
    await press(app, T.rung.blitz);
    await press(app, 'L. Chen');
    await press(app, T.record);
    expect((await lastEvent(app, seed))?.payload).toEqual({ rung: 'blitz', winner: AWAY_ENTRANT });
    expect(strip()).toBe(advances('L. Chen', 'blitz'));
    // The draw before it was another scorer's, but the tie-break is this phone's own, so Undo is offered and voids it.
    expect(undoCell()?.getAttribute('aria-disabled')).not.toBe('true');
    const mine = (await ledger(app, seed)).at(-1);
    await press(app, en['scoring.pad.undo']);
    expect((await lastEvent(app, seed))?.voids).toBe(mine?.id);
    expect(toolNames()).toEqual([T.tile]);
  });
});

describe('a second call', () => {
  // Each step's choices lie on the same edge as the step before: the second touch of a double tap lands on the next step.
  // The phone's clock is not moved between the two clicks, so the second is inside the 250 ms window.
  const touch = async (name: string) => {
    act(() => fireEvent.click(screen.getByRole('button', { name })));
    await flush(60);
  };

  it('a double tap on the tile opens the sheet on its first step and picks no rung', async () => {
    const seed = bracketChessSeed();
    const app = await drawn(seed);
    aSecondOn(app);
    await touch(T.tile);
    expect(stepTitle(T.titles.rung)).toBeTruthy();
    await touch(T.rung.rapid);
    expect(stepTitle(T.titles.rung)).toBeTruthy();
    // Only a touch after the window is the scorer’s own pick.
    await press(app, T.rung.rapid);
    expect(stepTitle(T.titles.winner)).toBeTruthy();
  });

  it('a double tap on a rung picks no winner, and a double tap on a winner records nothing', async () => {
    const seed = bracketChessSeed();
    const app = await drawn(seed);
    await openTiebreak(app);
    aSecondOn(app);
    await touch(T.rung.rapid);
    expect(stepTitle(T.titles.winner)).toBeTruthy();
    await touch('A. Sharma');
    expect(stepTitle(T.titles.winner)).toBeTruthy();
    aSecondOn(app);
    await touch('A. Sharma');
    expect(stepTitle(T.titles.score)).toBeTruthy();
    // Record is on the screen where the winner's row was: a second touch there is not the scorer’s.
    await touch(T.record);
    expect(sheet()).not.toBeNull();
    expect(await typesOf(app, seed)).toEqual(BEFORE);
    aSecondOn(app);
    await touch(T.record);
    expect(sheet()).toBeNull();
    expect(await typesOf(app, seed)).toEqual([...BEFORE, 'boardgame.tiebreak']);
  });

  it('an Armageddon’s steps take no touch on the heels of the one before: Black, the result, then Record', async () => {
    const seed = bracketChessSeed();
    const app = await drawn(seed);
    await openTiebreak(app);
    aSecondOn(app);
    await touch(T.rung.armageddon);
    await touch('A. Sharma');
    expect(stepTitle(T.titles.black)).toBeTruthy();
    aSecondOn(app);
    await touch('A. Sharma');
    expect(stepTitle(T.titles.result)).toBeTruthy();
    await touch(en['scoring.chess.tiebreak.result.draw']);
    expect(stepTitle(T.titles.result)).toBeTruthy();
    aSecondOn(app);
    await touch(en['scoring.chess.tiebreak.result.draw']);
    expect(stepTitle(T.titles.confirm)).toBeTruthy();
    await touch(T.record);
    expect(sheet()).not.toBeNull();
    expect(await typesOf(app, seed)).toEqual(BEFORE);
    aSecondOn(app);
    await touch(T.record);
    expect(await typesOf(app, seed)).toEqual([...BEFORE, 'boardgame.tiebreak']);
  });

  // The sheet's close takes the next touches with it (a close arms the bounce window): the second touch of a double tap on
  // Cancel lands on the tool row under it, where the tile sits, and would open the sheet again.
  it('a second touch on the tile straight after Cancel opens nothing', async () => {
    const seed = bracketChessSeed();
    const app = await drawn(seed);
    await openTiebreak(app);
    aSecondOn(app);
    await touch(T.cancel);
    expect(sheet()).toBeNull();
    await touch(T.tile);
    expect(sheet()).toBeNull();
    await press(app, T.tile);
    expect(sheet()).not.toBeNull();
  });

  // Record on the How sheet of a knockout game's draw closes the sheet and draws the Tie-break tile in the tool row under
  // it: the second touch of a double tap lands on the tile, and the bounce memory the result and the tile share refuses it.
  it('a second touch on the new Tie-break tile straight after the How sheet’s Record for a draw opens nothing', async () => {
    const seed = bracketChessSeed();
    const app = await live(seed);
    await press(app, en['scoring.chess.tool.draw']);
    expect(howSheet()).not.toBeNull();
    aSecondOn(app);
    await touch(T.record);
    expect(howSheet()).toBeNull();
    expect(await typesOf(app, seed)).toEqual(BEFORE);
    // The tile is on the screen under the finger, and the touch on it is the same double tap's.
    expect(tileButton()).not.toBeNull();
    await touch(T.tile);
    expect(sheet()).toBeNull();
    expect(toolNames()).toEqual([T.tile]);
    // Only a touch after the window is the scorer’s own.
    await press(app, T.tile);
    expect(stepTitle(T.titles.rung)).toBeTruthy();
  });
});

describe('History and Match details after a tie-break', () => {
  it('History says the tie-break in the pad’s words, and an undone one is struck in place', async () => {
    const seed = bracketChessSeed();
    const app = await drawn(seed);
    await openTiebreak(app);
    await press(app, T.rung.rapid);
    await press(app, 'L. Chen');
    await press(app, T.record);
    await press(app, en['scoring.history.title']);
    const said = () => screen.getAllByTestId('history-said').map((row) => row.textContent);
    // Newest first: the tie-break, the drawn game, the start.
    expect(said()).toEqual([
      advances('L. Chen', 'rapid'),
      en['scoring.chess.last.drawn'],
      en['scoring.chess.last.start'],
    ]);
    await press(app, en['panel.close']);
    await press(app, en['scoring.pad.undo']);
    await press(app, en['scoring.history.title']);
    expect(said()[0]).toBe(advances('L. Chen', 'rapid'));
    expect(screen.getAllByTestId('history-undone')).toHaveLength(1);
  });
});

// Ruling 63b (owner, "apply rec", 2026-11-07): the organiser's drawing of lots on a drawn knockout game names the player it sent
// through, "{name} advances · by lot", in the strip, the last-tap line and History; Home's card keeps the game's ½–½. The lot is
// `core.settle {method: 'lot'}`, organiser-only: the phone reads it off the engine's fold and never sends one.
describe('The organiser’s drawing of lots (ruling 63b)', () => {
  /** The organiser draws lots for `winner`, and the phone reads the ledger again. */
  async function settledByLot(app: LaunchedApp, winner: string) {
    const lot = app.scoring.addOtherScorerEvent('core.settle', { winner, method: 'lot' });
    app.realtime.ping();
    await flush(400);
    return lot;
  }
  const historySaid = () => screen.getAllByTestId('history-said').map((row) => row.textContent);
  const historyBy = () => screen.getAllByTestId('history-by').map((row) => row.textContent);

  it('History lists the lot on top as another scorer’s, and Home’s Finished card keeps the game’s ½–½', async () => {
    const seed = bracketChessSeed();
    const app = await drawn(seed);
    await settledByLot(app, AWAY_ENTRANT);
    expectSettledByLot('L. Chen');
    await press(app, en['scoring.history.title']);
    // Newest first: the organiser's lot, the drawn game, the start.
    expect(historySaid()).toEqual([
      advances('L. Chen', 'lots'),
      en['scoring.chess.last.drawn'],
      en['scoring.chess.last.start'],
    ]);
    expect(historyBy()).toEqual([
      en['scoring.history.otherScorer'],
      en['scoring.history.thisPhone'],
      en['scoring.history.thisPhone'],
    ]);
    await press(app, en['panel.close']);
    act(() => {
      app.back.press();
    });
    await flush(400);
    expect(app.nav.current()).toBe('home');
    expect(
      within(screen.getByTestId('scoring-continue')).getByText(
        fill(en['home.scoring.finishedScore'], { score: '½–½' }),
      ),
    ).toBeTruthy();
    expect(await typesOf(app, seed)).toEqual([...BEFORE, 'core.settle']);
  });

  it('says it once and the same after a second read and after the app went to the background', async () => {
    const seed = bracketChessSeed();
    const app = await drawn(seed);
    await settledByLot(app, HOME_ENTRANT);
    app.realtime.ping();
    await flush(400);
    expectSettledByLot('A. Sharma');
    await backgroundAndBack(app);
    await flush(400);
    expectSettledByLot('A. Sharma');
    expect(await typesOf(app, seed)).toEqual([...BEFORE, 'core.settle']);
  });

  // The organiser takes the lot back (the web's "void the settle first"): the tie-break is owed again. A lot is never this
  // phone's tap, so no "Undone" line names it: the line says this phone's draw again, with its Undo, as before the lot; the
  // tile is the call, and History keeps the lot struck.
  it('the organiser voids the lot: the tile is owed again, the last-tap line says the draw with its Undo, History strikes the lot', async () => {
    const seed = bracketChessSeed();
    const app = await drawn(seed);
    const lot = await settledByLot(app, HOME_ENTRANT);
    expectSettledByLot('A. Sharma');
    app.scoring.addOtherScorerEvent('core.void', { event_id: lot.id });
    app.realtime.ping();
    await flush(400);
    expect(toolNames()).toEqual([T.tile]);
    expect(strip()).toBe('');
    expect(lastTap()).toBe(en['scoring.chess.last.drawn']);
    expect(undoCell()).not.toBeNull();
    expect(undoCell()?.getAttribute('aria-disabled')).not.toBe('true');
    expect(screen.queryByTestId('pad-card')).toBeNull();
    expect(tally()).toBe('');
    await press(app, en['scoring.history.title']);
    expect(historySaid()[0]).toBe(advances('A. Sharma', 'lots'));
    expect(screen.getAllByTestId('history-undone')).toHaveLength(1);
    await press(app, en['panel.close']);
    // The Undo is this phone's draw's: pressed, it voids the draw and the game is live again.
    const drawId = (await ledger(app, seed))[1]?.id;
    await press(app, en['scoring.pad.undo']);
    await flush(400);
    const rows = await ledger(app, seed);
    expect(rows.map((event) => event.type)).toEqual([
      ...BEFORE,
      'core.settle',
      'core.void',
      'core.void',
    ]);
    expect(rows.at(-1)?.voids).toBe(drawId);
    expect(toolNames()).not.toContain(T.tile);
  });

  // A settle by seed or by the organiser's call is not a lot: the ruling names only the lot, so the pad says the drawn game.
  it.each(['higher_seed', 'organiser'] as const)(
    'a settle by %s names nobody: the strip and the last-tap line say the drawn game',
    async (method) => {
      const seed = bracketChessSeed();
      const app = await drawn(seed);
      app.scoring.addOtherScorerEvent('core.settle', { winner: AWAY_ENTRANT, method });
      app.realtime.ping();
      await flush(400);
      expect(strip()).toBe(en['scoring.chess.last.drawn']);
      expect(lastTap()).toBe(en['scoring.chess.last.drawn']);
      expect(screen.getByTestId('pad-card').textContent).toContain(
        en['scoring.card.resultRecorded.title'],
      );
      expect(toolNames()).toEqual([]);
    },
  );
});

describe.each(Object.entries(DICTIONARIES))('in %s', (language, words: Words) => {
  const launched = async (seed: FakeMatchSeed): Promise<LaunchedApp> => {
    const app = await launchApp({
      scoringSeed: seed,
      kvSeed: inMatch(seed),
      deviceLanguages: [language],
    });
    await flush(200);
    await startPressed(app, words);
    await record(app, null, undefined, words);
    return app;
  };
  const said = (text: string | null) => plain(text ?? '');
  const title = (key: string) => inSheet().getByText(plain(words[key]!));

  it('a Rapid tie-break with a score: the tile, every step, the strip and Home’s card are said in the phone’s language', async () => {
    const seed = bracketChessSeed();
    const app = await launched(seed);
    expect(toolNames().map(said)).toEqual([plain(words['scoring.chess.tiebreak.tool']!)]);
    await press(app, words['scoring.chess.tiebreak.tool']!);
    expect(title('scoring.chess.tiebreak.rung.title')).toBeTruthy();
    expect(inSheet().getByText(plain(words['scoring.chess.tiebreak.lotsHint']!))).toBeTruthy();
    expect(sheetButtons().map(said)).toEqual([
      plain(words['scoring.chess.tiebreak.rung.rapid']!),
      plain(words['scoring.chess.tiebreak.rung.blitz']!),
      plain(words['scoring.chess.tiebreak.rung.armageddon']!),
      plain(words['scoring.sheet.cancel']!),
    ]);
    await press(app, words['scoring.chess.tiebreak.rung.rapid']!);
    expect(title('scoring.chess.tiebreak.winner.title')).toBeTruthy();
    await press(app, 'L. Chen');
    expect(title('scoring.chess.tiebreak.score.title')).toBeTruthy();
    expect(chips().map(said)).toEqual([
      plain(words['scoring.chess.tiebreak.score.none']!),
      '2–0',
      '1½–½',
    ]);
    expect(inSheet().getByText(advances('L. Chen', 'rapid', words))).toBeTruthy();
    await pick(app, '1½–½');
    await press(app, words['scoring.chess.how.record']!);

    expect((await lastEvent(app, seed))?.payload).toEqual({
      rung: 'rapid',
      winner: AWAY_ENTRANT,
      score: '1½–½',
    });
    expect(said(strip())).toBe(advances('L. Chen', 'rapid', words));
    expect(said(lastTap())).toBe(advances('L. Chen', 'rapid', words));
    act(() => {
      app.back.press();
    });
    await flush(400);
    expect(
      within(screen.getByTestId('scoring-continue')).getByText(
        fill(words['home.scoring.finishedScore']!, { score: '½–½' }),
      ),
    ).toBeTruthy();
  });

  it('an Armageddon that was drawn: Black, the result’s three lines, the read-back and the strip say Black advances', async () => {
    const seed = bracketChessSeed();
    const app = await launched(seed);
    await press(app, words['scoring.chess.tiebreak.tool']!);
    await press(app, words['scoring.chess.tiebreak.rung.armageddon']!);
    expect(title('scoring.chess.tiebreak.black.title')).toBeTruthy();
    await press(app, 'A. Sharma');
    expect(title('scoring.chess.tiebreak.result.title')).toBeTruthy();
    expect(sheetButtons().map(said)).toEqual([
      fill(words['scoring.chess.result.white']!, { name: 'L. Chen' }),
      fill(words['scoring.chess.result.black']!, { name: 'A. Sharma' }),
      plain(words['scoring.chess.tiebreak.result.draw']!),
      plain(words['scoring.sheet.cancel']!),
    ]);
    await press(app, words['scoring.chess.tiebreak.result.draw']!);
    expect(title('scoring.chess.tiebreak.confirm.title')).toBeTruthy();
    expect(inSheet().getByText(advances('A. Sharma', 'armageddon', words))).toBeTruthy();
    await press(app, words['scoring.chess.how.record']!);

    expect((await lastEvent(app, seed))?.payload).toEqual({
      rung: 'armageddon',
      black: HOME_ENTRANT,
      result: 'draw',
    });
    expect(said(strip())).toBe(advances('A. Sharma', 'armageddon', words));
    expect(undoCell(words)).toBeTruthy();
  });

  it('a stage that lists no rung says that the organiser decides, in the phone’s language, and offers no tile', async () => {
    const seed = bracketChessSeed([]);
    const app = await launched(seed);
    expect(said(strip())).toBe(plain(words['scoring.chess.waiting.tiebreak']!));
    expect(
      screen.queryByRole('button', { name: plain(words['scoring.chess.tiebreak.tool']!) }),
    ).toBeNull();
    expect(await typesOf(app, seed)).toEqual(BEFORE);
  });

  // Ruling 63b: the organiser's drawing of lots, said in the phone's language in the strip, the last-tap line and History.
  it('the organiser’s drawing of lots names who it sent through in the phone’s language', async () => {
    const seed = bracketChessSeed();
    const app = await launched(seed);
    app.scoring.addOtherScorerEvent('core.settle', { winner: AWAY_ENTRANT, method: 'lot' });
    app.realtime.ping();
    await flush(400);
    expect(said(strip())).toBe(advances('L. Chen', 'lots', words));
    expect(said(lastTap())).toBe(advances('L. Chen', 'lots', words));
    await press(app, words['scoring.history.title']!);
    expect(said(screen.getAllByTestId('history-said')[0]?.textContent ?? null)).toBe(
      advances('L. Chen', 'lots', words),
    );
  });
});
