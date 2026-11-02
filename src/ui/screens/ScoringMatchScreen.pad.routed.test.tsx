import { act, fireEvent, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Gravity } from '@/domain/orientation/orientation';
import { encodeSavedCode, type SavedCode } from '@/domain/mode/savedCode';
import en from '@/i18n/en.json';
import es from '@/i18n/es.json';
import fr from '@/i18n/fr.json';
import nl from '@/i18n/nl.json';
import { STORE_KEYS } from '@/services/modeStore';
import { TEST_NOW } from '../../../test/fakePorts';
import {
  FAKE_LABEL,
  FAKE_MATCH,
  LINK,
  STORED_LINK,
  linkKey,
} from '../../../test/scoringHomeFixtures';
import { screenIsHeld, type HoldLog } from '../../../test/heldScreen';
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

// Plan S2-1 Task 11 (design §4 step 3, §5): the pad of a match saved by a scan, drawn by badminton's own screen through
// the route's table, on the fake server with the real runner, queue and sender under it. Each test reads what the
// scorer sees. What jsdom cannot see (the pad's colours, the lock holding on a phone) is the device check's.

const SAVED: SavedCode = {
  mode: 'scoring',
  raw: '',
  slot: null,
  savedAt: TEST_NOW,
  expiresAt: null,
  stream: null,
  scoring: { fixtureId: FAKE_MATCH, label: FAKE_LABEL },
};
const IN_MATCH = {
  [STORE_KEYS.active]: 'scoring',
  [STORE_KEYS.code('scoring')]: encodeSavedCode(SAVED),
  [linkKey(FAKE_MATCH)]: STORED_LINK,
};
/** A phone on Home with the match saved, to walk to the match by hand. */
const SAVED_ON_HOME = { ...IN_MATCH, [STORE_KEYS.active]: 'stream' };
const DICTIONARIES = { en, es, fr, nl } as const;
type Words = typeof en;

let seconds = 0;
/** The phone's clock a second on: the next tap is never in the bounce window of the last. */
const aSecondOn = (app: LaunchedApp) => {
  seconds += 1;
  app.setNow(new Date(TEST_NOW.getTime() + seconds * 1000));
};
/**
 * Time passing for the sender: the phone's clock and the timers move together, a second at a time (the sender's wait
 * is judged against the phone's clock, which a test holds still until it says otherwise).
 */
async function pass(app: LaunchedApp, ms: number): Promise<void> {
  for (let elapsed = 0; elapsed < ms; elapsed += 1000) {
    aSecondOn(app);
    await flush(1000);
  }
}
const press = (name: string) => act(() => fireEvent.click(screen.getByRole('button', { name })));
const half = (side: 'first' | 'second') => screen.getByTestId(`half-${side}`);
const shows = (side: 'first' | 'second', points: number) =>
  within(half(side)).getByTestId('score').textContent === String(points);
const boxes = (side: 'first' | 'second') =>
  within(half(side))
    .queryAllByTestId('period')
    .map((box) => box.textContent);
const syncSaid = () => screen.getByTestId('sync').textContent;
const lastTap = () => screen.getByTestId('last-tap').textContent;

/** Taps on one half, a second apart, the sender given its turn after each (a tap is sent on its own). */
async function rally(app: LaunchedApp, side: 'first' | 'second', times = 1): Promise<void> {
  for (let at = 0; at < times; at += 1) {
    aSecondOn(app);
    act(() => fireEvent.click(half(side)));
    await flush(0);
  }
}

/** The match opened and started as the scorer starts it (A. Sharma serving first), a minute before the test's taps. */
async function startedMatch(
  over: Parameters<typeof launchApp>[0] = {},
  words: Words = en,
): Promise<LaunchedApp> {
  const app = await launchApp({ kvSeed: IN_MATCH, ...over });
  await flush(200);
  app.setNow(new Date(TEST_NOW.getTime() - 60_000));
  act(() => fireEvent.click(screen.getByRole('radio', { name: 'A. Sharma' })));
  press(words['scoring.start.confirm']);
  app.setNow(TEST_NOW);
  await flush(200);
  return app;
}

describe('a match from the Start screen to its end', () => {
  it('Start with the toss, rallies, a game, the match, then the organiser finalises it: view only', async () => {
    const app = await launchApp({ kvSeed: IN_MATCH });
    await flush(200);
    expect(app.nav.current()).toBe('scoring');
    // Nothing is recorded before Start: the screen asks who serves first, and the halves are not there to tap.
    expect(screen.getByTestId('start-screen')).toBeTruthy();
    expect(screen.queryByTestId('half-first')).toBeNull();
    app.setNow(new Date(TEST_NOW.getTime() - 60_000));
    act(() => fireEvent.click(screen.getByRole('radio', { name: 'A. Sharma' })));
    press(en['scoring.start.confirm']);
    app.setNow(TEST_NOW);
    await flush(200);
    expect(screen.queryByTestId('start-screen')).toBeNull();
    expect(lastTap()).toContain('Match started — A. Sharma serves first');
    expect(shows('first', 0) && shows('second', 0)).toBe(true);

    await rally(app, 'first', 21);
    expect(shows('first', 0) && shows('second', 0)).toBe(true);
    expect([boxes('first'), boxes('second')]).toEqual([['21'], ['0']]);
    expect(screen.getByTestId('strip-game').textContent).toBe('Game 2 of 3');
    await flush(2_000);
    expect(syncSaid()).toBe(en['scoring.sync.synced']);

    await rally(app, 'first', 21);
    await flush(2_000);
    // Decided 2-0: the result card over the final score, no tools, the halves take no tap.
    expect(screen.getByTestId('pad-card').textContent).toContain(
      en['scoring.card.resultRecorded.title'],
    );
    expect([boxes('first'), boxes('second')]).toEqual([
      ['21', '21'],
      ['0', '0'],
    ]);
    expect(half('first').getAttribute('aria-disabled')).toBe('true');
    expect(syncSaid()).toBe(en['scoring.sync.synced']);
    // A recorded result is still the scorer's to undo a mistake in: the screen stays on.
    expect(screenIsHeld(holds)).toBe(true);

    // The organiser finalises it: seen at the next look (a return to the foreground), the pad is view only.
    app.scoring.finalize();
    await backgroundAndBack(app);
    await flush(2_000);
    expect(screen.getByTestId('pad-card').textContent).toContain(en['scoring.card.viewOnly.title']);
    expect(screen.getByTestId('pad-card').textContent).toContain(en['scoring.card.viewOnly.body']);
    expect(half('first').getAttribute('aria-disabled')).toBe('true');
    // The organiser's lock ends the scorer's part (the controller's ruling, 2026-11-02): the phone may sleep.
    expect(screenIsHeld(holds)).toBe(false);
    // Undo stays on the line but takes nothing now: the result is the organiser's.
    expect(
      screen.getByRole('button', { name: en['scoring.pad.undo'] }).getAttribute('aria-disabled'),
    ).toBe('true');
  });

  it('a second Start press records the start once', async () => {
    const app = await launchApp({ kvSeed: IN_MATCH });
    await flush(200);
    app.setNow(new Date(TEST_NOW.getTime() - 60_000));
    act(() => fireEvent.click(screen.getByRole('radio', { name: 'A. Sharma' })));
    const append = vi.spyOn(app.scoring, 'append');
    const start = screen.getByRole('button', { name: en['scoring.start.confirm'] });
    act(() => {
      fireEvent.click(start);
      fireEvent.click(start);
    });
    app.setNow(TEST_NOW);
    await flush(2_000);
    expect(append).toHaveBeenCalledTimes(1);
  });
});

describe('Undo waiting to send', () => {
  it.each([
    ['en', en],
    ['es', es],
    ['fr', fr],
    ['nl', nl],
  ] as const)(
    'says so in %s while the tap it takes back has no answer yet, and the line clears once sent',
    async (lang, words) => {
      const app = await startedMatch({ deviceLanguages: [lang] }, words);
      app.scoring.dropNextAnswer();
      await rally(app, 'first');
      await flush(300);
      // The phone's clock stays where the tap was made: the tap's resend is not due, so its answer is still to come.
      press(words['scoring.pad.undo']);
      await flush(300);
      expect(shows('first', 0)).toBe(true);
      expect(lastTap()).toContain(words['scoring.pad.undoWaiting']);
      await pass(app, 30_000);
      expect(lastTap()).not.toContain(words['scoring.pad.undoWaiting']);
      expect(syncSaid()).toBe(words['scoring.sync.synced']);
    },
  );
});

describe('History marks what is still sending', () => {
  const rows = () =>
    within(screen.getByTestId('history'))
      .queryAllByTestId('history-row')
      .map((row) => row.getAttribute('aria-label'));

  it.each([
    ['en', en],
    ['es', es],
    ['fr', fr],
    ['nl', nl],
  ] as const)(
    'marks the taps the server has not answered in %s, and none once it has',
    async (lang, words) => {
      const app = await startedMatch({ deviceLanguages: [lang] }, words);
      app.scoring.goOffline(true);
      await rally(app, 'first', 2);
      press(words['scoring.history.title']);
      const sending = within(screen.getByTestId('history')).getAllByTestId('history-sending');
      expect(sending.map((mark) => mark.textContent)).toEqual([
        words['scoring.history.sending'],
        words['scoring.history.sending'],
      ]);
      // A row's one label carries it too, for a screen reader.
      expect(rows().filter((row) => row?.includes(words['scoring.history.sending']))).toHaveLength(
        2,
      );
      press(words['panel.close']);
      app.scoring.goOffline(false);
      await pass(app, 30_000);
      press(words['scoring.history.title']);
      expect(within(screen.getByTestId('history')).queryAllByTestId('history-sending')).toEqual([]);
    },
  );
});

describe('the Points row says each game’s own target', () => {
  const row = (words: Words = en) =>
    within(screen.getByTestId('details-sheet'))
      .getAllByTestId('match-card-row')
      .map((r) => r.getAttribute('aria-label'))
      .find((label) => label?.startsWith(words['scoring.badminton.rules.points.label']));

  it('one target for every game: the row is the short form', async () => {
    await startedMatch();
    press(en['scoring.details.title']);
    expect(row()).toBe('Points: 21, win by 2');
  });

  it('a deciding game played to another target: the row names it', async () => {
    await startedMatch({
      prepare: (fakes) => fakes.scoring.setRulesVersion(1, { finalSetTo: 15 }),
    });
    press(en['scoring.details.title']);
    expect(row()).toBe('Points: 21, win by 2, game 3 to 15');
  });

  it.each([
    ['es', es],
    ['fr', fr],
    ['nl', nl],
  ] as const)('says it in %s, from the dictionary', async (lang, words) => {
    await startedMatch(
      {
        deviceLanguages: [lang],
        prepare: (fakes) => fakes.scoring.setRulesVersion(1, { finalSetTo: 15 }),
      },
      words,
    );
    press(words['scoring.details.title']);
    const said = words['scoring.badminton.rules.points.deciding']
      .replace('{points}', '21')
      .replace('{winBy}', '2')
      .replace('{game}', '3')
      .replace('{deciding}', '15');
    const plain = (text: string | null | undefined) => text?.replace(/\u00a0/g, ' ');
    expect(plain(row(words))).toContain(plain(said));
  });
});

/**
 * The route, entered as the navigation port enters it, and kept: moves of the router, the foreground, Back and a
 * broadcast. These are the checks the dev preview's route had (S2 preview; the controller's brief, 2026-10-31), made now
 * on the real match.
 */
describe('the pad, routed', () => {
  const visit = async (app: LaunchedApp) => {
    act(() => app.ports.navigation.go('scoring'));
    await flush(200);
  };
  const topScore = (points: number) => shows('first', points);
  /** Android Back, flushed as the phone delivers it. */
  const back = async (app: LaunchedApp) => {
    let handled = false;
    act(() => {
      handled = app.back.press();
    });
    await flush();
    return handled;
  };

  it('opens with one move of the router, for a double call too', async () => {
    const app = await launchApp({ kvSeed: SAVED_ON_HOME });
    act(() => {
      app.ports.navigation.go('scoring');
      app.ports.navigation.go('scoring');
    });
    await flush(200);
    expect(app.nav.current()).toBe('scoring');
    expect(app.nav.history).toEqual(['scoring']);
    expect(screen.getByTestId('start-screen')).toBeTruthy();
  });

  it('stays put on a return to the foreground, the match where it was', async () => {
    const app = await startedMatch();
    await rally(app, 'first');
    await backgroundAndBack(app);
    await flush(200);
    expect(app.nav.current()).toBe('scoring');
    expect(topScore(1)).toBe(true);
  });

  it('Back returns Home, and the next visit finds the match where it was', async () => {
    const app = await startedMatch();
    await rally(app, 'first');
    expect(await back(app)).toBe(true);
    expect(app.nav.current()).toBe('home');
    await visit(app);
    expect(topScore(1)).toBe(true);
  });

  it('Back leaves the ending prompt for Home (owner ruling 10), and the prompt is up again on the return', async () => {
    const app = await startedMatch();
    const later = async (n: number) => {
      app.setNow(new Date(TEST_NOW.getTime() + n * 1000));
      await flush(0);
    };
    press(`${en['scoring.badminton.tool.sanction']}, L. Chen`);
    await later(1);
    press(en['scoring.sanction.disqualification']);
    await later(2);
    press('L. Chen');
    await later(3);
    press(en['scoring.sanction.confirm.action']);
    await flush(200);
    expect(screen.getByTestId('ending-prompt')).toBeTruthy();
    expect(await back(app)).toBe(true);
    expect(app.nav.current()).toBe('home');
    await visit(app);
    expect(screen.getByTestId('ending-prompt').textContent).toContain(
      en['scoring.ending.title'].replace('{person}', 'L. Chen'),
    );
  });

  it('a sheet takes Back first: the pad stays', async () => {
    const app = await startedMatch();
    press(en['scoring.badminton.tool.setScore']);
    expect(await back(app)).toBe(true);
    expect(screen.queryByTestId('score-sheet')).toBeNull();
    expect(app.nav.current()).toBe('scoring');
  });

  it('moves to Live Stream when a broadcast starts remotely, as from Home (A2)', async () => {
    const app = await launchApp({
      kvSeed: SAVED_ON_HOME,
      prepare: (fakes) => fakes.engine.scene('paired-ready'),
    });
    await visit(app);
    expect(app.nav.current()).toBe('scoring');
    act(() => app.engine.scene('live'));
    await flush();
    expect(app.nav.current()).toBe('stream');
  });

  it('lets the screen go when the link dies under a tap: the bad-link card ends the scorer’s part', async () => {
    const app = await startedMatch();
    expect(screenIsHeld(holds)).toBe(true);
    app.scoring.revoke();
    await rally(app, 'first');
    await flush(2_000);
    expect(screen.getByTestId('pad-card').textContent).toContain(
      en['scoring.card.linkInvalid.title'],
    );
    expect(screenIsHeld(holds)).toBe(false);
  });

  // Owner ruling 9 (2026-10-31): the screen stays on while the pad shows, but for its terminal cards (`holdsScreen`, tested
  // above and in the pad's own suite). The pad's screen holds it (`KeepScreenOn`, pinned by the drift test); whether the
  // phone's screen really stays lit is the device check's.
  it('holds the screen on while the pad shows and lets it go on Back', async () => {
    const app = await startedMatch();
    expect(screenIsHeld(holds)).toBe(true);
    expect(await back(app)).toBe(true);
    await flush(0);
    expect(screenIsHeld(holds)).toBe(false);
  });
});

const tilted = (deg: number): Gravity => {
  const rad = (deg * Math.PI) / 180;
  return { x: Math.sin(rad), y: Math.cos(rad), z: 0 };
};
/** One reading held 400 ms, sampled every 100 ms, as the phone sends it. */
const hold = (app: LaunchedApp, g: Gravity, fromMs: number) =>
  act(() => {
    for (let t = 0; t <= 400; t += 100) app.motion.emit(g, fromMs + t);
  });

/**
 * Remote Scoring is portrait (decision record ruling 4; owner layout A): sideways at 728 x 328 its halves would get
 * about 1 dp each. Under the root layout's gate, held sideways, the turn-upright card covers the pad, locked to the
 * hands so it reads upright; turned upright, the card goes and the pad locks portrait.
 */
describe('the pad, held sideways', () => {
  const upright = () => screen.queryByLabelText(en['turn.upright.title']);

  it('asks for the phone upright, and locks portrait once it is', async () => {
    const app = await launchApp({ kvSeed: SAVED_ON_HOME, gated: true });
    hold(app, tilted(90), 0);
    await flush();
    expect(upright()).toBeNull();
    act(() => app.ports.navigation.go('scoring'));
    await flush(200);
    expect(app.nav.current()).toBe('scoring');
    expect(upright()).not.toBeNull();
    expect(app.orientationLock.locks.at(-1)).toBe('landscape');
    hold(app, tilted(0), 1000);
    await flush(200);
    expect(upright()).toBeNull();
    expect(app.orientationLock.locks.at(-1)).toBe('portrait');
    expect(screen.getByTestId('start-screen')).toBeTruthy();
  });

  it('a state card is held upright too (the lock is the route’s, not the pad’s), and Home follows the phone again', async () => {
    const app = await launchApp({
      kvSeed: IN_MATCH,
      gated: true,
      prepare: (fakes) => fakes.scoring.goOffline(true),
    });
    hold(app, tilted(0), 0);
    await flush(200);
    expect(app.orientationLock.locks.at(-1)).toBe('portrait');
    expect(screen.getByTestId('scoring-state-card')).toBeTruthy();
    let handled = false;
    act(() => {
      handled = app.back.press();
    });
    await flush();
    expect(handled).toBe(true);
    expect(app.orientationLock.locks.at(-1)).toBe('free');
    hold(app, tilted(90), 1000);
    await flush();
    expect(upright()).toBeNull();
  });
});
