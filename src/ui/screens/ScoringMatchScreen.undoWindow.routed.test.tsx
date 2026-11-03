import { act, fireEvent, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { encodeSavedCode, type SavedCode } from '@/domain/mode/savedCode';
import en from '@/i18n/en.json';
import es from '@/i18n/es.json';
import fr from '@/i18n/fr.json';
import nl from '@/i18n/nl.json';
import { scoringHubOf } from '@/hooks/scoringHub';
import { SINGLES_SEED } from '@/services/fakeScoringPort';
import { STORE_KEYS } from '@/services/modeStore';
import { TEST_NOW } from '../../../test/fakePorts';
import { FAKE_LABEL, FAKE_MATCH, STORED_LINK, linkKey } from '../../../test/scoringHomeFixtures';
import { flush, launchApp, type LaunchedApp } from '../../../test/routedApp';

vi.mock('@/hooks/keepAwake', async () => {
  const { recordingHold } = await import('../../../test/heldScreen');
  return { holdScreenOn: recordingHold([]) };
});

beforeEach(() => {
  seconds = 0;
  vi.useFakeTimers();
});
afterEach(() => vi.useRealTimers());

// Owner, 2026-11-03: when this phone's own tap decides the match, Undo stays for 30 s under a countdown on the result
// card, then goes and the card says to ask the organiser. The end of a game is not this. Each test reads what the
// scorer sees, on the real runner, queue and fake server, the phone's clock held where a test puts it. The window's own
// rule and its timer are `undoWindow.test.ts` and `useUndoWindow.test.tsx`; what jsdom cannot see (the colours, a screen
// reader reading the card) is the device check's.

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
const DICTIONARIES = { en, es, fr, nl } as const;
type Words = typeof en;

let seconds = 0;
/** The phone's clock a second on: the next tap is never in the bounce window of the last. */
const aSecondOn = (app: LaunchedApp) => {
  seconds += 1;
  app.setNow(new Date(TEST_NOW.getTime() + seconds * 1000));
};
/** Time passing: the phone's clock and the timers move together, a second at a time. */
async function pass(app: LaunchedApp, ms: number): Promise<void> {
  for (let elapsed = 0; elapsed < ms; elapsed += 1000) {
    aSecondOn(app);
    await flush(1000);
  }
}
/** A long wait in one step: the clock jumps and the timers get one second to notice (a phone left alone for minutes). */
async function jump(app: LaunchedApp, ms: number): Promise<void> {
  seconds += Math.round(ms / 1000);
  app.setNow(new Date(TEST_NOW.getTime() + seconds * 1000));
  await flush(1000);
}
const press = (name: string) => act(() => fireEvent.click(screen.getByRole('button', { name })));
const half = (side: 'first' | 'second') => screen.getByTestId(`half-${side}`);
const shows = (side: 'first' | 'second', points: number) =>
  within(half(side)).getByTestId('score').textContent === String(points);

async function rally(app: LaunchedApp, side: 'first' | 'second', times = 1): Promise<void> {
  for (let at = 0; at < times; at += 1) {
    aSecondOn(app);
    act(() => fireEvent.click(half(side)));
    await flush(0);
  }
}

/** The match opened and started as the scorer starts it (A. Sharma serving first), a minute before the test's taps. */
async function startedMatch(words: Words = en, lang = 'en'): Promise<LaunchedApp> {
  const app = await launchApp({ kvSeed: IN_MATCH, deviceLanguages: [lang] });
  await flush(200);
  app.setNow(new Date(TEST_NOW.getTime() - 60_000));
  act(() => fireEvent.click(screen.getByRole('radio', { name: 'A. Sharma' })));
  press(words['scoring.start.confirm']);
  app.setNow(TEST_NOW);
  await flush(200);
  return app;
}

/** Another scorer's rallies for the first side, as the server holds them; the pad sees them on the Realtime ping. */
async function scoredElsewhere(app: LaunchedApp, times: number): Promise<void> {
  for (let at = 0; at < times; at += 1) {
    app.scoring.addOtherScorerEvent('badminton.rally', {
      wonBy: SINGLES_SEED.sides.home.entrantId,
    });
  }
  app.realtime.ping();
  await flush(1_000);
}

/** The match decided by this phone's own tap: 41 rallies from another scorer, then this phone's 42nd. */
async function decided(app: LaunchedApp): Promise<void> {
  await scoredElsewhere(app, 41);
  await rally(app, 'first');
  await flush(0);
}

const cardText = () => screen.getByTestId('pad-card').textContent;
const undoButton = (words: Words = en) =>
  screen.queryByRole('button', { name: words['scoring.pad.undo'] });
const open = (words: Words, seconds: number) =>
  words['scoring.card.resultRecorded.title'] +
  words['scoring.card.resultRecorded.bodyOpen'] +
  words['scoring.card.resultRecorded.undoCountdown'].replace('{seconds}', String(seconds));
const closed = (words: Words) =>
  words['scoring.card.resultRecorded.title'] + words['scoring.card.resultRecorded.bodyClosed'];

describe('the Undo window of a match this phone decided', () => {
  it.each([
    ['en', en],
    ['es', es],
    ['fr', fr],
    ['nl', nl],
  ] as const)(
    'counts 30, then 29 on the result card, with Undo in its place, in %s',
    async (lang, words) => {
      const app = await startedMatch(words, lang);
      await decided(app);
      expect(cardText()).toBe(open(words, 30));
      expect(undoButton(words)?.getAttribute('aria-disabled')).not.toBe('true');
      await pass(app, 1000);
      expect(cardText()).toBe(open(words, 29));
      expect(undoButton(words)).not.toBeNull();
    },
  );

  it.each([
    ['en', en],
    ['es', es],
    ['fr', fr],
    ['nl', nl],
  ] as const)(
    'closes at 30 s: the Undo button is gone and the card says to ask the organiser, in %s',
    async (lang, words) => {
      const app = await startedMatch(words, lang);
      await decided(app);
      await pass(app, 29_000);
      expect(cardText()).toBe(open(words, 1));
      expect(undoButton(words)).not.toBeNull();
      await pass(app, 1000);
      expect(cardText()).toBe(closed(words));
      expect(undoButton(words)).toBeNull();
      // What the last tap did is still said, and the final score stays.
      expect(screen.getByTestId('last-tap-sentence').textContent).not.toBe('');
      expect(shows('first', 21)).toBe(true);
    },
  );

  it('stays closed: minutes later the card and the line are as they were at 30 s', async () => {
    const app = await startedMatch();
    await decided(app);
    await pass(app, 30_000);
    await jump(app, 180_000);
    expect(cardText()).toBe(closed(en));
    expect(undoButton()).toBeNull();
  });

  it('an Undo inside the window reopens the match as before, and the next decision starts a fresh 30 s', async () => {
    const app = await startedMatch();
    await decided(app);
    await pass(app, 10_000);
    expect(cardText()).toBe(open(en, 20));
    press(en['scoring.pad.undo']);
    await flush(300);
    expect(screen.queryByTestId('pad-card')).toBeNull();
    expect(shows('first', 20)).toBe(true);
    await pass(app, 5_000);
    await rally(app, 'first');
    await flush(0);
    expect(cardText()).toBe(open(en, 30));
    await pass(app, 3_000);
    expect(cardText()).toBe(open(en, 27));
    // The old window would have closed by now; this one has 27 s.
    await pass(app, 20_000);
    expect(undoButton()).not.toBeNull();
    await pass(app, 7_000);
    expect(undoButton()).toBeNull();
  });

  it('the end of a game is not a decision: Undo stays after 30 s, and after 10 minutes', async () => {
    const app = await startedMatch();
    await scoredElsewhere(app, 20);
    await rally(app, 'first');
    await flush(0);
    expect(screen.queryByTestId('pad-card')).toBeNull();
    // One game is over: a box for it in each half.
    expect(screen.getAllByTestId('period')).toHaveLength(2);
    await pass(app, 40_000);
    expect(undoButton()?.getAttribute('aria-disabled')).not.toBe('true');
    await jump(app, 600_000);
    expect(undoButton()?.getAttribute('aria-disabled')).not.toBe('true');
    press(en['scoring.pad.undo']);
    await flush(300);
    expect(shows('first', 20)).toBe(true);
  });

  it('going Home and back within the 30 s finds the same window, and after it closed finds it closed', async () => {
    const app = await startedMatch();
    await decided(app);
    await pass(app, 12_000);
    expect(cardText()).toBe(open(en, 18));
    act(() => {
      app.back.press();
    });
    await flush(200);
    expect(app.nav.current()).toBe('home');
    await pass(app, 2_000);
    act(() => app.ports.navigation.go('scoring'));
    await flush(200);
    expect(cardText()).toBe(open(en, 16));
    await pass(app, 16_000);
    expect(cardText()).toBe(closed(en));
    act(() => {
      app.back.press();
    });
    await flush(200);
    act(() => app.ports.navigation.go('scoring'));
    await flush(200);
    expect(cardText()).toBe(closed(en));
    expect(undoButton()).toBeNull();
  });

  it('a result the other scorer made opens no window: the card says to ask the organiser and there is no Undo', async () => {
    const app = await startedMatch();
    await scoredElsewhere(app, 42);
    expect(cardText()).toBe(closed(en));
    expect(undoButton()).toBeNull();
    await pass(app, 40_000);
    expect(cardText()).toBe(closed(en));
  });
});

// Scanning another match leaves this one (`hub.leave`): its caches go and this phone's own tap ids are kept for a day. A
// rescan reads the bootstrap and an EMPTY ledger first (the pad shows the match not yet played), and the real ledger
// after: decided, with those kept ids. That is a match found decided, not a decision of this phone's (owner, 2026-11-03).
describe('a match scanned again after it was left', () => {
  /** The scorer goes Home, scans another match (the hub leaves this one) and scans this one again. */
  async function leftAndScanned(app: LaunchedApp, after: 'leave' | 'dismiss'): Promise<void> {
    act(() => {
      app.back.press();
    });
    await flush(200);
    const hub = scoringHubOf(app.ports);
    await (after === 'leave' ? hub.leave(FAKE_MATCH) : hub.dismiss(FAKE_MATCH));
    await app.kv.set(linkKey(FAKE_MATCH), STORED_LINK);
  }

  /** The server answers the ledger only once released: the pad meets the bootstrap before the events. */
  function holdLedger(app: LaunchedApp): () => void {
    let release: () => void = () => undefined;
    const open = new Promise<void>((resolve) => {
      release = resolve;
    });
    const real = app.scoring.events.bind(app.scoring);
    vi.spyOn(app.scoring, 'events').mockImplementation(async (...args) => {
      await open;
      return real(...args);
    });
    return release;
  }

  it.each(['leave', 'dismiss'] as const)(
    'finds the result with no Undo after a %s, though its ledger lands after the first look',
    async (after) => {
      const app = await startedMatch();
      await decided(app);
      await pass(app, 4_000);
      await leftAndScanned(app, after);
      const release = holdLedger(app);
      act(() => app.ports.navigation.go('scoring'));
      await flush(200);
      expect(screen.queryByTestId('pad-card')).toBeNull();
      release();
      await flush(1_000);
      // Four seconds on, with the kept ids: it must not read as a window opened now, nor as the one left.
      expect(cardText()).toBe(closed(en));
      expect(undoButton()).toBeNull();
      await pass(app, 3_000);
      expect(cardText()).toBe(closed(en));
    },
  );

  it('finds a window left a few seconds ago closed, not started again at 30', async () => {
    const app = await startedMatch();
    await decided(app);
    await pass(app, 4_000);
    expect(cardText()).toBe(open(en, 26));
    await leftAndScanned(app, 'leave');
    act(() => app.ports.navigation.go('scoring'));
    await flush(1_500);
    expect(cardText()).toBe(closed(en));
    expect(undoButton()).toBeNull();
  });
});

describe('Undo against a result made elsewhere in between', () => {
  it('shows no Undo when the other scorer decides the match after this phone took its own deciding tap back', async () => {
    const app = await startedMatch();
    await decided(app);
    await pass(app, 5_000);
    press(en['scoring.pad.undo']);
    await flush(300);
    expect(screen.queryByTestId('pad-card')).toBeNull();
    await scoredElsewhere(app, 1);
    expect(cardText()).toBe(closed(en));
    expect(undoButton()).toBeNull();
    await pass(app, 40_000);
    expect(cardText()).toBe(closed(en));
  });
});

describe('a deciding tap queued while the phone was offline', () => {
  it('follows the same rule: no Undo after 30 s on the pad, and the reconnect question can still discard it', async () => {
    const app = await startedMatch();
    await scoredElsewhere(app, 41);
    app.scoring.goOffline(true);
    await rally(app, 'first');
    await flush(0);
    expect(cardText()).toBe(open(en, 30));
    await pass(app, 29_000);
    expect(cardText()).toBe(open(en, 1));
    await pass(app, 1_000);
    expect(cardText()).toBe(closed(en));
    expect(undoButton()).toBeNull();
    // Someone scored on the web meanwhile, and the data comes back: the question stands and the tap is still its to ask.
    app.scoring.addOtherScorerEvent('badminton.rally', {
      wonBy: SINGLES_SEED.sides.away.entrantId,
    });
    app.scoring.goOffline(false);
    for (let waited = 0; screen.queryByTestId('ask-sheet') === null && waited < 40; waited += 1) {
      await pass(app, 1_000);
    }
    expect(screen.getByTestId('ask-sheet')).toBeTruthy();
    await pass(app, 2_000);
    press(en['scoring.ask.discard']);
    await pass(app, 2_000);
    press(en['scoring.ask.confirm.discard']);
    await pass(app, 2_000);
    expect(screen.queryByTestId('ask-sheet')).toBeNull();
    // The decider is gone: the match is open again, and no result card stands.
    expect(screen.queryByTestId('pad-card')).toBeNull();
  });
});
