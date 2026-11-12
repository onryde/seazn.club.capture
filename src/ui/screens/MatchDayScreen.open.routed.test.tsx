import { act, fireEvent, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Row } from '@/domain/matchday/matchDay';
import { encodeSavedCode, type SavedCode } from '@/domain/mode/savedCode';
import en from '@/i18n/en.json';
import { FAKE_DAY } from '@/services/fakeMatchDayPort';
import { SINGLES_SEED, seedFromPadSample, type FakeMatchSeed } from '@/services/fakeScoringPort';
import { STORE_KEYS } from '@/services/modeStore';
import { scoringLinkKey } from '@/services/scoringLinkStore';
import { readRecord, TEST_NOW } from '../../../test/fakePorts';
import { dayLink } from '../../../test/fixtures/dayCode';
import { flush, launchApp, type LaunchedApp } from '../../../test/routedApp';

// MD-2 Task 5 through the routed app: a tap on a Match Day row opens that match in Remote Scoring, and Back returns to
// the day's list (S4 design §6). The fake scoring server serves one match, so each test names the row it serves.

const SAVED_DAY: SavedCode = {
  mode: 'matchday',
  raw: dayLink(),
  slot: null,
  savedAt: TEST_NOW,
  expiresAt: null,
  stream: null,
  scoring: null,
};
const IN_MATCHDAY = {
  [STORE_KEYS.code('matchday')]: encodeSavedCode(SAVED_DAY),
  [STORE_KEYS.active]: 'matchday',
};
const NOW_ROW = FAKE_DAY.courts[0]?.now as Row;
const NEXT_ROW = FAKE_DAY.courts[0]?.next[0] as Row;
/** The badminton singles preview's match, served under this row's id. `events: []` is a match nothing has started. */
const serving = (row: Row, events?: FakeMatchSeed['events']): FakeMatchSeed => ({
  ...SINGLES_SEED,
  fixtureId: row.fixtureId,
  linkId: 'fake-link-md',
  ...(events === undefined ? {} : { events }),
});
const BACK = 'Back to Court 1';

beforeEach(() => vi.useFakeTimers({ now: TEST_NOW }));
afterEach(() => vi.useRealTimers());

const rowButton = (name: RegExp) => screen.getByRole('button', { name });
const tapRow = async (name: RegExp) => {
  fireEvent.click(rowButton(name));
  await flush(200);
};
const pressBack = async (app: LaunchedApp) => {
  fireEvent.click(screen.getByRole('button', { name: BACK }));
  await flush();
  expect(app.nav.current()).toBe('matchday');
};
const mode = (app: LaunchedApp) => {
  const snapshot = app.ports.modeStore.getSnapshot();
  return snapshot.status === 'ready' ? snapshot.saved.active : null;
};

describe('opening a match from the list', () => {
  it('tapping Now opens the pad with Back labelled "Back to Court 1"', async () => {
    const app = await launchApp({ kvSeed: IN_MATCHDAY, scoringSeed: serving(NOW_ROW) });
    expect(app.nav.current()).toBe('matchday');
    await tapRow(/^Now, Ng v Brown/);
    expect(app.nav.current()).toBe('scoring');
    expect(screen.queryByTestId('pad-content')).not.toBeNull();
    expect(screen.getByRole('button', { name: BACK })).toBeTruthy();
    expect(screen.queryByRole('button', { name: en['stream.home'] })).toBeNull();
  });

  it('the active mode is still matchday after opening', async () => {
    const app = await launchApp({ kvSeed: IN_MATCHDAY, scoringSeed: serving(NOW_ROW) });
    await tapRow(/^Now, Ng v Brown/);
    expect(mode(app)).toBe('matchday');
    expect(
      app.ports.modeStore.getSnapshot().status === 'ready' && app.kv.entries.get(STORE_KEYS.active),
    ).toBe('matchday');
  });

  it('Back returns to the list scrolled to Court 1', async () => {
    const scrolled: number[] = [];
    const scroll = vi.fn((options: { top: number }) => void scrolled.push(options.top));
    Object.defineProperty(HTMLElement.prototype, 'scroll', { value: scroll, configurable: true });
    try {
      const app = await launchApp({ kvSeed: IN_MATCHDAY, scoringSeed: serving(NOW_ROW) });
      await tapRow(/^Now, Ng v Brown/);
      await pressBack(app);
      expect(screen.getByText('Ng v Brown')).toBeTruthy();
      expect(screen.getByText('Court 1')).toBeTruthy();
      scrolled.length = 0;
      // Another court laid out first scrolls nothing: only the court the match was opened from does.
      laidOut(screen.getAllByTestId('court-card')[1] as Element, 700);
      expect(scrolled).toEqual([]);
      laidOut(screen.getAllByTestId('court-card')[0] as Element, 412);
      expect(scrolled).toEqual([412]);
      // Said once: a later layout of the same court (a poll redraws the day) does not scroll again.
      laidOut(screen.getAllByTestId('court-card')[0] as Element, 520);
      expect(scrolled).toEqual([412]);
    } finally {
      Reflect.deleteProperty(HTMLElement.prototype, 'scroll');
    }
  });

  it('Back from the pad leaves nothing open: a kill on the list reopens the list', async () => {
    const app = await launchApp({ kvSeed: IN_MATCHDAY, scoringSeed: serving(NOW_ROW) });
    await tapRow(/^Now, Ng v Brown/);
    expect(app.kv.entries.has('matchday.open')).toBe(true);
    await pressBack(app);
    expect(app.kv.entries.has('matchday.open')).toBe(false);
    expect(app.ports.matchDayStore.openMatch()).toBeNull();
  });

  it('Android Back on the pad returns to the list too', async () => {
    const app = await launchApp({ kvSeed: IN_MATCHDAY, scoringSeed: serving(NOW_ROW) });
    await tapRow(/^Now, Ng v Brown/);
    let handled = false;
    act(() => {
      handled = app.back.press();
    });
    await flush();
    expect(handled).toBe(true);
    expect(app.nav.current()).toBe('matchday');
  });

  it('a match whose link is dead opens the card, with the same Back to the list', async () => {
    const app = await launchApp({ kvSeed: IN_MATCHDAY, scoringSeed: serving(NOW_ROW) });
    app.scoring.revoke();
    await tapRow(/^Now, Ng v Brown/);
    expect(app.nav.current()).toBe('scoring');
    expect(screen.queryByTestId('pad-content')).toBeNull();
    expect(screen.getByRole('button', { name: BACK })).toBeTruthy();
    await pressBack(app);
  });

  it('tapping Next opens the Start screen', async () => {
    const app = await launchApp({ kvSeed: IN_MATCHDAY, scoringSeed: serving(NEXT_ROW, []) });
    await tapRow(/^Next, Patel v Okafor/);
    expect(app.nav.current()).toBe('scoring');
    expect(screen.getByRole('button', { name: en['scoring.start.confirm'] })).toBeTruthy();
    expect(screen.getByRole('button', { name: BACK })).toBeTruthy();
  });

  it('a double tap opens once', async () => {
    const app = await launchApp({ kvSeed: IN_MATCHDAY, scoringSeed: serving(NOW_ROW) });
    const go = vi.spyOn(app.ports.navigation, 'go');
    const row = rowButton(/^Now, Ng v Brown/);
    fireEvent.click(row);
    fireEvent.click(row);
    await flush(200);
    expect(app.matchDay.calls.filter((call) => call.op === 'open')).toHaveLength(1);
    expect(go.mock.calls.filter(([route]) => route === 'scoring')).toHaveLength(1);
  });

  it('MD_OUT_OF_SCOPE shows "This match isn’t on your courts" and does not navigate', async () => {
    const app = await launchApp({ kvSeed: IN_MATCHDAY });
    app.matchDay.answerOpen({ ok: true, value: { kind: 'refused', code: 'MD_OUT_OF_SCOPE' } });
    await tapRow(/^Now, Ng v Brown/);
    expect(screen.getByText(en['matchday.outOfScope'])).toBeTruthy();
    expect(app.nav.current()).toBe('matchday');
    expect(app.kv.entries.has(scoringLinkKey(NOW_ROW.fixtureId))).toBe(false);
  });

  it('offline with a stored link opens it; offline without one shows "Offline"', async () => {
    const app = await launchApp({ kvSeed: IN_MATCHDAY, scoringSeed: serving(NOW_ROW) });
    app.matchDay.answerOpen({ ok: false, offline: true });
    await tapRow(/^Now, Ng v Brown/);
    expect(app.nav.current()).toBe('matchday');
    expect(screen.getAllByText(en['matchday.offlineEmpty']).length).toBeGreaterThan(0);
    await app.kv.set(
      scoringLinkKey(NOW_ROW.fixtureId),
      JSON.stringify({
        origin: 'https://stg.seazn.club',
        token: 'dl_madeUpTokenForOpenTests01',
        sportKey: 'badminton',
      }),
    );
    await tapRow(/^Now, Ng v Brown/);
    expect(app.nav.current()).toBe('scoring');
    expect(screen.queryByTestId('pad-content')).not.toBeNull();
  });

  it('the line is cleared by the next tap', async () => {
    const app = await launchApp({ kvSeed: IN_MATCHDAY, scoringSeed: serving(NOW_ROW) });
    app.matchDay.answerOpen({ ok: true, value: { kind: 'refused', code: 'MD_OUT_OF_SCOPE' } });
    await tapRow(/^Now, Ng v Brown/);
    expect(screen.getByText(en['matchday.outOfScope'])).toBeTruthy();
    app.matchDay.answerOpen({
      ok: true,
      value: {
        kind: 'link',
        url: 'https://stg.seazn.club/score/dl_Fake-Open_0123456789abcdefghijklmnopqrstuvw',
        sportKey: 'badminton',
      },
    });
    await tapRow(/^Now, Ng v Brown/);
    expect(app.nav.current()).toBe('scoring');
  });
});

describe('finished rows, and a clear the phone refuses', () => {
  const finished = (fixtureId: string, home: string, away: string): Row => ({
    ...NOW_ROW,
    fixtureId,
    home,
    away,
    status: 'finished',
    summary: '21-10',
  });
  const HELD = finished('f-held', 'Lee', 'Tan');
  const UNHELD = finished('f-unheld', 'Roy', 'Kim');
  const DAY = {
    ...FAKE_DAY,
    courts: [
      {
        ...(FAKE_DAY.courts[0] as NonNullable<(typeof FAKE_DAY.courts)[0]>),
        finished: [HELD, UNHELD],
      },
    ],
  };

  it('a finished row opens only when this phone holds its link; the other is no control and shows its result', async () => {
    const app = await launchApp({
      kvSeed: { ...IN_MATCHDAY, 'matchday.opened': JSON.stringify([HELD.fixtureId]) },
      prepare: (fakes) => fakes.matchDay.answerDay({ ok: true, value: DAY }),
    });
    await flush(100);
    expect(screen.getByRole('button', { name: /^Finished, Lee v Tan, 21-10/ })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Roy v Kim/ })).toBeNull();
    expect(screen.getByLabelText('Finished, Roy v Kim, 21-10')).toBeTruthy();
  });

  it('a refused clear of matchday.open is recorded and Back still lands on the list', async () => {
    const app = await launchApp({
      kvSeed: IN_MATCHDAY,
      scoringSeed: serving(NOW_ROW),
      prepare: (fakes) =>
        void vi
          .spyOn(fakes.ports.matchDayStore, 'clearOpen')
          .mockRejectedValue(new Error('keystore refused')),
    });
    await tapRow(/^Now, Ng v Brown/);
    await pressBack(app);
    expect(readRecord(app.record).map((line) => line.event)).toContain(
      'matchday.open-clear-refused',
    );
  });
});

describe('after a kill, and the app leaving and coming back', () => {
  const WITH_OPEN = {
    ...IN_MATCHDAY,
    'matchday.open': JSON.stringify({ fixtureId: NOW_ROW.fixtureId, courtName: 'Court 1' }),
    [scoringLinkKey(NOW_ROW.fixtureId)]: JSON.stringify({
      origin: 'https://stg.seazn.club',
      token: 'dl_madeUpTokenForOpenTests01',
      sportKey: 'badminton',
    }),
  };

  it('cold start with matchday.open reopens the pad with Back to Match Day', async () => {
    const app = await launchApp({ kvSeed: WITH_OPEN, scoringSeed: serving(NOW_ROW) });
    expect(app.nav.current()).toBe('scoring');
    expect(app.nav.history).not.toContain('matchday');
    expect(screen.queryByTestId('pad-content')).not.toBeNull();
    await pressBack(app);
    expect(screen.getByText('Ng v Brown')).toBeTruthy();
  });

  it('cold start with matchday.open but another mode last stays Home', async () => {
    const app = await launchApp({
      kvSeed: { ...WITH_OPEN, [STORE_KEYS.active]: 'stream' },
      scoringSeed: serving(NOW_ROW),
    });
    expect(app.nav.current()).toBe('home');
  });

  it('cold start with matchday.open but no day code saved stays Home', async () => {
    const seed: Record<string, string> = { ...WITH_OPEN };
    delete seed[STORE_KEYS.code('matchday')];
    const app = await launchApp({ kvSeed: seed, scoringSeed: serving(NOW_ROW) });
    expect(app.nav.current()).toBe('home');
  });

  it('cold start with a garbled matchday.open lands on the list', async () => {
    const app = await launchApp({ kvSeed: { ...WITH_OPEN, 'matchday.open': '{not json' } });
    expect(app.nav.current()).toBe('matchday');
  });

  it('background mid-pad, foreground: the same match, on the same pad, Back still the list’s', async () => {
    const app = await launchApp({ kvSeed: IN_MATCHDAY, scoringSeed: serving(NOW_ROW) });
    await tapRow(/^Now, Ng v Brown/);
    const asked = app.matchDay.calls.length;
    act(() => app.foreground.leave());
    act(() => app.foreground.fire());
    await flush();
    expect(app.nav.current()).toBe('scoring');
    expect(screen.queryByTestId('pad-content')).not.toBeNull();
    expect(app.ports.matchDayStore.openMatch()?.fixtureId).toBe(NOW_ROW.fixtureId);
    // A foreground asks the server nothing of Match Day: the link is already held.
    expect(app.matchDay.calls.length).toBe(asked);
    await pressBack(app);
  });

  it('a match never opened on this phone shows the pad’s loading state until the ledger fold lands, never an empty pad', async () => {
    const app = await launchApp({ kvSeed: IN_MATCHDAY, scoringSeed: serving(NOW_ROW) });
    app.scoring.goOffline(true);
    await tapRow(/^Now, Ng v Brown/);
    expect(app.nav.current()).toBe('scoring');
    expect(screen.queryByTestId('pad-content')).toBeNull();
    app.scoring.goOffline(false);
    await flush(30_000);
    expect(screen.queryByTestId('pad-content')).not.toBeNull();
  });
});

describe('back and forth between the list and the matches', () => {
  it('open A, Back, open B, Back, open A again: one Realtime subscription at a time, on the open match', async () => {
    const app = await launchApp({ kvSeed: IN_MATCHDAY, scoringSeed: serving(NOW_ROW) });
    const live = () =>
      app.realtime.subscriptions.filter((one) => one.open).map((one) => one.grant.channel);
    expect(live()).toEqual([]);
    await tapRow(/^Now, Ng v Brown/);
    await flush(5_000);
    expect(live()).toEqual([`fixture:${NOW_ROW.fixtureId}`]);
    await pressBack(app);
    await flush(5_000);
    expect(live()).toEqual([]);
    // B is not on the fake server (it serves one match): its pad is the card for a match the server does not know.
    await tapRow(/^Next, Patel v Okafor/);
    await flush(5_000);
    expect(app.nav.current()).toBe('scoring');
    expect(live()).toEqual([]);
    await pressBack(app);
    await flush(5_000);
    await tapRow(/^Now, Ng v Brown/);
    await flush(5_000);
    expect(live()).toEqual([`fixture:${NOW_ROW.fixtureId}`]);
    expect(app.realtime.subscriptions.filter((one) => one.open)).toHaveLength(1);
    expect(app.ports.matchDayStore.openMatch()?.fixtureId).toBe(NOW_ROW.fixtureId);
  });
});

/** Delivers a layout to a court card, at `y`, as the phone would (jsdom has none; see `test/layOut.ts`). */
function laidOut(element: Element, y: number): void {
  const handler = (
    element as Element & {
      __reactLayoutHandler?: (event: { nativeEvent: { layout: Record<string, number> } }) => void;
    }
  ).__reactLayoutHandler;
  if (handler === undefined) throw new Error('the court card was given no onLayout');
  act(() => handler({ nativeEvent: { layout: { x: 0, y, width: 300, height: 200 } } }));
}
