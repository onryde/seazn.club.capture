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
import {
  FAKE_LABEL,
  FAKE_MATCH,
  LINK,
  STORED_LINK,
  linkKey,
} from '../../../test/scoringHomeFixtures';
import { flush, launchApp, type LaunchedApp } from '../../../test/routedApp';

beforeEach(() => {
  seconds = 0;
  vi.useFakeTimers();
});
afterEach(() => vi.useRealTimers());

// The reconnect question on the pad (owner ruling 43, 2026-11-02), routed over the fake server with the real runner,
// queue and sender: the owner scored offline, someone scored on the web, the data came back. What the scorer sees: the
// sheet with how many were scored elsewhere and the score without the taps, Send my taps, Discard them and the confirm
// that Discard asks. What jsdom cannot see (the sheet's colours, a screen reader reading it) is the device check's.

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
const AWAY = SINGLES_SEED.sides.away.entrantId;

let seconds = 0;
/** The phone's clock a second on: the next tap is never in the bounce window of the last. */
const aSecondOn = (app: LaunchedApp) => {
  seconds += 1;
  app.setNow(new Date(TEST_NOW.getTime() + seconds * 1000));
};
async function pass(app: LaunchedApp, ms: number): Promise<void> {
  for (let elapsed = 0; elapsed < ms; elapsed += 1000) {
    aSecondOn(app);
    await flush(1000);
  }
}
const press = (name: string) => act(() => fireEvent.click(screen.getByRole('button', { name })));
const half = (side: 'first' | 'second') => screen.getByTestId(`half-${side}`);
const score = (side: 'first' | 'second') => within(half(side)).getByTestId('score').textContent;

async function rally(app: LaunchedApp, side: 'first' | 'second', times = 1): Promise<void> {
  for (let at = 0; at < times; at += 1) {
    aSecondOn(app);
    act(() => fireEvent.click(half(side)));
    await flush(0);
  }
}

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

/**
 * The owner's evening: the first side scored twice with the phone offline, the web gave the second side a point, and the
 * data came back. The sender asks (its first send meets the web's seq), and the question stands.
 */
async function reconnected(over: Parameters<typeof launchApp>[0] = {}, words: Words = en) {
  const app = await startedMatch(over, words);
  app.scoring.goOffline(true);
  await rally(app, 'first', 2);
  app.scoring.addOtherScorerEvent('badminton.rally', { wonBy: AWAY });
  app.scoring.goOffline(false);
  await pass(app, 30_000);
  return app;
}

/**
 * The question has just appeared: the phone's clock runs a second at a time until the sheet is up, and then holds, so
 * the next touch is in the bounce window of the sheet appearing.
 */
async function justAsked(): Promise<LaunchedApp> {
  const app = await startedMatch();
  app.scoring.goOffline(true);
  await rally(app, 'first', 2);
  app.scoring.addOtherScorerEvent('badminton.rally', { wonBy: AWAY });
  app.scoring.goOffline(false);
  for (let waited = 0; screen.queryByTestId('ask-sheet') === null && waited < 30; waited += 1) {
    await pass(app, 1_000);
  }
  expect(screen.getByTestId('ask-sheet')).toBeTruthy();
  return app;
}

describe('the sheet that asks', () => {
  it('stands over the pad with how many were scored elsewhere and the score without the phone’s taps', async () => {
    await reconnected();
    expect(screen.getByTestId('ask-sheet')).toBeTruthy();
    expect(screen.getByText(en['scoring.ask.title.one'].replace('{count}', '1'))).toBeTruthy();
    expect(screen.getByText(en['scoring.ask.body.other'].replace('{count}', '2'))).toBeTruthy();
    // The server has 0 : 1 (the web's rally); the pad behind shows the phone's two on top of it, 2 : 1.
    expect(screen.getByTestId('ask-score-first').textContent).toBe('0');
    expect(screen.getByTestId('ask-score-second').textContent).toBe('1');
    expect([score('first'), score('second')]).toEqual(['2', '1']);
    expect(screen.getByTestId('pad-content').getAttribute('aria-hidden')).toBe('true');
  });

  it('puts the can’t-send badge in the header: the taps are waiting for an answer, in words', async () => {
    await reconnected();
    expect(screen.getByTestId('sync').getAttribute('aria-label')).toBe(
      en['scoring.sync.asked.other'].replace('{count}', '2'),
    );
    expect(screen.getByTestId('sync-count').textContent).toBe('2');
  });

  it('sends nothing however long it waits', async () => {
    const app = await reconnected();
    await pass(app, 120_000);
    expect(screen.getByTestId('ask-sheet')).toBeTruthy();
    // The match's start and the web's rally: the phone's two taps are not on the server.
    expect((await app.scoring.events(LINK, FAKE_MATCH, 0)) as unknown[]).toHaveLength(2);
  });

  it('says it in every language', async () => {
    for (const [lang, words] of Object.entries(DICTIONARIES)) {
      const app = await reconnected({ deviceLanguages: [lang] }, words);
      expect(screen.getByRole('button', { name: words['scoring.ask.send'] })).toBeTruthy();
      expect(screen.getByRole('button', { name: words['scoring.ask.discard'] })).toBeTruthy();
      expect(screen.getByText(words['scoring.ask.title.one'].replace('{count}', '1'))).toBeTruthy();
      expect(screen.getByTestId('sync').getAttribute('aria-label')).toBe(
        words['scoring.sync.asked.other'].replace('{count}', '2'),
      );
      void app;
      document.body.innerHTML = '';
    }
  });

  it('takes no tap in the bounce window of appearing: a tap the scorer was making is not an answer', async () => {
    const app = await justAsked();
    press(en['scoring.ask.send']);
    expect(screen.getByTestId('ask-sheet')).toBeTruthy();
    await pass(app, 2_000);
    press(en['scoring.ask.send']);
    expect(screen.queryByTestId('ask-sheet')).toBeNull();
  });

  it('takes no Discard in that window either: the confirm opens only for a touch after it', async () => {
    const app = await justAsked();
    press(en['scoring.ask.discard']);
    expect(screen.queryByTestId('dismiss-confirm')).toBeNull();
    expect(screen.getByTestId('ask-sheet')).toBeTruthy();
    await pass(app, 2_000);
    press(en['scoring.ask.discard']);
    expect(screen.getByTestId('dismiss-confirm')).toBeTruthy();
  });

  it('opens over a History or Match details the scorer had open, and leaves nothing of it behind once answered', async () => {
    const app = await startedMatch();
    app.scoring.goOffline(true);
    await rally(app, 'first', 2);
    press(en['scoring.history.title']);
    expect(screen.getByTestId('history')).toBeTruthy();
    app.scoring.addOtherScorerEvent('badminton.rally', { wonBy: AWAY });
    app.scoring.goOffline(false);
    await pass(app, 30_000);
    expect(screen.getByTestId('ask-sheet')).toBeTruthy();
    expect(screen.queryByTestId('history')).toBeNull();
    press(en['scoring.ask.send']);
    expect(screen.queryByTestId('ask-sheet')).toBeNull();
    expect(screen.queryByTestId('history')).toBeNull();
  });
});

describe('Send my taps', () => {
  it('closes the sheet, and the taps go on top of the web’s: the score is theirs and ours, and the badge clears', async () => {
    const app = await reconnected();
    await pass(app, 2_000);
    press(en['scoring.ask.send']);
    expect(screen.queryByTestId('ask-sheet')).toBeNull();
    await pass(app, 30_000);
    expect([score('first'), score('second')]).toEqual(['2', '1']);
    expect(screen.queryByTestId('sync')).toBeNull();
    // The start, the web's rally and the phone's two taps.
    expect((await app.scoring.events(LINK, FAKE_MATCH, 0)) as unknown[]).toHaveLength(4);
  });

  it('is an opening tap: a touch on a half right behind it counts once, and the line says so', async () => {
    const app = await reconnected();
    await pass(app, 2_000);
    press(en['scoring.ask.send']);
    act(() => fireEvent.click(half('first')));
    await flush(0);
    expect(score('first')).toBe('2');
    expect(screen.getByText(en['scoring.pad.countedOnce'])).toBeTruthy();
  });
});

describe('Discard them', () => {
  it('asks again first, with Keep as the lime plate, and Keep brings the question back', async () => {
    const app = await reconnected();
    await pass(app, 2_000);
    press(en['scoring.ask.discard']);
    expect(screen.queryByTestId('ask-sheet')).toBeNull();
    const confirm = screen.getByTestId('dismiss-confirm');
    expect(
      within(confirm).getByText(en['scoring.ask.confirm.title.other'].replace('{count}', '2')),
    ).toBeTruthy();
    expect(within(confirm).getByText(en['scoring.ask.confirm.body.other'])).toBeTruthy();
    const names = within(confirm)
      .getAllByRole('button')
      .map((button) => button.getAttribute('aria-label') ?? button.textContent);
    expect(names).toEqual([en['scoring.ask.confirm.keep'], en['scoring.ask.confirm.discard']]);
    await pass(app, 2_000);
    press(en['scoring.ask.confirm.keep']);
    expect(screen.queryByTestId('dismiss-confirm')).toBeNull();
    expect(screen.getByTestId('ask-sheet')).toBeTruthy();
  });

  it('Back keeps, as the dim does: the question is back, nothing deleted', async () => {
    const app = await reconnected();
    await pass(app, 2_000);
    press(en['scoring.ask.discard']);
    let handled = false;
    act(() => {
      handled = app.back.press();
    });
    await flush();
    expect(handled).toBe(true);
    expect(screen.getByTestId('ask-sheet')).toBeTruthy();
    await pass(app, 2_000);
    press(en['scoring.ask.discard']);
    await pass(app, 2_000);
    act(() => fireEvent.click(screen.getByTestId('dismiss-dim')));
    expect(screen.getByTestId('ask-sheet')).toBeTruthy();
    expect(screen.getByTestId('sync-count').textContent).toBe('2');
  });

  it('confirmed, deletes the taps: nothing is sent, the pad shows the match as the web has it, and the badge goes', async () => {
    const app = await reconnected();
    await pass(app, 2_000);
    press(en['scoring.ask.discard']);
    await pass(app, 2_000);
    press(en['scoring.ask.confirm.discard']);
    expect(screen.queryByTestId('dismiss-confirm')).toBeNull();
    expect(screen.queryByTestId('ask-sheet')).toBeNull();
    await pass(app, 30_000);
    expect([score('first'), score('second')]).toEqual(['0', '1']);
    expect(screen.queryByTestId('sync')).toBeNull();
    expect((await app.scoring.events(LINK, FAKE_MATCH, 0)) as unknown[]).toHaveLength(2);
  });

  it('takes no Discard in the bounce window of its confirm appearing: the confirm stays, and nothing is deleted', async () => {
    const app = await reconnected();
    await pass(app, 2_000);
    press(en['scoring.ask.discard']);
    press(en['scoring.ask.confirm.discard']);
    expect(screen.getByTestId('dismiss-confirm')).toBeTruthy();
    expect(screen.getByTestId('sync-count').textContent).toBe('2');
    await pass(app, 2_000);
    press(en['scoring.ask.confirm.discard']);
    expect(screen.queryByTestId('dismiss-confirm')).toBeNull();
  });

  it('is an opening tap: a touch on a half right behind the confirmed Discard counts once', async () => {
    const app = await reconnected();
    await pass(app, 2_000);
    press(en['scoring.ask.discard']);
    await pass(app, 2_000);
    press(en['scoring.ask.confirm.discard']);
    act(() => fireEvent.click(half('first')));
    await flush(0);
    expect(score('first')).toBe('0');
    expect(screen.getByText(en['scoring.pad.countedOnce'])).toBeTruthy();
  });

  it('goes with the question: the web takes its rally back while the confirm is up, and the pad is the pad again', async () => {
    const app = await reconnected();
    await pass(app, 2_000);
    press(en['scoring.ask.discard']);
    expect(screen.getByTestId('dismiss-confirm')).toBeTruthy();
    const web = (await app.scoring.events(LINK, FAKE_MATCH, 0)) as unknown as { id: string }[];
    app.scoring.addOtherScorerEvent('core.void', { event_id: web[web.length - 1].id });
    act(() => app.realtime.ping());
    await pass(app, 10_000);
    expect(screen.queryByTestId('dismiss-confirm')).toBeNull();
    expect(screen.queryByTestId('ask-sheet')).toBeNull();
    // No sheet is left open behind it: Back leaves the pad, it does not close a sheet that is not there.
    let handled = false;
    act(() => {
      handled = app.back.press();
    });
    await flush();
    expect(handled).toBe(true);
    expect(screen.queryByTestId('pad-content')).toBeNull();
  });

  it('is asked once, not twice, for a double tap on the confirm’s button', async () => {
    const app = await reconnected();
    await pass(app, 2_000);
    press(en['scoring.ask.discard']);
    await pass(app, 2_000);
    const confirmed = screen.getByRole('button', { name: en['scoring.ask.confirm.discard'] });
    act(() => {
      fireEvent.click(confirmed);
      fireEvent.click(confirmed);
    });
    await pass(app, 2_000);
    expect(screen.queryByTestId('dismiss-confirm')).toBeNull();
    expect(screen.queryByTestId('ask-sheet')).toBeNull();
  });
});

describe('the question after an interruption', () => {
  it('Back leaves the pad for Home, and the next visit finds the question standing', async () => {
    const app = await reconnected();
    let handled = false;
    act(() => {
      handled = app.back.press();
    });
    await flush();
    expect(handled).toBe(true);
    act(() => app.ports.navigation.go('scoring'));
    await flush(200);
    expect(screen.getByTestId('ask-sheet')).toBeTruthy();
  });
});
