import { fireEvent, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Row } from '@/domain/matchday/matchDay';
import { encodeSavedCode, type SavedCode } from '@/domain/mode/savedCode';
import { scoringHubOf } from '@/hooks/scoringHub';
import { FAKE_DAY } from '@/services/fakeMatchDayPort';
import { SINGLES_SEED, type FakeMatchSeed } from '@/services/fakeScoringPort';
import { MATCHDAY_KEYS } from '@/services/matchDayStore';
import { STORE_KEYS } from '@/services/modeStore';
import { scoringLinkKey } from '@/services/scoringLinkStore';
import { readRecord, TEST_NOW } from '../../../test/fakePorts';
import { dayLink } from '../../../test/fixtures/dayCode';
import { flush, launchApp, type LaunchedApp } from '../../../test/routedApp';

// MD-2 Task 7 through the routed app (S4 design §4 and §10 item 4): score on a match opened from the day, go back, Exit,
// and the taps still go; Home keeps a Sending card until they land; the Match Day tile scans again. The fake scoring
// server serves one match, so the test names the row it serves. What a phone shows, and a real network, are Task 8's.

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
const serving = (row: Row): FakeMatchSeed => ({
  ...SINGLES_SEED,
  fixtureId: row.fixtureId,
  linkId: 'fake-link-md',
});
const AT = '2026-11-02T09:00:00.000Z';

beforeEach(() => vi.useFakeTimers({ now: TEST_NOW }));
afterEach(() => vi.useRealTimers());

/** Opens the match from its row and comes back to the list: the match is opened and its link is kept. */
async function openAndComeBack(app: LaunchedApp): Promise<void> {
  fireEvent.click(screen.getByRole('button', { name: /^Now, Ng v Brown/ }));
  await flush(200);
  expect(app.nav.current()).toBe('scoring');
  fireEvent.click(screen.getByRole('button', { name: 'Back to Court 1' }));
  await flush();
  expect(app.nav.current()).toBe('matchday');
}

/** A pad left with `count` taps the server never saw (it was away), as the hub's own tests make one. */
async function leftWithTaps(app: LaunchedApp, count: number): Promise<void> {
  const handle = scoringHubOf(app.ports).focus(NOW_ROW.fixtureId);
  await flush();
  app.scoring.goOffline(true);
  handle.runner.dispatch({
    kind: 'tap',
    tap: { kind: 'start', server: 'first' },
    key: 'k0',
    at: AT,
  });
  for (let n = 1; n < count; n += 1)
    handle.runner.dispatch({
      kind: 'tap',
      tap: { kind: 'rally', side: 'first' },
      key: `k${n}`,
      at: AT,
    });
  await flush();
  handle.release();
  await flush();
}

const exitThrough = async (app: LaunchedApp) => {
  fireEvent.click(screen.getByRole('button', { name: 'More' }));
  await flush();
  fireEvent.click(screen.getByRole('button', { name: 'Exit' }));
  await flush(300);
  expect(app.nav.current()).toBe('home');
};

describe('Exit with taps unsent, through the app (design §10 item 4)', () => {
  it('asks "3 taps still sending", leaves, keeps the Sending card, and the taps land when the network is back', async () => {
    const app = await launchApp({ kvSeed: IN_MATCHDAY, scoringSeed: serving(NOW_ROW) });
    await openAndComeBack(app);
    await leftWithTaps(app, 3);
    fireEvent.click(screen.getByRole('button', { name: 'More' }));
    await flush();
    expect(screen.getByText("3 taps still sending — they'll keep sending.")).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Exit' }));
    await flush(300);
    expect(app.nav.current()).toBe('home');
    expect(screen.getByText('Sending 3 taps · Court 1')).toBeTruthy();
    // Nothing is forgotten but the code: the match's own link stays until its queue is empty.
    expect(app.kv.entries.has(STORE_KEYS.code('matchday'))).toBe(false);
    expect(app.kv.entries.has(scoringLinkKey(NOW_ROW.fixtureId))).toBe(true);
    expect((await app.tapQueue.load(NOW_ROW.fixtureId))?.pending).toHaveLength(3);
    app.scoring.goOffline(false);
    // The sender's back-off is on the phone's clock, which a routed app holds still: move it on.
    app.setNow(new Date(TEST_NOW.getTime() + 10 * 60_000));
    await flush(30_000);
    expect(screen.queryByText(/Sending/)).toBeNull();
    expect(app.kv.entries.has(MATCHDAY_KEYS.sending)).toBe(false);
    expect(await app.tapQueue.load(NOW_ROW.fixtureId)).toBeNull();
    // The queue is empty and nothing holds the match: its link goes, by S2's own rules.
    expect(app.kv.entries.has(scoringLinkKey(NOW_ROW.fixtureId))).toBe(false);
  });

  it('after Exit the Match Day tile scans again, and the saved day is not what it opens', async () => {
    const app = await launchApp({ kvSeed: IN_MATCHDAY, scoringSeed: serving(NOW_ROW) });
    await exitThrough(app);
    expect(app.scanner.scans).toBe(0);
    fireEvent.click(screen.getByRole('button', { name: /Match Day/ }));
    await flush();
    expect(app.scanner.scans).toBe(1);
    expect(app.nav.current()).toBe('home');
    expect(app.matchDay.calls.some((call) => call.op === 'open')).toBe(false);
  });

  it('with nothing unsent: no Sending card, and the plain question', async () => {
    const app = await launchApp({ kvSeed: IN_MATCHDAY, scoringSeed: serving(NOW_ROW) });
    fireEvent.click(screen.getByRole('button', { name: 'More' }));
    await flush();
    expect(screen.getByText("You'll need to scan again.")).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Exit' }));
    await flush(300);
    expect(app.nav.current()).toBe('home');
    expect(screen.queryByTestId('matchday-sending')).toBeNull();
  });

  it('the record gets matchday.open {kind} and matchday.exit {unsent}, with no token, link or fixture', async () => {
    const app = await launchApp({ kvSeed: IN_MATCHDAY, scoringSeed: serving(NOW_ROW) });
    await openAndComeBack(app);
    await leftWithTaps(app, 3);
    await exitThrough(app);
    const lines = readRecord(app.record);
    expect(lines.find((line) => line.event === 'matchday.open')?.fields).toEqual({
      kind: 'badminton',
    });
    expect(lines.find((line) => line.event === 'matchday.exit')?.fields).toEqual({ unsent: 3 });
    const text = app.record.lines().join('\n');
    for (const secret of ['dl_', 'md_', NOW_ROW.fixtureId]) expect(text).not.toContain(secret);
  });
});
