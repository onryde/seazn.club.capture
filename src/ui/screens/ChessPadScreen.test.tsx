import { act, fireEvent, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { encodeSavedCode } from '@/domain/mode/savedCode';
import { chessCfg } from '@/domain/scoring/chessEngine';
import en from '@/i18n/en.json';
import es from '@/i18n/es.json';
import fr from '@/i18n/fr.json';
import nl from '@/i18n/nl.json';
import { AWAY_ENTRANT, HOME_ENTRANT, chessSeed } from '@/services/fakeChessPad';
import type { FakeMatchSeed } from '@/services/fakeScoringPort';
import { STORE_KEYS } from '@/services/modeStore';
import { TEST_NOW } from '../../../test/fakePorts';
import { ledgerOf, result } from '../../../test/chessLedger';
import { screenIsHeld, type HoldLog } from '../../../test/heldScreen';
import { linkKey } from '../../../test/scoringHomeFixtures';
import { backgroundAndBack, flush, launchApp, type LaunchedApp } from '../../../test/routedApp';

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

// Plan S2-3 Task 3: the chess pad screen and the sheet that asks How (design §4 to §6), on the fake server with the real
// runner, queue, sender and fold under it. Each test reads what the scorer sees; copy is the dictionary's. What jsdom
// cannot see (the plates and the lime fill drawn, how the chips wrap at 320 dp, a screen reader reading the sheet, a
// press's feedback) is the device check's.

const LINK = { origin: 'https://stg.seazn.club', token: 'dl_madeUpTokenForChess0000001' };

const START = { type: 'core.start', payload: {} } as const;
const DRAW = { type: 'boardgame.result', payload: { winner: null } } as const;

/** A phone that scanned `seed`'s match earlier: the code saved, the link kept with the sport the bootstrap named. */
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

/** A game another scorer started: the pad is live from the first read. */
const LIVE = chessSeed({ events: [START] });

/** Time passing: the phone's clock and the timers move together, a second at a time. */
async function pass(app: LaunchedApp, ms: number): Promise<void> {
  for (let elapsed = 0; elapsed < ms; elapsed += 1000) {
    aSecondOn(app);
    await flush(1000);
  }
}

const half = (side: 'first' | 'second') => screen.getByTestId(`half-${side}`);
const plate = (side: 'first' | 'second') => within(half(side)).queryByTestId('plate')?.textContent;
const strip = () => screen.getByTestId('strip-note').textContent;
const tally = () => screen.getByTestId('tally').textContent;
const lastTap = () => screen.getByTestId('last-tap-sentence').textContent;
const toolNames = () =>
  within(screen.getByTestId('tool-row'))
    .getAllByRole('button')
    .map((button) => button.getAttribute('aria-label'));
const choices = () => screen.getAllByRole('radio').map((choice) => choice.textContent);
// A no-break space in a dictionary (French puts one before a colon, a question mark) reads as a plain space in the DOM.
const plain = (text: string) => text.replace(/\u00a0/g, ' ');
const fill = (text: string, vars: Record<string, string | number>) =>
  plain(
    Object.entries(vars).reduce(
      (out, [name, value]) => out.replace(`{${name}}`, String(value)),
      text,
    ),
  );

const events = async (app: LaunchedApp, seed: FakeMatchSeed) => {
  const ledger = await app.scoring.events(LINK, seed.fixtureId, 0);
  return Array.isArray(ledger) ? ledger : [];
};
const typesOf = async (app: LaunchedApp, seed: FakeMatchSeed = LIVE) =>
  (await events(app, seed)).map((event) => event.type);

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

/** The match opened as the phone finds it, a minute before the test's taps. */
async function open(seed: FakeMatchSeed = LIVE, over: Parameters<typeof launchApp>[0] = {}) {
  const app = await launchApp({ scoringSeed: seed, kvSeed: inMatch(seed), ...over });
  await flush(200);
  app.setNow(new Date(TEST_NOW.getTime() - 60_000));
  return app;
}

/** A result recorded through the sheet by this phone, as the scorer does it. */
async function record(app: LaunchedApp, side: 'first' | 'second' | null, method?: string) {
  if (side === null) await press(app, en['scoring.chess.tool.draw']);
  else await tapHalf(app, side);
  if (method !== undefined) await pick(app, method);
  await press(app, en['scoring.chess.how.record']);
}

describe('the Start screen', () => {
  it('names the two players with their colours, has no serve to pick, and Start match is ready', async () => {
    await open(chessSeed());
    const rows = screen.getByTestId('start-sides');
    expect(within(screen.getByTestId('start-side-first')).getByText('A. Sharma')).toBeTruthy();
    expect(within(screen.getByTestId('start-side-first')).getByTestId('plate').textContent).toBe(
      en['scoring.chess.chip.white'],
    );
    expect(within(screen.getByTestId('start-side-second')).getByTestId('plate').textContent).toBe(
      en['scoring.chess.chip.black'],
    );
    expect(rows).toBeTruthy();
    expect(screen.queryAllByRole('radio')).toEqual([]);
    const startButton = screen.getByRole('button', { name: en['scoring.start.confirm'] });
    expect(startButton.getAttribute('aria-disabled')).not.toBe('true');
  });

  it('Start match starts the game with no side named, and the players are the halves', async () => {
    const app = await open(chessSeed());
    act(() => fireEvent.click(screen.getByRole('button', { name: en['scoring.start.confirm'] })));
    await flush(200);
    expect(await typesOf(app, chessSeed())).toEqual(['core.start']);
    expect((await events(app, chessSeed()))[0]?.payload).toEqual({});
    expect(half('first')).toBeTruthy();
    expect(half('second')).toBeTruthy();
  });
});

describe('the live game', () => {
  it('shows each player on a half with the colour in words, and what a tap records', async () => {
    await open();
    expect(within(half('first')).getByText('A. Sharma')).toBeTruthy();
    expect(within(half('second')).getByText('L. Chen')).toBeTruthy();
    expect(plate('first')).toBe(en['scoring.chess.chip.white']);
    expect(plate('second')).toBe(en['scoring.chess.chip.black']);
    expect(
      within(half('first')).getByText(
        fill(en['scoring.chess.result.white'], { name: 'A. Sharma' }),
      ),
    ).toBeTruthy();
    expect(
      within(half('second')).getByText(fill(en['scoring.chess.result.black'], { name: 'L. Chen' })),
    ).toBeTruthy();
    // The colour is in the half's name for a screen reader, beside the player.
    expect(half('first').getAttribute('aria-label')).toContain(en['scoring.chess.chip.white']);
  });

  it('offers Draw and Swap colours, and says in one line that forfeits are the organiser’s', async () => {
    await open();
    expect(toolNames()).toEqual([en['scoring.chess.tool.draw'], en['scoring.chess.tool.swap']]);
    expect(strip()).toBe(en['scoring.chess.forfeit']);
  });

  // The header's visible tally is empty before a result; what a screen reader says for it must not be an empty sentence.
  it('says "no result" for the header while no result stands, and the points once one does', async () => {
    const app = await open();
    const label = () => screen.getByTestId('tally').getAttribute('aria-label');
    expect(tally()).toBe('');
    expect(label()).toBe(en['scoring.chess.tallyNone']);
    await record(app, 'first');
    expect(label()).toBe(
      fill(en['scoring.chess.tallySaid'], {
        first: 'A. Sharma',
        firstPoints: '1',
        second: 'L. Chen',
        secondPoints: '0',
      }),
    );
  });

  it('holds the screen on while the pad stands', async () => {
    await open();
    expect(screenIsHeld(holds)).toBe(true);
  });

  it('every button has a name a screen reader can say', async () => {
    await open();
    for (const button of screen.getAllByRole('button')) {
      const name = button.getAttribute('aria-label') ?? button.textContent ?? '';
      expect(name.trim(), button.outerHTML.slice(0, 80)).not.toBe('');
    }
  });
});

describe('a division without colours', () => {
  const NO_COLOURS = chessSeed({ events: [START], cfg: chessCfg({ colors: false }) });

  it('shows no plates, says “{name} won”, and offers only Draw', async () => {
    await open(NO_COLOURS);
    expect(plate('first')).toBeUndefined();
    expect(plate('second')).toBeUndefined();
    expect(
      within(half('first')).getByText(
        fill(en['scoring.chess.result.plain'], { name: 'A. Sharma' }),
      ),
    ).toBeTruthy();
    expect(toolNames()).toEqual([en['scoring.chess.tool.draw']]);
  });
});

describe('the sheet that asks How', () => {
  it('a half opens it for that player: the decisive methods in order, Record and Cancel, and nothing is sent', async () => {
    const app = await open();
    await tapHalf(app, 'second');
    expect(screen.getByText(fill(en['scoring.chess.how.won'], { name: 'L. Chen' }))).toBeTruthy();
    expect(choices()).toEqual([
      en['scoring.chess.method.checkmate'],
      en['scoring.chess.method.resign'],
      en['scoring.chess.method.time'],
      en['scoring.chess.method.adjudication'],
      en['scoring.chess.method.illegal_move'],
    ]);
    expect(screen.getByRole('button', { name: en['scoring.chess.how.record'] })).toBeTruthy();
    expect(screen.getByRole('button', { name: en['scoring.sheet.cancel'] })).toBeTruthy();
    expect(screen.getByTestId('pad-content').getAttribute('aria-hidden')).toBe('true');
    expect(await typesOf(app)).toEqual(['core.start']);
  });

  it('Draw opens it for a draw: the drawn methods, and the question is not about a player', async () => {
    const app = await open();
    await press(app, en['scoring.chess.tool.draw']);
    expect(screen.getByText(en['scoring.chess.how.drawn'])).toBeTruthy();
    expect(choices()).toEqual([
      en['scoring.chess.method.agreement'],
      en['scoring.chess.method.stalemate'],
      en['scoring.chess.method.insufficient'],
      en['scoring.chess.method.adjudication'],
      en['scoring.chess.method.repetition'],
      en['scoring.chess.method.fifty_move'],
      en['scoring.chess.method.dead_position'],
    ]);
  });

  it('offers no forfeit and no walkover, and no method the engine would refuse for the result', async () => {
    const app = await open();
    await tapHalf(app, 'first');
    expect(choices().join(' | ')).not.toMatch(/forfeit|walkover|forfait|wo\b/i);
    expect(choices()).not.toContain(en['scoring.chess.method.stalemate']);
  });

  it('a method is picked, shown picked, and tapped again is none', async () => {
    const app = await open();
    await tapHalf(app, 'first');
    await pick(app, en['scoring.chess.method.time']);
    const picked = (name: string) =>
      screen.getByRole('radio', { name }).getAttribute('aria-checked');
    expect(picked(en['scoring.chess.method.time'])).toBe('true');
    expect(picked(en['scoring.chess.method.resign'])).toBe('false');
    await pick(app, en['scoring.chess.method.time']);
    expect(picked(en['scoring.chess.method.time'])).toBe('false');
  });

  // A double tap on a chip: its second touch is a tap on the picked chip, which would clear what the first picked.
  it('a double tap on a method picks it and leaves it picked', async () => {
    const app = await open();
    await tapHalf(app, 'first');
    aSecondOn(app);
    // Two touches, the first drawn before the second lands (a phone's touches are tens of ms apart, not one batch).
    for (let touch = 0; touch < 2; touch += 1) {
      const chip = screen.getByRole('radio', { name: en['scoring.chess.method.time'] });
      act(() => fireEvent.click(chip));
      await flush(0);
    }
    expect(
      screen
        .getByRole('radio', { name: en['scoring.chess.method.time'] })
        .getAttribute('aria-checked'),
    ).toBe('true');
    // A tap after the window is the scorer taking the choice back.
    await pick(app, en['scoring.chess.method.time']);
    expect(
      screen
        .getByRole('radio', { name: en['scoring.chess.method.time'] })
        .getAttribute('aria-checked'),
    ).toBe('false');
  });

  // A sheet's close leaves the screen with the touch, so the second touch of a double tap lands on the tool row under it,
  // where Swap colours writes a pairing: every close takes the next touches with it, the sheet Cancel's alike.
  it.each([
    ['Match details', en['scoring.details.title']],
    ['History', en['scoring.history.title']],
  ])(
    'a second touch on Swap colours straight after %s is closed counts once',
    async (_name, icon) => {
      const app = await open();
      await press(app, icon);
      await press(app, en['panel.close']);
      expect(screen.queryByRole('button', { name: en['panel.close'] })).toBeNull();
      act(() =>
        fireEvent.click(screen.getByRole('button', { name: en['scoring.chess.tool.swap'] })),
      );
      await flush(400);
      expect(await typesOf(app)).toEqual(['core.start']);
      await press(app, en['scoring.chess.tool.swap']);
      expect(await typesOf(app)).toEqual(['core.start', 'boardgame.pairing']);
    },
  );

  // What the line said before a sheet covered the pad is still there when the sheet closes: a close is no tap, and a tap
  // clears the line. (A refusal or a note the scorer had not read would be wiped unseen.)
  it.each([
    ['Match details', en['scoring.details.title']],
    ['History', en['scoring.history.title']],
  ])(
    'the note on the line before %s opened is still there after it closes',
    async (_name, icon) => {
      const app = await open();
      aSecondOn(app);
      // Two taps in one moment: Swap colours counts, and Draw on its heels is "Counted once".
      act(() => {
        fireEvent.click(screen.getByRole('button', { name: en['scoring.chess.tool.swap'] }));
      });
      act(() => {
        fireEvent.click(screen.getByRole('button', { name: en['scoring.chess.tool.draw'] }));
      });
      await flush(400);
      const note = () => screen.getByTestId('last-tap-note', { exact: true }).textContent;
      expect(note()).toBe(en['scoring.pad.countedOnce']);
      await press(app, icon);
      await press(app, en['panel.close']);
      expect(screen.queryByRole('button', { name: en['panel.close'] })).toBeNull();
      expect(note()).toBe(en['scoring.pad.countedOnce']);
    },
  );

  it('Cancel, the dim and Back leave with nothing recorded', async () => {
    const app = await open();
    await tapHalf(app, 'first');
    await press(app, en['scoring.sheet.cancel']);
    expect(screen.queryByTestId('how-sheet')).toBeNull();
    await tapHalf(app, 'first');
    aSecondOn(app);
    act(() => fireEvent.click(screen.getByTestId('how-dim')));
    await flush(400);
    expect(screen.queryByTestId('how-sheet')).toBeNull();
    await tapHalf(app, 'first');
    let handled = false;
    act(() => {
      handled = app.back.press();
    });
    expect(handled).toBe(true);
    expect(screen.queryByTestId('how-sheet')).toBeNull();
    expect(await typesOf(app)).toEqual(['core.start']);
  });
});

describe('Record', () => {
  it('with no method closes the sheet, writes the result, and shows who won in words and in the sheet’s line', async () => {
    const app = await open();
    await record(app, 'first');
    expect(screen.queryByTestId('how-sheet')).toBeNull();
    expect((await events(app, LIVE)).at(-1)).toMatchObject({
      type: 'boardgame.result',
      payload: { winner: HOME_ENTRANT },
    });
    expect(tally()).toBe('1–0');
    expect(strip()).toBe(fill(en['scoring.chess.last.won'], { name: 'A. Sharma' }));
    expect(lastTap()).toBe(fill(en['scoring.chess.last.won'], { name: 'A. Sharma' }));
    expect(
      within(screen.getByTestId('pad-card')).getByText(en['scoring.card.resultRecorded.title']),
    ).toBeTruthy();
  });

  it('with a method says it, and the ledger carries it', async () => {
    const app = await open();
    await record(app, 'second', en['scoring.chess.method.resign']);
    expect((await events(app, LIVE)).at(-1)).toMatchObject({
      type: 'boardgame.result',
      payload: { winner: AWAY_ENTRANT, method: 'resign' },
    });
    expect(tally()).toBe('0–1');
    expect(lastTap()).toBe(
      fill(en['scoring.chess.last.wonBy'], {
        name: 'L. Chen',
        how: en['scoring.chess.method.resign'],
      }),
    );
  });

  it('a draw writes nobody as the winner and says drawn', async () => {
    const app = await open();
    await record(app, null, en['scoring.chess.method.agreement']);
    expect((await events(app, LIVE)).at(-1)).toMatchObject({
      type: 'boardgame.result',
      payload: { winner: null, method: 'agreement' },
    });
    expect(tally()).toBe('½');
    expect(strip()).toBe(en['scoring.chess.last.drawn']);
  });

  // The names keep their places: A. Sharma is still on top after a swap, and a win for the top half is still A. Sharma's.
  it('after a swap, the player in the half tapped is the one who won, whoever holds White', async () => {
    const app = await open();
    await press(app, en['scoring.chess.tool.swap']);
    expect(plate('first')).toBe(en['scoring.chess.chip.black']);
    expect(plate('second')).toBe(en['scoring.chess.chip.white']);
    await record(app, 'first');
    expect((await events(app, LIVE)).at(-1)).toMatchObject({
      type: 'boardgame.result',
      payload: { winner: HOME_ENTRANT },
    });
    // A. Sharma holds Black now: the header writes the game as a scoresheet does, White's score first.
    expect(tally()).toBe('0–1');
    expect(strip()).toBe(fill(en['scoring.chess.last.won'], { name: 'A. Sharma' }));
  });
});

describe('Swap colours', () => {
  it('moves the plates and never the names, and writes one pairing', async () => {
    const app = await open();
    await press(app, en['scoring.chess.tool.swap']);
    expect(within(half('first')).getByText('A. Sharma')).toBeTruthy();
    expect(plate('first')).toBe(en['scoring.chess.chip.black']);
    expect(plate('second')).toBe(en['scoring.chess.chip.white']);
    expect(await typesOf(app)).toEqual(['core.start', 'boardgame.pairing']);
    expect(lastTap()).toBe(en['scoring.chess.last.swap']);
  });
});

describe('Undo', () => {
  it('takes this phone’s own result back, and the game is live again', async () => {
    const app = await open();
    await record(app, 'first');
    await press(app, en['scoring.pad.undo']);
    expect(await typesOf(app)).toEqual(['core.start', 'boardgame.result', 'core.void']);
    expect(tally()).toBe('');
    expect(toolNames()).toEqual([en['scoring.chess.tool.draw'], en['scoring.chess.tool.swap']]);
  });

  it('is off for a result another scorer wrote', async () => {
    const app = await open(chessSeed({ events: [START, DRAW] }));
    expect(tally()).toBe('½');
    // Under a recorded result whose Undo window was never this phone's, the cell is gone (`hasUndoCell`).
    expect(screen.queryByRole('button', { name: en['scoring.pad.undo'] })).toBeNull();
    expect(await typesOf(app, chessSeed({ events: [START, DRAW] }))).toEqual([
      'core.start',
      'boardgame.result',
    ]);
  });

  it('does not take a swap back', async () => {
    const app = await open();
    await press(app, en['scoring.chess.tool.swap']);
    const undo = screen.getByRole('button', { name: en['scoring.pad.undo'] });
    expect(undo.getAttribute('aria-disabled')).toBe('true');
    expect(await typesOf(app)).toEqual(['core.start', 'boardgame.pairing']);
  });
});

describe('a game another scorer ended while the sheet is open', () => {
  it('closes the sheet and shows their result, not the one this scorer was about to record', async () => {
    const app = await open();
    await tapHalf(app, 'first');
    app.scoring.addOtherScorerEvent('boardgame.result', { winner: AWAY_ENTRANT, method: 'time' });
    app.realtime.ping();
    await flush(400);
    expect(screen.queryByTestId('how-sheet')).toBeNull();
    expect(tally()).toBe('0–1');
    expect(await typesOf(app)).toEqual(['core.start', 'boardgame.result']);
  });
});

describe('the organiser’s part', () => {
  it('a drawn bracket game waits for the tie-break: no result button, and the Tie-break tool replaces the line', async () => {
    const seed = chessSeed({ events: [START, DRAW], cfg: chessCfg({ tiebreak: true }) });
    await open(seed);
    expect(strip()).toBe('');
    expect(screen.getByRole('button', { name: en['scoring.chess.tiebreak.tool'] })).toBeTruthy();
    expect(screen.queryByRole('radio')).toBeNull();
    expect(half('first').getAttribute('aria-disabled')).toBe('true');
    expect(half('second').getAttribute('aria-disabled')).toBe('true');
    expect(screen.queryAllByRole('button', { name: en['scoring.chess.tool.draw'] })).toEqual([]);
  });

  // A stage that lists no rung plays no tie-break game: the engine folds the drawn game done, so the line stands (the
  // organiser decides) and there is no tool.
  it('a drawn bracket game whose stage lists no rung is held: the line says so, and there is no tool', async () => {
    const cfg = chessCfg({ tiebreak: true, tiebreakRungs: [] });
    await open(chessSeed({ events: [START, DRAW], cfg }));
    // The words are the design's (§3): it was never the organiser's tie-break to wait for, only the organiser.
    expect(strip()).toBe('Waiting for the organiser');
    expect(strip()).toBe(en['scoring.chess.waiting.tiebreak']);
    expect(screen.queryAllByRole('button', { name: en['scoring.chess.tiebreak.tool'] })).toEqual(
      [],
    );
    expect(screen.queryAllByRole('button', { name: en['scoring.chess.tool.draw'] })).toEqual([]);
  });

  it('a walkover shows the winner’s name in words, since the last-tap line has none', async () => {
    const seed = chessSeed({
      events: [START, { type: 'core.forfeit', payload: { by: AWAY_ENTRANT, reason: 'walkover' } }],
    });
    await open(seed);
    expect(strip()).toBe(fill(en['scoring.chess.last.won'], { name: 'A. Sharma' }));
  });

  it('an abandoned game is over with no result, and the card does not claim one', async () => {
    const seed = chessSeed({
      events: [START, { type: 'core.abandon', payload: { reason: 'flooded' } }],
    });
    await open(seed);
    const card = screen.getByTestId('pad-card');
    expect(within(card).getByText(en['scoring.card.cancelled.body'])).toBeTruthy();
    expect(card.textContent).not.toContain(en['scoring.card.resultRecorded.title']);
    expect(tally()).toBe('');
    // Nothing is left to score on a game that is over, so the screen is not kept on for it.
    expect(screenIsHeld(holds)).toBe(false);
  });

  it('a result the organiser has locked is view only, and the screen is let go', async () => {
    const app = await open(chessSeed({ events: [START, DRAW] }));
    // A result this phone may still undo keeps the screen on; the organiser's lock lets it go.
    expect(screenIsHeld(holds)).toBe(true);
    app.scoring.finalize();
    // The lock is the bootstrap's word, read at most every 15 s: the next look after that (the foreground) finds it.
    await pass(app, 16_000);
    await backgroundAndBack(app);
    await flush(2_000);
    expect(screen.getByTestId('pad-card').textContent).toBe(
      en['scoring.card.viewOnly.title'] + en['scoring.card.viewOnly.body'],
    );
    expect(half('first').getAttribute('aria-disabled')).toBe('true');
    expect(screenIsHeld(holds)).toBe(false);
  });
});

describe('a match the phone cannot fold', () => {
  it('says so in words on the shared state screen, never a blank pad', async () => {
    // A result before the game started: a record the engine refuses.
    await open(LIVE, {
      prepare: (fakes) => {
        vi.spyOn(fakes.scoring, 'events').mockResolvedValue(ledgerOf([result('H')]));
      },
    });
    expect(screen.queryByTestId('pad-content')).toBeNull();
    expect(screen.getByText(en['scoring.state.ledger.title'])).toBeTruthy();
  });
});

const LANGUAGES = [
  ['es', es],
  ['fr', fr],
  ['nl', nl],
] as const;

describe.each(LANGUAGES)('%s', (language, words: Readonly<Record<string, string>>) => {
  it('draws the halves, the plates, the tools and the line from its dictionary', async () => {
    await open(LIVE, { deviceLanguages: [language] });
    expect(plate('first')).toBe(plain(words['scoring.chess.chip.white']!));
    expect(plate('second')).toBe(plain(words['scoring.chess.chip.black']!));
    expect(
      within(half('first')).getByText(
        fill(words['scoring.chess.result.white']!, { name: 'A. Sharma' }),
      ),
    ).toBeTruthy();
    expect(toolNames()).toEqual([
      words['scoring.chess.tool.draw'],
      words['scoring.chess.tool.swap'],
    ]);
    expect(strip()).toBe(plain(words['scoring.chess.forfeit']!));
  });

  it('says "no result" for the header from its dictionary', async () => {
    await open(LIVE, { deviceLanguages: [language] });
    expect(screen.getByTestId('tally').getAttribute('aria-label')).toBe(
      plain(words['scoring.chess.tallyNone']!),
    );
  });

  it('asks How in its words, with its methods', async () => {
    const app = await open(LIVE, { deviceLanguages: [language] });
    aSecondOn(app);
    act(() => fireEvent.click(half('second')));
    await flush(400);
    expect(
      screen.getByText(fill(words['scoring.chess.how.won']!, { name: 'L. Chen' })),
    ).toBeTruthy();
    expect(choices()).toEqual([
      words['scoring.chess.method.checkmate'],
      words['scoring.chess.method.resign'],
      words['scoring.chess.method.time'],
      words['scoring.chess.method.adjudication'],
      words['scoring.chess.method.illegal_move'],
    ]);
    expect(screen.getByRole('button', { name: words['scoring.chess.how.record']! })).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------------------------------------------
// The tie-break sheet (S2-3b Task 2; design §3), on the fake server with the engine judging every event. What jsdom
// cannot see (the lime fill of a picked chip, how the rows and chips wrap at 320 dp, a screen reader reading the sheet, a
// press's feedback) is the device check's; the fit of the words is `chessFit.test.ts`'s.
// ---------------------------------------------------------------------------------------------------------------

/** A drawn game in a knockout stage that lists `rungs` (all three when none are named). */
const drawnWith = (rungs?: readonly string[], over: Partial<ReturnType<typeof chessCfg>> = {}) =>
  chessSeed({
    events: [START, DRAW],
    cfg: chessCfg({
      tiebreak: true,
      ...(rungs === undefined ? {} : { tiebreakRungs: rungs }),
      ...over,
    }),
  });

const tieSheet = () => screen.queryByTestId('tiebreak-sheet');
/** What the open sheet offers as rows or chips, and its other buttons, in order. */
const tieButtons = () =>
  within(screen.getByTestId('tiebreak-sheet'))
    .getAllByRole('button')
    .map((button) => button.textContent);
const tieChips = () =>
  within(screen.getByTestId('tiebreak-sheet'))
    .getAllByRole('radio')
    .map((chip) => [chip.textContent, chip.getAttribute('aria-checked')]);

describe('the Tie-break tile and the rung step', () => {
  it('opens the sheet on the rung: the stage’s rungs in its order, the lots line, Cancel; nothing is sent', async () => {
    const seed = drawnWith(['armageddon', 'rapid', 'blitz']);
    const app = await open(seed);
    await press(app, en['scoring.chess.tiebreak.tool']);
    expect(screen.getByText(en['scoring.chess.tiebreak.rung.title'])).toBeTruthy();
    expect(tieButtons()).toEqual([
      en['scoring.chess.tiebreak.rung.armageddon'],
      en['scoring.chess.tiebreak.rung.rapid'],
      en['scoring.chess.tiebreak.rung.blitz'],
      en['scoring.sheet.cancel'],
    ]);
    // The words of the design: lots are the organiser's, never a rung (BG-KO-1, ruling 73).
    expect(screen.getByText('Decided by lot? Ask the organiser to settle the match.')).toBeTruthy();
    expect(await typesOf(app, seed)).toEqual(['core.start', 'boardgame.result']);
  });

  it('shows no Record on the rung step, and covers the pad from a screen reader', async () => {
    const app = await open(drawnWith());
    await press(app, en['scoring.chess.tiebreak.tool']);
    expect(screen.queryByRole('button', { name: en['scoring.chess.how.record'] })).toBeNull();
    expect(screen.getByTestId('pad-content').getAttribute('aria-hidden')).toBe('true');
  });

  it('a stage that lists one rung opens on that rung’s first step, with no rung question', async () => {
    const app = await open(drawnWith(['rapid']));
    await press(app, en['scoring.chess.tiebreak.tool']);
    expect(screen.queryByText(en['scoring.chess.tiebreak.rung.title'])).toBeNull();
    expect(screen.getByText(en['scoring.chess.tiebreak.winner.title'])).toBeTruthy();
  });

  it('Cancel and the dim close it, send nothing, and the tile is still there', async () => {
    const seed = drawnWith();
    const app = await open(seed);
    await press(app, en['scoring.chess.tiebreak.tool']);
    await press(app, en['scoring.sheet.cancel']);
    expect(tieSheet()).toBeNull();
    await press(app, en['scoring.chess.tiebreak.tool']);
    aSecondOn(app);
    act(() => fireEvent.click(screen.getByTestId('tiebreak-dim')));
    await flush(400);
    expect(tieSheet()).toBeNull();
    expect(screen.getByRole('button', { name: en['scoring.chess.tiebreak.tool'] })).toBeTruthy();
    expect(await typesOf(app, seed)).toEqual(['core.start', 'boardgame.result']);
  });

  // The second touch of a double tap on Cancel or the dim lands on what is under the sheet, here the tile itself: it is
  // counted once with the close and does not open the sheet again. A deliberate tap a moment later does.
  it.each([
    ['Cancel', () => screen.getByRole('button', { name: en['scoring.sheet.cancel'] })],
    ['the dim', () => screen.getByTestId('tiebreak-dim')],
  ] as const)(
    'a double tap on %s does not reopen the sheet through the tile under it',
    async (_name, close) => {
      const seed = drawnWith();
      const app = await open(seed);
      await press(app, en['scoring.chess.tiebreak.tool']);
      aSecondOn(app);
      act(() => fireEvent.click(close()));
      expect(tieSheet()).toBeNull();
      act(() =>
        fireEvent.click(screen.getByRole('button', { name: en['scoring.chess.tiebreak.tool'] })),
      );
      await flush(400);
      expect(tieSheet()).toBeNull();
      await press(app, en['scoring.chess.tiebreak.tool']);
      expect(screen.getByText(en['scoring.chess.tiebreak.rung.title'])).toBeTruthy();
      expect(await typesOf(app, seed)).toEqual(['core.start', 'boardgame.result']);
    },
  );

  it('a double tap on the tile opens it once: the second touch does not pick the first rung', async () => {
    const seed = drawnWith();
    const app = await open(seed);
    aSecondOn(app);
    const tile = screen.getByRole('button', { name: en['scoring.chess.tiebreak.tool'] });
    act(() => {
      fireEvent.click(tile);
      fireEvent.click(tile);
    });
    await flush(400);
    expect(screen.getByText(en['scoring.chess.tiebreak.rung.title'])).toBeTruthy();
    expect(tieButtons()).toContain(en['scoring.chess.tiebreak.rung.rapid']);
  });
});

describe('recording a rapid or blitz tie-break on the sheet', () => {
  it('Rapid, L. Chen, 2–0: the winner rows name both players, the score step names who advances, Record sends one event', async () => {
    const seed = drawnWith();
    const app = await open(seed);
    await press(app, en['scoring.chess.tiebreak.tool']);
    await press(app, en['scoring.chess.tiebreak.rung.rapid']);
    expect(screen.getByText(en['scoring.chess.tiebreak.winner.title'])).toBeTruthy();
    expect(tieButtons()).toEqual(['A. Sharma', 'L. Chen', en['scoring.sheet.cancel']]);
    await press(app, 'L. Chen');
    expect(screen.getByText(en['scoring.chess.tiebreak.score.title'])).toBeTruthy();
    expect(screen.getByText('L. Chen advances · Rapid')).toBeTruthy();
    // No score is the default, and the picked chip says so to a screen reader.
    expect(tieChips()).toEqual([
      [en['scoring.chess.tiebreak.score.none'], 'true'],
      ['2–0', 'false'],
      ['1½–½', 'false'],
    ]);
    await pick(app, '2–0');
    expect(tieChips().map(([, checked]) => checked)).toEqual(['false', 'true', 'false']);
    expect(await typesOf(app, seed)).toEqual(['core.start', 'boardgame.result']);
    await press(app, en['scoring.chess.how.record']);
    expect(tieSheet()).toBeNull();
    expect(await typesOf(app, seed)).toEqual([
      'core.start',
      'boardgame.result',
      'boardgame.tiebreak',
    ]);
    expect((await events(app, seed)).at(-1)?.payload).toEqual({
      rung: 'rapid',
      winner: AWAY_ENTRANT,
      score: '2–0',
    });
  });

  it('Blitz with no score sends none; the header stays level and the strip and last-tap line say who advances', async () => {
    const seed = drawnWith();
    const app = await open(seed);
    await press(app, en['scoring.chess.tiebreak.tool']);
    await press(app, en['scoring.chess.tiebreak.rung.blitz']);
    await press(app, 'A. Sharma');
    await press(app, en['scoring.chess.how.record']);
    expect((await events(app, seed)).at(-1)?.payload).toEqual({
      rung: 'blitz',
      winner: HOME_ENTRANT,
    });
    expect(tally()).toBe('½');
    expect(strip()).toBe('A. Sharma advances · Blitz');
    expect(lastTap()).toBe('A. Sharma advances · Blitz');
    expect(screen.getByRole('button', { name: en['scoring.pad.undo'] })).toBeTruthy();
  });

  it('No score after a score is no score', async () => {
    const seed = drawnWith(['blitz']);
    const app = await open(seed);
    await press(app, en['scoring.chess.tiebreak.tool']);
    await press(app, 'A. Sharma');
    await pick(app, '1½–½');
    await pick(app, en['scoring.chess.tiebreak.score.none']);
    await press(app, en['scoring.chess.how.record']);
    expect((await events(app, seed)).at(-1)?.payload).toEqual({
      rung: 'blitz',
      winner: HOME_ENTRANT,
    });
  });

  // The chip tapped again gives none back to the sheet (How's methods are optional); a score is cleared by No score, so a
  // repeat touch on the picked score (a double tap) changes nothing.
  it('a second touch on the picked score keeps it: only No score clears it', async () => {
    const seed = drawnWith(['blitz']);
    const app = await open(seed);
    await press(app, en['scoring.chess.tiebreak.tool']);
    await press(app, 'A. Sharma');
    await pick(app, '2–0');
    await pick(app, '2–0');
    expect(tieChips()).toEqual([
      [en['scoring.chess.tiebreak.score.none'], 'false'],
      ['2–0', 'true'],
      ['1½–½', 'false'],
    ]);
    await press(app, en['scoring.chess.how.record']);
    expect((await events(app, seed)).at(-1)?.payload).toEqual({
      rung: 'blitz',
      winner: HOME_ENTRANT,
      score: '2–0',
    });
  });

  it('Undo takes the tie-break back and the tile is owed again; a different tie-break then records', async () => {
    const seed = drawnWith();
    const app = await open(seed);
    await press(app, en['scoring.chess.tiebreak.tool']);
    await press(app, en['scoring.chess.tiebreak.rung.rapid']);
    await press(app, 'A. Sharma');
    await press(app, en['scoring.chess.how.record']);
    await press(app, en['scoring.pad.undo']);
    expect(await typesOf(app, seed)).toEqual([
      'core.start',
      'boardgame.result',
      'boardgame.tiebreak',
      'core.void',
    ]);
    expect(screen.getByRole('button', { name: en['scoring.chess.tiebreak.tool'] })).toBeTruthy();
    await press(app, en['scoring.chess.tiebreak.tool']);
    await press(app, en['scoring.chess.tiebreak.rung.armageddon']);
    await press(app, 'L. Chen');
    await press(app, en['scoring.chess.tiebreak.result.draw']);
    await press(app, en['scoring.chess.how.record']);
    expect((await events(app, seed)).at(-1)?.payload).toEqual({
      rung: 'armageddon',
      black: AWAY_ENTRANT,
      result: 'draw',
    });
    expect(lastTap()).toBe('L. Chen advances · Armageddon');
  });
});

describe('recording an Armageddon on the sheet', () => {
  it('asks who had Black, then the result with the players named by colour, then the confirm naming who advances', async () => {
    const seed = drawnWith();
    const app = await open(seed);
    await press(app, en['scoring.chess.tiebreak.tool']);
    await press(app, en['scoring.chess.tiebreak.rung.armageddon']);
    expect(screen.getByText(en['scoring.chess.tiebreak.black.title'])).toBeTruthy();
    expect(tieButtons()).toEqual(['A. Sharma', 'L. Chen', en['scoring.sheet.cancel']]);
    await press(app, 'A. Sharma');
    // A. Sharma had Black, so L. Chen had White: "White won" names L. Chen, whatever the main game's colours were.
    expect(screen.getByText(en['scoring.chess.tiebreak.result.title'])).toBeTruthy();
    expect(tieButtons()).toEqual([
      fill(en['scoring.chess.result.white'], { name: 'L. Chen' }),
      fill(en['scoring.chess.result.black'], { name: 'A. Sharma' }),
      'Drawn — Black advances',
      en['scoring.sheet.cancel'],
    ]);
    await press(app, fill(en['scoring.chess.result.white'], { name: 'L. Chen' }));
    expect(screen.getByText('Confirm the result')).toBeTruthy();
    // White won, and White is L. Chen: the player who did not have Black goes through (BG-KO-2).
    expect(screen.getByText('L. Chen advances · Armageddon')).toBeTruthy();
    expect(await typesOf(app, seed)).toEqual(['core.start', 'boardgame.result']);
    await press(app, en['scoring.chess.how.record']);
    expect((await events(app, seed)).at(-1)?.payload).toEqual({
      rung: 'armageddon',
      black: HOME_ENTRANT,
      result: 'white',
    });
    expect(strip()).toBe('L. Chen advances · Armageddon');
  });

  it.each([
    ['black', 'Black won · A. Sharma', 'A. Sharma advances · Armageddon'],
    ['draw', 'Drawn — Black advances', 'A. Sharma advances · Armageddon'],
  ] as const)('result %s: the confirm says Black advances', async (result, label, advances) => {
    const seed = drawnWith(['armageddon']);
    const app = await open(seed);
    await press(app, en['scoring.chess.tiebreak.tool']);
    await press(app, 'A. Sharma');
    await press(app, label);
    expect(screen.getByText(advances)).toBeTruthy();
    await press(app, en['scoring.chess.how.record']);
    expect((await events(app, seed)).at(-1)?.payload).toEqual({
      rung: 'armageddon',
      black: HOME_ENTRANT,
      result,
    });
  });

  // The tie-break has a colour of its own, so a division that plays without colours is asked who had Black all the same.
  it('asks who had Black in a division that plays without colours', async () => {
    const seed = drawnWith(['armageddon'], { colors: false });
    const app = await open(seed);
    expect(plate('first')).toBeUndefined();
    await press(app, en['scoring.chess.tiebreak.tool']);
    expect(screen.getByText(en['scoring.chess.tiebreak.black.title'])).toBeTruthy();
    await press(app, 'L. Chen');
    await press(app, 'Drawn — Black advances');
    await press(app, en['scoring.chess.how.record']);
    expect((await events(app, seed)).at(-1)?.payload).toEqual({
      rung: 'armageddon',
      black: AWAY_ENTRANT,
      result: 'draw',
    });
  });
});

describe('the sheet and a second scorer', () => {
  it('another scorer’s tie-break closes the sheet and the pad shows theirs', async () => {
    const seed = drawnWith();
    const app = await open(seed);
    await press(app, en['scoring.chess.tiebreak.tool']);
    await press(app, en['scoring.chess.tiebreak.rung.rapid']);
    app.scoring.addOtherScorerEvent('boardgame.tiebreak', { rung: 'blitz', winner: AWAY_ENTRANT });
    app.realtime.ping();
    await flush(400);
    expect(tieSheet()).toBeNull();
    expect(lastTap()).toBe('L. Chen advances · Blitz');
    expect(screen.queryByRole('button', { name: en['scoring.chess.tiebreak.tool'] })).toBeNull();
  });

  it('the app going to the background closes it', async () => {
    const app = await open(drawnWith());
    await press(app, en['scoring.chess.tiebreak.tool']);
    await backgroundAndBack(app);
    await flush(400);
    expect(tieSheet()).toBeNull();
  });
});

const TIEBREAK_LANGUAGES = [
  ['es', es],
  ['fr', fr],
  ['nl', nl],
] as const;

describe.each(TIEBREAK_LANGUAGES)(
  'the tie-break sheet in %s',
  (language, words: Readonly<Record<string, string>>) => {
    const w = (key: string) => plain(words[key]!);

    it('says the tile, the rung step, its rungs and the lots line from its dictionary', async () => {
      const app = await open(drawnWith(), { deviceLanguages: [language] });
      expect(toolNames()).toEqual([words['scoring.chess.tiebreak.tool']]);
      await press(app, w('scoring.chess.tiebreak.tool'));
      expect(screen.getByText(w('scoring.chess.tiebreak.rung.title'))).toBeTruthy();
      expect(tieButtons()).toEqual([
        w('scoring.chess.tiebreak.rung.rapid'),
        w('scoring.chess.tiebreak.rung.blitz'),
        w('scoring.chess.tiebreak.rung.armageddon'),
        w('scoring.sheet.cancel'),
      ]);
      expect(screen.getByText(w('scoring.chess.tiebreak.lotsHint'))).toBeTruthy();
    });

    it('says the score step, its chips and who advances from its dictionary', async () => {
      const app = await open(drawnWith(['blitz']), { deviceLanguages: [language] });
      await press(app, w('scoring.chess.tiebreak.tool'));
      expect(screen.getByText(w('scoring.chess.tiebreak.winner.title'))).toBeTruthy();
      await press(app, 'L. Chen');
      expect(screen.getByText(w('scoring.chess.tiebreak.score.title'))).toBeTruthy();
      expect(
        screen.getByText(
          fill(words['scoring.chess.tiebreak.advances']!, {
            name: 'L. Chen',
            how: words['scoring.chess.tiebreak.rung.blitz']!,
          }),
        ),
      ).toBeTruthy();
      expect(tieChips().map(([label]) => label)).toEqual([
        w('scoring.chess.tiebreak.score.none'),
        '2–0',
        '1½–½',
      ]);
      expect(screen.getByRole('button', { name: w('scoring.chess.how.record') })).toBeTruthy();
    });

    it('says the Armageddon’s steps from its dictionary', async () => {
      const app = await open(drawnWith(['armageddon']), { deviceLanguages: [language] });
      await press(app, w('scoring.chess.tiebreak.tool'));
      expect(screen.getByText(w('scoring.chess.tiebreak.black.title'))).toBeTruthy();
      await press(app, 'A. Sharma');
      expect(screen.getByText(w('scoring.chess.tiebreak.result.title'))).toBeTruthy();
      expect(tieButtons()).toEqual([
        fill(words['scoring.chess.result.white']!, { name: 'L. Chen' }),
        fill(words['scoring.chess.result.black']!, { name: 'A. Sharma' }),
        w('scoring.chess.tiebreak.result.draw'),
        w('scoring.sheet.cancel'),
      ]);
      await press(app, w('scoring.chess.tiebreak.result.draw'));
      expect(screen.getByText(w('scoring.chess.tiebreak.confirm.title'))).toBeTruthy();
    });

    it('says the held game’s line from its dictionary, with no tile', async () => {
      await open(drawnWith([]), { deviceLanguages: [language] });
      expect(strip()).toBe(w('scoring.chess.waiting.tiebreak'));
      expect(screen.queryAllByRole('button', { name: w('scoring.chess.tiebreak.tool') })).toEqual(
        [],
      );
    });
  },
);
