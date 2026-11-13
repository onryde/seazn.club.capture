import { act, fireEvent, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { encodeSavedCode, type SavedCode } from '@/domain/mode/savedCode';
import { MATCHDAY_POLL_MS } from '@/hooks/useMatchDay';
import en from '@/i18n/en.json';
import { STORE_KEYS } from '@/services/modeStore';
import { TEST_NOW } from '../../../test/fakePorts';
import { dayLink } from '../../../test/fixtures/dayCode';
import { flush, launchApp, type LaunchedApp } from '../../../test/routedApp';

// MD-2 Task 4 through the routed app: the reopen gate, the list, and the way Home with news (S4 design §4, §5).

const SAVED_DAY: SavedCode = {
  mode: 'matchday',
  raw: dayLink(),
  slot: null,
  savedAt: TEST_NOW,
  expiresAt: null,
  stream: null,
  scoring: null,
};
const DAY_SEED = { [STORE_KEYS.code('matchday')]: encodeSavedCode(SAVED_DAY) };
const IN_MATCHDAY = { ...DAY_SEED, [STORE_KEYS.active]: 'matchday' };

beforeEach(() => vi.useFakeTimers({ now: TEST_NOW }));
afterEach(() => vi.useRealTimers());

const openFromHome = async (app: LaunchedApp) => {
  fireEvent.click(screen.getByRole('button', { name: /Match Day/ }));
  await flush();
  expect(app.nav.current()).toBe('matchday');
};

describe('Match Day after a kill (S4 design §4 "Reopen after a kill")', () => {
  it('cold start with active matchday reopens into matchday, and lists the day', async () => {
    const app = await launchApp({ kvSeed: IN_MATCHDAY });
    expect(app.nav.current()).toBe('matchday');
    expect(app.nav.history).not.toContain('home');
    expect(screen.getByText('Ng v Brown')).toBeTruthy();
  });

  it('cold start with the day code saved but another mode last opens Home', async () => {
    const app = await launchApp({ kvSeed: { ...DAY_SEED, [STORE_KEYS.active]: 'stream' } });
    expect(app.nav.current()).toBe('home');
  });

  it('cold start with Match Day last but no day code saved opens Home', async () => {
    const app = await launchApp({ kvSeed: { [STORE_KEYS.active]: 'matchday' } });
    expect(app.nav.current()).toBe('home');
  });

  it('a return to the foreground on the list stays on it, and reads the day at once', async () => {
    const app = await launchApp({ kvSeed: IN_MATCHDAY });
    const asked = app.matchDay.calls.length;
    act(() => app.foreground.leave());
    act(() => app.foreground.fire());
    await flush();
    expect(app.nav.current()).toBe('matchday');
    expect(app.matchDay.calls.length).toBe(asked + 1);
  });
});

describe('the list’s code ends while it shows (S4 design §4)', () => {
  it('refused MD_WITHDRAWN returns Home with "Match Day code withdrawn"', async () => {
    const app = await launchApp({ kvSeed: IN_MATCHDAY });
    app.matchDay.answerDay({ ok: false, refusal: 'MD_WITHDRAWN' });
    await flush(MATCHDAY_POLL_MS);
    expect(app.nav.current()).toBe('home');
    expect(screen.getByText(en['matchday.withdrawn'])).toBeTruthy();
    expect(app.kv.entries.has(STORE_KEYS.code('matchday'))).toBe(false);
  });

  it('the line is said once: Home opened again later does not repeat it', async () => {
    const app = await launchApp({ kvSeed: IN_MATCHDAY });
    app.matchDay.answerDay({ ok: false, refusal: 'MD_ENDED' });
    await flush(MATCHDAY_POLL_MS);
    expect(screen.getByText(en['matchday.ended'])).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
    await flush();
    fireEvent.click(screen.getByRole('button', { name: en['stream.home'] }));
    await flush();
    expect(app.nav.current()).toBe('home');
    expect(screen.queryByText(en['matchday.ended'])).toBeNull();
  });

  it('MD_NOT_OPEN returns Home saying when the day opens, and keeps the code', async () => {
    const app = await launchApp({ kvSeed: IN_MATCHDAY });
    app.matchDay.answerDay({
      ok: false,
      refusal: 'MD_NOT_OPEN',
      opensAt: new Date('2026-10-04T07:00:00.000Z'),
    });
    await flush(MATCHDAY_POLL_MS);
    expect(app.nav.current()).toBe('home');
    expect(screen.getByText(/^Match Day opens /)).toBeTruthy();
    expect(app.kv.entries.has(STORE_KEYS.code('matchday'))).toBe(true);
  });

  it('opened from Home’s tile, the list goes Home with the line too', async () => {
    const app = await launchApp({ kvSeed: DAY_SEED });
    expect(app.nav.current()).toBe('home');
    await openFromHome(app);
    app.matchDay.answerDay({ ok: false, refusal: 'MD_UNKNOWN' });
    await flush(MATCHDAY_POLL_MS);
    expect(app.nav.current()).toBe('home');
    expect(screen.getByText(en['matchday.unknown'])).toBeTruthy();
  });
});
