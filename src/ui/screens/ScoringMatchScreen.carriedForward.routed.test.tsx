import { act, fireEvent, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { encodeSavedCode, type SavedCode } from '@/domain/mode/savedCode';
import en from '@/i18n/en.json';
import es from '@/i18n/es.json';
import fr from '@/i18n/fr.json';
import nl from '@/i18n/nl.json';
import { SINGLES_SEED } from '@/services/fakeScoringPort';
import { STORE_KEYS } from '@/services/modeStore';
import { TEST_NOW } from '../../../test/fakePorts';
import { FAKE_LABEL, FAKE_MATCH, STORED_LINK, linkKey } from '../../../test/scoringHomeFixtures';
import { backgroundAndBack, flush, launchApp, type LaunchedApp } from '../../../test/routedApp';

vi.mock('@/hooks/keepAwake', async () => {
  const { recordingHold } = await import('../../../test/heldScreen');
  return { holdScreenOn: recordingHold([]) };
});

beforeEach(() => {
  seconds = 0;
  vi.useFakeTimers();
});
afterEach(() => vi.useRealTimers());

// Task 8d (device check, 2026-11-04): "in web decided, but in mobile show that finalized". A decided match whose result
// the web has carried forward (a feed seated, the stage complete) refuses a device link every write, 403
// RESULT_CARRIED_FORWARD, and its bootstrap is the View-only screen with the reason `carried_forward`; nobody finalized
// it, and Undo, which the phone offers for 45 s, is refused too (usecases/scoring.ts judges it before the void). Each
// test reads what the scorer sees, on the real runner, queue and sender over the fake server. What jsdom cannot see (the
// card's colours, TalkBack reading it) is the device check's.

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
const press = (name: string) => act(() => fireEvent.click(screen.getByRole('button', { name })));
const half = (side: 'first' | 'second') => screen.getByTestId(`half-${side}`);
const cardText = () => screen.getByTestId('pad-card').textContent;
const undoButton = (words: Words = en) =>
  screen.queryByRole('button', { name: words['scoring.pad.undo'] });

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

/** The match decided by this phone's own tap: 41 rallies from another scorer, then this phone's 42nd. */
async function decided(app: LaunchedApp): Promise<void> {
  for (let at = 0; at < 41; at += 1) {
    app.scoring.addOtherScorerEvent('badminton.rally', {
      wonBy: SINGLES_SEED.sides.home.entrantId,
    });
  }
  app.realtime.ping();
  await flush(1_000);
  aSecondOn(app);
  act(() => fireEvent.click(half('first')));
  await flush(0);
  await flush(0);
}

const carriedCard = (words: Words) =>
  words['scoring.card.carriedForward.title'] + words['scoring.card.carriedForward.body'];

describe('Undo refused because the result was carried forward (403 RESULT_CARRIED_FORWARD)', () => {
  it.each([
    ['en', en],
    ['es', es],
    ['fr', fr],
    ['nl', nl],
  ] as const)(
    'replaces the result card with the carried-forward card in %s: no Undo, no countdown, nothing finalised',
    async (lang, words) => {
      const app = await startedMatch(words, lang);
      await decided(app);
      expect(cardText()).toContain(words['scoring.card.resultRecorded.title']);
      // The deciding tap carried the competition on; the scorer, seeing a result, takes Undo inside the 45 s.
      app.scoring.carryForward(true);
      await pass(app, 5_000);
      press(words['scoring.pad.undo']);
      await flush(1_000);
      expect(cardText()).toBe(carriedCard(words));
      expect(cardText()).not.toContain(words['scoring.card.viewOnly.title']);
      expect(cardText()).not.toContain(words['scoring.card.viewOnly.body']);
      expect(screen.queryByTestId('pad-card-countdown')).toBeNull();
      expect(half('first').getAttribute('aria-disabled')).toBe('true');
      expect(half('second').getAttribute('aria-disabled')).toBe('true');
      expect(undoButton(words)?.getAttribute('aria-disabled')).toBe('true');
    },
  );

  it('closes the queue: the refused Undo is sent once, and nothing more however long the phone waits', async () => {
    const app = await startedMatch();
    await decided(app);
    app.scoring.carryForward(true);
    const append = vi.spyOn(app.scoring, 'append');
    await pass(app, 5_000);
    press(en['scoring.pad.undo']);
    await flush(1_000);
    expect(append).toHaveBeenCalledTimes(1);
    expect(append.mock.calls[0][2].type).toBe('core.void');
    await pass(app, 60_000);
    await backgroundAndBack(app);
    await flush(2_000);
    expect(append).toHaveBeenCalledTimes(1);
    expect(cardText()).toBe(carriedCard(en));
  });

  it('is still the carried-forward card a minute on, after the 45 s the window had would have closed', async () => {
    const app = await startedMatch();
    await decided(app);
    app.scoring.carryForward(true);
    await pass(app, 5_000);
    press(en['scoring.pad.undo']);
    await flush(1_000);
    await pass(app, 60_000);
    expect(cardText()).toBe(carriedCard(en));
    expect(cardText()).not.toContain(en['scoring.card.resultRecorded.bodyClosed']);
  });

  // Controller, 2026-11-04 (AGENTS §2: the server's ledger is the one authority). The Undo the web refused is still in
  // the queue, but the result is the web's: the deciding rally stands, so the pad says 21, not the 20 a fold with the
  // refused Undo gave (the device probe: pad 20, server 21). The badge and the card still tell the scorer to ask.
  it('keeps the server’s score after the refused Undo: the deciding rally still counts, 21 and not 20', async () => {
    const app = await startedMatch();
    await decided(app);
    const score = (side: 'first' | 'second') => within(half(side)).getByTestId('score').textContent;
    expect([score('first'), score('second')]).toEqual(['21', '0']);
    app.scoring.carryForward(true);
    await pass(app, 5_000);
    press(en['scoring.pad.undo']);
    await flush(1_000);
    expect(cardText()).toBe(carriedCard(en));
    expect([score('first'), score('second')]).toEqual(['21', '0']);
    const badge = screen.getByTestId('sync');
    expect([badge.getAttribute('aria-label'), badge.textContent]).toEqual([
      en['scoring.sync.refused.one'].replace('{count}', '1'),
      '1',
    ]);
    await pass(app, 60_000);
    await backgroundAndBack(app);
    await flush(2_000);
    expect([score('first'), score('second')]).toEqual(['21', '0']);
  });

  // A bare 403 on a void is that one tap's (the link may not undo it), never a closed match: `sync.ts` ONE_TAP_403.
  it('another 403 on the Undo is not this: the card stays the recorded result’s', async () => {
    const app = await startedMatch();
    await decided(app);
    app.scoring.forbid('FORBIDDEN');
    await pass(app, 5_000);
    press(en['scoring.pad.undo']);
    await flush(1_000);
    expect(cardText()).toContain(en['scoring.card.resultRecorded.title']);
    expect(cardText()).not.toContain(en['scoring.card.carriedForward.title']);
  });
});

describe('the bootstrap says the result was carried forward', () => {
  it('shows the carried-forward card, not the finalised one, when the phone next looks at the match', async () => {
    const app = await startedMatch();
    await decided(app);
    expect(cardText()).toContain(en['scoring.card.resultRecorded.title']);
    app.scoring.carryForward(true);
    // The bootstrap is read at most every 15 s; the next look after that (the foreground) finds the screen View-only.
    await pass(app, 16_000);
    await backgroundAndBack(app);
    await flush(2_000);
    expect(cardText()).toBe(carriedCard(en));
    expect(cardText()).not.toContain(en['scoring.card.viewOnly.body']);
    expect(half('first').getAttribute('aria-disabled')).toBe('true');
    expect(undoButton()?.getAttribute('aria-disabled')).toBe('true');
    expect(within(half('first')).getByTestId('score').textContent).toBe('21');
  });

  it('is the web’s answer for the organiser’s lock that stays "finalised": a finalized match keeps the old card', async () => {
    const app = await startedMatch();
    await decided(app);
    app.scoring.finalize();
    app.scoring.carryForward(true);
    await pass(app, 16_000);
    await backgroundAndBack(app);
    await flush(2_000);
    expect(cardText()).toBe(en['scoring.card.viewOnly.title'] + en['scoring.card.viewOnly.body']);
  });

  // Controller, 2026-11-04. The card's words follow the reason the web names: only the organiser's lock says "finalised".
  // The fake server's View-only seed names the reason, as the web's bootstrap does for a cancelled match or a bye.
  it.each([
    ['en', en],
    ['es', es],
    ['fr', fr],
    ['nl', nl],
  ] as const)(
    'shows a cancelled match and a seat with no opponent each in its own words in %s, neither finalised',
    async (lang, words) => {
      for (const [reason, body] of [
        ['cancelled', 'scoring.card.cancelled.body'],
        ['no_opponent', 'scoring.card.noOpponent.body'],
      ] as const) {
        const app = await launchApp({
          kvSeed: IN_MATCH,
          deviceLanguages: [lang],
          scoringSeed: { ...SINGLES_SEED, screen: 'viewOnly', viewOnlyReason: reason },
        });
        await flush(200);
        expect(cardText()).toBe(words['scoring.card.viewOnly.title'] + words[body]);
        expect(cardText()).not.toContain(words['scoring.card.viewOnly.body']);
        expect(cardText()).not.toContain(words['scoring.card.carriedForward.title']);
        expect(half('first').getAttribute('aria-disabled')).toBe('true');
        app.unmount();
      }
    },
  );

  it('a match still in play is the pad, whatever the competition has carried', async () => {
    const app = await startedMatch();
    app.scoring.carryForward(true);
    await pass(app, 16_000);
    await backgroundAndBack(app);
    await flush(2_000);
    expect(screen.queryByTestId('pad-card')).toBeNull();
    expect(half('first').getAttribute('aria-disabled')).not.toBe('true');
  });
});
