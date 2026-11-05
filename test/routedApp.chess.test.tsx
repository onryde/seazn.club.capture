import { act, fireEvent, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { encodeSavedCode } from '@/domain/mode/savedCode';
import { chessCfg } from '@/domain/scoring/chessEngine';
import { scoringHubOf } from '@/hooks/scoringHub';
import en from '@/i18n/en.json';
import es from '@/i18n/es.json';
import fr from '@/i18n/fr.json';
import nl from '@/i18n/nl.json';
import { AWAY_ENTRANT, HOME_ENTRANT, chessSeed } from '@/services/fakeChessPad';
import type { FakeMatchSeed } from '@/services/fakeScoringPort';
import { STORE_KEYS } from '@/services/modeStore';
import { TEST_NOW } from './fakePorts';
import { LINK, RAW, linkKey } from './scoringHomeFixtures';
import { backgroundAndBack, flush, launchApp, type LaunchedApp } from './routedApp';

beforeEach(() => {
  seconds = 0;
  vi.useFakeTimers();
});
afterEach(() => vi.useRealTimers());

// Plan S2-3 Task 4: a chess game from the scan to the result, through the route's table, on the fake server with the real
// runner, queue, sender and fold under it (the real engine judges every event). Each test reads what the scorer sees;
// copy and expected states come from the dictionary and the design, never from the code under test. What jsdom cannot see
// (the plates' look, how the chips wrap at 320 dp, a screen reader reading the sheet, a press's feedback) is the device
// check's: nothing here claims it. The four questions: a division without colours is covered in useChessMatch.test.tsx and
// ChessPadScreen.test.tsx; orientation does not apply (Remote Scoring is portrait only).

const DICTIONARIES = { en, es, fr, nl } as const;
type Words = Readonly<Record<string, string>>;

const START = { type: 'core.start', payload: {} } as const;

/** A phone that scanned this match earlier: the code saved, the link kept with the sport the bootstrap named. */
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
      scoring: { fixtureId: seed.fixtureId, label: 'Board 4' },
    }),
    [linkKey(seed.fixtureId)]: JSON.stringify({ ...LINK, sportKey: 'boardgame' }),
  };
}

let seconds = 0;
/** The phone's clock a second on: the next tap is never in the bounce window of the last. */
const aSecondOn = (app: LaunchedApp) => {
  seconds += 1;
  app.setNow(new Date(TEST_NOW.getTime() + seconds * 1000));
};

// A no-break space in a dictionary (French puts one before a colon, a question mark) is matched as a plain space by
// getByText's normaliser, but `textContent` and an accessible name keep it: strings compared to either go through `plain`.
const plain = (text: string) => text.replace(/ /g, ' ');
const fill = (text: string, vars: Record<string, string | number>) =>
  plain(
    Object.entries(vars).reduce(
      (out, [name, value]) => out.replace(`{${name}}`, String(value)),
      text,
    ),
  );

const half = (side: 'first' | 'second') => screen.getByTestId(`half-${side}`);
const plate = (side: 'first' | 'second') => within(half(side)).queryByTestId('plate')?.textContent;
const tally = () => screen.getByTestId('tally').textContent;
const lastTap = () => screen.getByTestId('last-tap-sentence').textContent;
const strip = () => screen.getByTestId('strip-note').textContent;
const howSheet = () => screen.queryByTestId('how-sheet');
const toolNames = () =>
  within(screen.getByTestId('tool-row'))
    .getAllByRole('button')
    .map((button) => button.getAttribute('aria-label'));
const choices = () => screen.getAllByRole('radio').map((choice) => choice.textContent);
const undoCell = (words: Words = en) =>
  screen.queryByRole('button', { name: words['scoring.pad.undo'] });

/** The ledger the fake server holds for the match, whoever wrote it. */
async function ledger(app: LaunchedApp, seed: FakeMatchSeed) {
  const rows = await app.scoring.events(LINK, seed.fixtureId, 0);
  if (!Array.isArray(rows))
    throw new Error(`the fake server answered the ledger with ${JSON.stringify(rows)}`);
  return rows;
}
const typesOf = async (app: LaunchedApp, seed: FakeMatchSeed) =>
  (await ledger(app, seed)).map((event) => event.type);

/** A button pressed a second after the last thing the scorer did, and the time its sheet needs before it takes a choice. */
async function press(app: LaunchedApp, name: string): Promise<void> {
  aSecondOn(app);
  act(() => fireEvent.click(screen.getByRole('button', { name })));
  await flush(400);
}

async function tapHalf(app: LaunchedApp, side: 'first' | 'second'): Promise<void> {
  aSecondOn(app);
  act(() => fireEvent.click(half(side)));
  await flush(400);
}

async function pick(app: LaunchedApp, name: string): Promise<void> {
  aSecondOn(app);
  act(() => fireEvent.click(screen.getByRole('radio', { name })));
  await flush(0);
}

/** The match scanned from Home, as the scorer scans it, and the Start screen it opens on. */
async function scanned(seed: FakeMatchSeed = chessSeed()): Promise<LaunchedApp> {
  const app = await launchApp({ scoringSeed: seed });
  app.scanner.queue({ outcome: 'scanned', raw: RAW });
  act(() => screen.getByRole('button', { name: /Remote Scoring/ }).click());
  await flush(400);
  return app;
}

/** Start match pressed once, a minute before the test's taps (it opens the bounce window for the next tap). */
async function startPressed(app: LaunchedApp, words: Words = en): Promise<void> {
  app.setNow(new Date(TEST_NOW.getTime() - 60_000));
  act(() => fireEvent.click(screen.getByRole('button', { name: words['scoring.start.confirm'] })));
  app.setNow(TEST_NOW);
  await flush(200);
}

/** The match scanned and started: the live pad of a game nobody has played a move in. */
async function live(seed: FakeMatchSeed = chessSeed()): Promise<LaunchedApp> {
  const app = await scanned(seed);
  await startPressed(app);
  return app;
}

/** A result recorded through the sheet, as the scorer does it: a half (or Draw for null), a method if given, Record. */
async function record(
  app: LaunchedApp,
  winner: 'first' | 'second' | null,
  method?: string,
  words: Words = en,
): Promise<void> {
  if (winner === null) await press(app, words['scoring.chess.tool.draw']!);
  else await tapHalf(app, winner);
  if (method !== undefined) await pick(app, method);
  await press(app, words['scoring.chess.how.record']!);
}

const DECISIVE = [
  'scoring.chess.method.checkmate',
  'scoring.chess.method.resign',
  'scoring.chess.method.time',
  'scoring.chess.method.adjudication',
  'scoring.chess.method.illegal_move',
] as const;
const DRAWN = [
  'scoring.chess.method.agreement',
  'scoring.chess.method.stalemate',
  'scoring.chess.method.insufficient',
  'scoring.chess.method.adjudication',
  'scoring.chess.method.repetition',
  'scoring.chess.method.fifty_move',
  'scoring.chess.method.dead_position',
] as const;

describe('a chess game from the scan to the pad', () => {
  it('a scanned link opens the match check: both names with their colours, no serve to pick, Start match ready', async () => {
    const app = await scanned();
    expect(app.nav.current()).toBe('scoring');
    expect(screen.getByTestId('start-screen')).toBeTruthy();
    // The names keep their places and each carries its colour's word (design §4 step 1); White is the first side's by default.
    const first = screen.getByTestId('start-side-first');
    const second = screen.getByTestId('start-side-second');
    expect(within(first).getByText('A. Sharma')).toBeTruthy();
    expect(within(first).getByTestId('plate').textContent).toBe(en['scoring.chess.chip.white']);
    expect(within(second).getByText('L. Chen')).toBeTruthy();
    expect(within(second).getByTestId('plate').textContent).toBe(en['scoring.chess.chip.black']);
    // No serve to pick (ruling 57): the kit draws no question and no picker, and Start match waits for nothing.
    expect(screen.queryAllByRole('radio')).toEqual([]);
    expect(
      screen
        .getByRole('button', { name: en['scoring.start.confirm'] })
        .getAttribute('aria-disabled'),
    ).not.toBe('true');
    expect(screen.queryByTestId('half-first')).toBeNull();
    expect(await typesOf(app, chessSeed())).toEqual([]);
  });

  it('Start match is one tap with no pick: exactly one core.start with an empty payload, and the pad opens', async () => {
    const app = await scanned();
    const append = vi.spyOn(app.scoring, 'append');
    await startPressed(app);
    expect(append).toHaveBeenCalledTimes(1);
    const rows = await ledger(app, chessSeed());
    expect(rows.map((event) => event.type)).toEqual(['core.start']);
    expect(rows[0]?.payload).toEqual({});
    expect(screen.queryByTestId('start-screen')).toBeNull();
    expect(within(half('first')).getByText('A. Sharma')).toBeTruthy();
    expect(within(half('second')).getByText('L. Chen')).toBeTruthy();
    expect(plate('first')).toBe(en['scoring.chess.chip.white']);
    expect(plate('second')).toBe(en['scoring.chess.chip.black']);
    expect(lastTap()).toBe(en['scoring.chess.last.start']);
    expect(toolNames()).toEqual([en['scoring.chess.tool.draw'], en['scoring.chess.tool.swap']]);
  });
});

describe('a result, through the sheet that asks How', () => {
  it('Draw, Agreement, Record: the pad reads the draw and names how; Undo makes the game live again', async () => {
    const app = await live();
    await press(app, en['scoring.chess.tool.draw']);
    // The question is about the game, not a player, and offers the drawn methods and no decisive one.
    expect(screen.getByText(en['scoring.chess.how.drawn'])).toBeTruthy();
    expect(choices()).toEqual(DRAWN.map((key) => en[key]));
    expect(await typesOf(app, chessSeed())).toEqual(['core.start']);
    await pick(app, en['scoring.chess.method.agreement']);
    await press(app, en['scoring.chess.how.record']);

    expect(howSheet()).toBeNull();
    expect((await ledger(app, chessSeed())).at(-1)).toMatchObject({
      type: 'boardgame.result',
      payload: { winner: null, method: 'agreement' },
    });
    // Ruling on the header: a draw is a bare half at 320 dp; the strip and the last-tap line carry the words.
    expect(tally()).toBe('½');
    expect(strip()).toBe(en['scoring.chess.last.drawn']);
    expect(lastTap()).toBe(
      fill(en['scoring.chess.last.drawnBy'], { how: en['scoring.chess.method.agreement'] }),
    );
    expect(screen.getByTestId('pad-card').textContent).toContain(
      en['scoring.card.resultRecorded.title'],
    );
    expect(half('first').getAttribute('aria-disabled')).toBe('true');

    await press(app, en['scoring.pad.undo']);
    expect(await typesOf(app, chessSeed())).toEqual([
      'core.start',
      'boardgame.result',
      'core.void',
    ]);
    expect(tally()).toBe('');
    expect(lastTap()).toBe(
      fill(en['scoring.chess.last.undone'], {
        what: fill(en['scoring.chess.last.drawnBy'], { how: en['scoring.chess.method.agreement'] }),
      }),
    );
    expect(toolNames()).toEqual([en['scoring.chess.tool.draw'], en['scoring.chess.tool.swap']]);
    expect(half('first').getAttribute('aria-disabled')).not.toBe('true');
    // The game is live again: a different result goes in.
    await record(app, 'second', en['scoring.chess.method.time']);
    expect((await ledger(app, chessSeed())).at(-1)).toMatchObject({
      type: 'boardgame.result',
      payload: { winner: AWAY_ENTRANT, method: 'time' },
    });
  });

  it('a win asks about that player, offers only the decisive methods, and a black win is the other entrant’s', async () => {
    const app = await live();
    await tapHalf(app, 'second');
    expect(screen.getByText(fill(en['scoring.chess.how.won'], { name: 'L. Chen' }))).toBeTruthy();
    expect(choices()).toEqual(DECISIVE.map((key) => en[key]));
    await pick(app, en['scoring.chess.method.resign']);
    await press(app, en['scoring.chess.how.record']);
    expect((await ledger(app, chessSeed())).at(-1)).toMatchObject({
      type: 'boardgame.result',
      payload: { winner: AWAY_ENTRANT, method: 'resign' },
    });
    // L. Chen held Black: the scoresheet writes White's score first.
    expect(tally()).toBe('0–1');
    expect(lastTap()).toBe(
      fill(en['scoring.chess.last.wonBy'], {
        name: 'L. Chen',
        how: en['scoring.chess.method.resign'],
      }),
    );
  });

  it('with no method chosen Record still goes, and the result carries none', async () => {
    const app = await live();
    await record(app, 'first');
    const result = (await ledger(app, chessSeed())).at(-1);
    expect(result).toMatchObject({ type: 'boardgame.result', payload: { winner: HOME_ENTRANT } });
    expect(Object.keys(result?.payload as object)).not.toContain('method');
    expect(tally()).toBe('1–0');
    expect(lastTap()).toBe(fill(en['scoring.chess.last.won'], { name: 'A. Sharma' }));
  });

  it('after Swap, a white win is the entrant now holding White, and Home’s card reads first-side-first', async () => {
    const app = await live();
    await press(app, en['scoring.chess.tool.swap']);
    // The names keep their places; the plates move.
    expect(within(half('first')).getByText('A. Sharma')).toBeTruthy();
    expect(plate('first')).toBe(en['scoring.chess.chip.black']);
    expect(plate('second')).toBe(en['scoring.chess.chip.white']);
    expect((await ledger(app, chessSeed())).at(-1)).toMatchObject({
      type: 'boardgame.pairing',
      payload: { white: AWAY_ENTRANT },
    });
    // The half that says "White won · L. Chen" is the one tapped.
    expect(
      within(half('second')).getByText(fill(en['scoring.chess.result.white'], { name: 'L. Chen' })),
    ).toBeTruthy();
    await tapHalf(app, 'second');
    await press(app, en['scoring.chess.how.record']);

    const rows = await ledger(app, chessSeed());
    expect(rows.map((event) => event.type)).toEqual([
      'core.start',
      'boardgame.pairing',
      'boardgame.result',
    ]);
    // The ledger's winner is the entrant holding White now: not the home side.
    expect(rows.at(-1)?.payload).toMatchObject({ winner: AWAY_ENTRANT });
    // The pad writes the game as a scoresheet does, White's score first; the player's name is beside it.
    expect(tally()).toBe('1–0');
    expect(lastTap()).toBe(fill(en['scoring.chess.last.won'], { name: 'L. Chen' }));

    // Home's card reads the first side first: A. Sharma (first) lost, so 0–1 whoever held White.
    act(() => {
      app.back.press();
    });
    await flush(400);
    expect(app.nav.current()).toBe('home');
    expect(
      within(screen.getByTestId('scoring-continue')).getByText(
        fill(en['home.scoring.finishedScore'], { score: '0–1' }),
      ),
    ).toBeTruthy();
  });

  it('a draw is ½–½ on Home’s card', async () => {
    const app = await live();
    await record(app, null, en['scoring.chess.method.agreement']);
    act(() => {
      app.back.press();
    });
    await flush(400);
    expect(
      within(screen.getByTestId('scoring-continue')).getByText(
        fill(en['home.scoring.finishedScore'], { score: '½–½' }),
      ),
    ).toBeTruthy();
  });
});

describe('a bracket stage', () => {
  it('a drawn game waits for its tie-break: the Tie-break tool replaces the line, and no result can be recorded', async () => {
    const seed = chessSeed({ cfg: chessCfg({ tiebreak: true }) });
    const app = await live(seed);
    expect(strip()).toBe(en['scoring.chess.forfeit']);
    await record(app, null);
    expect((await ledger(app, seed)).at(-1)).toMatchObject({
      type: 'boardgame.result',
      payload: { winner: null },
    });
    expect(strip()).toBe('');
    expect(screen.getByRole('button', { name: en['scoring.chess.tiebreak.tool'] })).toBeTruthy();
    expect(half('first').getAttribute('aria-disabled')).toBe('true');
    expect(half('second').getAttribute('aria-disabled')).toBe('true');
    expect(screen.queryAllByRole('button', { name: en['scoring.chess.tool.draw'] })).toEqual([]);
    expect(screen.queryByRole('radio')).toBeNull();
  });
});

describe('a bracket stage: the Tie-break tile', () => {
  // Task 3 walks every rung; this one proves the tile is wired through the route: it opens the sheet and a Rapid tie-break
  // reaches the ledger and the pad.
  it('opens the sheet, and a Rapid tie-break sends L. Chen through', async () => {
    const seed = chessSeed({ cfg: chessCfg({ tiebreak: true }) });
    const app = await live(seed);
    await record(app, null);
    await press(app, en['scoring.chess.tiebreak.tool']);
    expect(screen.getByTestId('tiebreak-sheet')).toBeTruthy();
    expect(screen.getByText(en['scoring.chess.tiebreak.rung.title'])).toBeTruthy();
    await press(app, en['scoring.chess.tiebreak.rung.rapid']);
    await press(app, 'L. Chen');
    await press(app, en['scoring.chess.how.record']);
    expect(screen.queryByTestId('tiebreak-sheet')).toBeNull();
    expect((await ledger(app, seed)).at(-1)).toMatchObject({
      type: 'boardgame.tiebreak',
      payload: { rung: 'rapid', winner: AWAY_ENTRANT },
    });
    expect(strip()).toBe('L. Chen advances · Rapid');
    expect(tally()).toBe('½');
    expect(undoCell()).toBeTruthy();
  });
});

describe('a second scorer', () => {
  it('records first while the sheet is open: the sheet closes, the pad shows their result, and this scorer’s never goes', async () => {
    const app = await live();
    await tapHalf(app, 'first');
    expect(howSheet()).toBeTruthy();
    app.scoring.addOtherScorerEvent('boardgame.result', { winner: AWAY_ENTRANT, method: 'time' });
    app.realtime.ping();
    await flush(400);
    expect(howSheet()).toBeNull();
    expect(tally()).toBe('0–1');
    expect(lastTap()).toBe(
      fill(en['scoring.chess.last.wonBy'], {
        name: 'L. Chen',
        how: en['scoring.chess.method.time'],
      }),
    );
    expect(await typesOf(app, chessSeed())).toEqual(['core.start', 'boardgame.result']);
    expect(half('first').getAttribute('aria-disabled')).toBe('true');
  });

  // The Undo cell needs two things: this phone's Undo window and the fold's `undoable` (a result of this phone's own).
  // Either alone hides it for a result written elsewhere, so this test pins the outcome, not a guard. The fold's
  // `undoable` is carried by the unseen-conflict test below, the Undo window by the "found again" test after it.
  it('a result another scorer wrote and the pad was told of has no Undo cell', async () => {
    const app = await live();
    app.scoring.addOtherScorerEvent('boardgame.result', { winner: null });
    app.realtime.ping();
    await flush(400);
    expect(tally()).toBe('½');
    expect(undoCell()).toBeNull();
  });

  it('this phone’s own result, on the same screen, does have an Undo cell', async () => {
    const app = await live();
    await record(app, 'first');
    expect(undoCell()).toBeTruthy();
  });

  // The web's seq conflict, reconciled as S2 does (spec §8): the other scorer's result is on the server before this phone
  // has read it, and Record is pressed on a pad that does not know. Their result stands; ours is never written, and Undo
  // is not offered for a result that is not this phone's.
  it('records between this scorer’s How and Record, unseen: their result stands, ours never lands, no Undo', async () => {
    const app = await live();
    await tapHalf(app, 'first');
    app.scoring.addOtherScorerEvent('boardgame.result', { winner: AWAY_ENTRANT, method: 'time' });
    await press(app, en['scoring.chess.how.record']);
    await flush(1_000);
    expect(howSheet()).toBeNull();
    expect(await typesOf(app, chessSeed())).toEqual(['core.start', 'boardgame.result']);
    expect(tally()).toBe('0–1');
    expect(strip()).toBe(fill(en['scoring.chess.last.won'], { name: 'L. Chen' }));
    // The scorer is told their Record did not count, not left to guess from a changed score.
    expect(screen.getByTestId('refusal').textContent).toBe(en['scoring.refusal.notCounted']);
    expect(undoCell()).toBeNull();
  });

  // The hub keeps this phone's own tap ids for a day after the match is left, and the Undo window never starts from a
  // ledger read (owner, 2026-11-03): a result found again is this phone's but its Undo is closed.
  it('this phone’s own result, found again after the match was left, has no Undo', async () => {
    const seed = chessSeed();
    const app = await live(seed);
    await record(app, 'first');
    expect(undoCell()).toBeTruthy();
    act(() => {
      app.back.press();
    });
    await flush(200);
    await scoringHubOf(app.ports).leave(seed.fixtureId);
    await app.kv.set(linkKey(seed.fixtureId), JSON.stringify({ ...LINK, sportKey: 'boardgame' }));
    act(() => app.ports.navigation.go('scoring'));
    await flush(1_500);
    expect(tally()).toBe('1–0');
    expect(undoCell()).toBeNull();
  });
});

describe('after an interruption', () => {
  it('the app sent away and back with the sheet open closes it, records nothing, and the pad takes a result again', async () => {
    const app = await live();
    await tapHalf(app, 'second');
    await pick(app, en['scoring.chess.method.time']);
    expect(howSheet()).toBeTruthy();
    await backgroundAndBack(app);
    await flush(500);
    expect(howSheet()).toBeNull();
    expect(screen.getByTestId('pad-content').getAttribute('aria-hidden')).not.toBe('true');
    expect(await typesOf(app, chessSeed())).toEqual(['core.start']);
    // The question starts again with nothing picked.
    await tapHalf(app, 'second');
    expect(
      screen
        .getByRole('radio', { name: en['scoring.chess.method.time'] })
        .getAttribute('aria-checked'),
    ).toBe('false');
  });

  it('a cold start in a started game reopens on the pad, and a result goes in from there', async () => {
    const seed = chessSeed({ events: [START] });
    const app = await launchApp({ scoringSeed: seed, kvSeed: inMatch(seed) });
    await flush(200);
    expect(app.nav.current()).toBe('scoring');
    expect(screen.queryByTestId('start-screen')).toBeNull();
    await record(app, 'first', en['scoring.chess.method.checkmate']);
    expect((await ledger(app, seed)).at(-1)).toMatchObject({
      type: 'boardgame.result',
      payload: { winner: HOME_ENTRANT, method: 'checkmate' },
    });
  });
});

describe('the four questions', () => {
  // Start match opens the bounce window for every tap (`useTaps`' `opening`): the second touch of a double tap lands on the
  // pad that takes the screen's place, on a half, and must count once, not open the How sheet for a player.
  it('a second Start press records the start once, and a touch on the half that appears under it opens nothing', async () => {
    const app = await scanned();
    app.setNow(new Date(TEST_NOW.getTime() - 60_000));
    const append = vi.spyOn(app.scoring, 'append');
    const start = screen.getByRole('button', { name: en['scoring.start.confirm'] });
    act(() => {
      fireEvent.click(start);
      fireEvent.click(start);
    });
    await flush(60);
    act(() => fireEvent.click(half('first')));
    await flush(2_000);
    expect(append).toHaveBeenCalledTimes(1);
    expect(await typesOf(app, chessSeed())).toEqual(['core.start']);
    expect(howSheet()).toBeNull();
    // Only the touch that follows the window opens the question.
    app.setNow(TEST_NOW);
    await tapHalf(app, 'first');
    expect(howSheet()).toBeTruthy();
  });

  // A double tap on Record: the first closes the sheet and records, the second lands on what was under it. Undo is there
  // under the finger (the review of 2026-11-01: a sheet's recording button opens the bounce window for every tap), and it
  // must not take the result back that the same tap just made.
  it('a second touch on Undo straight after Record counts once, and the result stands', async () => {
    const app = await live();
    await tapHalf(app, 'first');
    const recordButton = screen.getByRole('button', { name: en['scoring.chess.how.record'] });
    const append = vi.spyOn(app.scoring, 'append');
    aSecondOn(app);
    act(() => fireEvent.click(recordButton));
    // A moment on (the result reaches the pad and Undo is live), the phone's clock still inside the 250 ms window.
    await flush(60);
    const undo = screen.getByRole('button', { name: en['scoring.pad.undo'] });
    expect(undo.getAttribute('aria-disabled')).not.toBe('true');
    act(() => fireEvent.click(undo));
    await flush(2_000);
    expect(append).toHaveBeenCalledTimes(1);
    expect(await typesOf(app, chessSeed())).toEqual(['core.start', 'boardgame.result']);
    expect(tally()).toBe('1–0');
  });

  // A double tap on the sheet's Cancel (or its dim): the first closes the sheet, the second lands on the pad under it, where
  // Swap colours sits at the same height and writes a pairing (the Batch B review, I1). A close opens the bounce window.
  it.each([
    ['Cancel', () => screen.getByRole('button', { name: en['scoring.sheet.cancel'] })],
    ['the dim', () => screen.getByTestId('how-dim')],
  ] as const)(
    'a second touch on the tool row straight after %s counts once: no pairing is written',
    async (_name, closer) => {
      const app = await live();
      await tapHalf(app, 'first');
      const close = closer();
      const append = vi.spyOn(app.scoring, 'append');
      aSecondOn(app);
      act(() => fireEvent.click(close));
      // A moment on (the sheet is gone and the tools are live), the phone's clock still inside the 250 ms window.
      await flush(60);
      expect(howSheet()).toBeNull();
      act(() =>
        fireEvent.click(screen.getByRole('button', { name: en['scoring.chess.tool.swap'] })),
      );
      await flush(2_000);
      expect(append).not.toHaveBeenCalled();
      expect(await typesOf(app, chessSeed())).toEqual(['core.start']);
      // Only a touch after the window is the scorer's own Swap colours.
      await press(app, en['scoring.chess.tool.swap']);
      expect(await typesOf(app, chessSeed())).toEqual(['core.start', 'boardgame.pairing']);
    },
  );

  it('Swap pressed twice in the same moment writes one pairing', async () => {
    const app = await live();
    const swap = screen.getByRole('button', { name: en['scoring.chess.tool.swap'] });
    const append = vi.spyOn(app.scoring, 'append');
    aSecondOn(app);
    act(() => {
      fireEvent.click(swap);
      fireEvent.click(swap);
    });
    await flush(2_000);
    expect(append).toHaveBeenCalledTimes(1);
  });

  it('no method on offer fits a result it would contradict: no forfeit, and a draw offers no checkmate', async () => {
    const app = await live();
    await press(app, en['scoring.chess.tool.draw']);
    expect(choices()).not.toContain(en['scoring.chess.method.checkmate']);
    expect(choices()).not.toContain(en['scoring.chess.method.resign']);
    expect(choices().join(' | ')).not.toMatch(/forfeit|walkover/i);
  });
});

describe.each(Object.entries(DICTIONARIES))('in %s', (language, words: Words) => {
  it('the start, the sheet, the result, Undo and Home’s card are said in the phone’s language', async () => {
    const seed = chessSeed();
    const app = await launchApp({
      scoringSeed: seed,
      kvSeed: inMatch(seed),
      deviceLanguages: [language],
    });
    await flush(200);
    expect(screen.getByTestId('start-screen')).toBeTruthy();
    expect(within(screen.getByTestId('start-side-first')).getByTestId('plate').textContent).toBe(
      plain(words['scoring.chess.chip.white']!),
    );
    expect(within(screen.getByTestId('start-side-second')).getByTestId('plate').textContent).toBe(
      plain(words['scoring.chess.chip.black']!),
    );
    await startPressed(app, words);
    expect(lastTap()).toBe(plain(words['scoring.chess.last.start']!));
    // A string with a name in it, said in the language (what a tap on the half records).
    expect(
      within(half('first')).getByText(
        fill(words['scoring.chess.result.white']!, { name: 'A. Sharma' }),
      ),
    ).toBeTruthy();

    await press(app, words['scoring.chess.tool.draw']!);
    expect(screen.getByText(plain(words['scoring.chess.how.drawn']!))).toBeTruthy();
    expect(choices()).toEqual(DRAWN.map((key) => plain(words[key]!)));
    await pick(app, plain(words['scoring.chess.method.agreement']!));
    await press(app, plain(words['scoring.chess.how.record']!));

    expect((await ledger(app, seed)).at(-1)).toMatchObject({
      type: 'boardgame.result',
      payload: { winner: null, method: 'agreement' },
    });
    expect(tally()).toBe('½');
    expect(lastTap()).toBe(
      fill(words['scoring.chess.last.drawnBy']!, { how: words['scoring.chess.method.agreement']! }),
    );
    expect(undoCell(words)).toBeTruthy();

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
});
