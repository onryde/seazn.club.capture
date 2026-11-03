import { act, fireEvent, renderHook, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { decodeSavedCode, encodeSavedCode } from '@/domain/mode/savedCode';
import { useHome } from '@/hooks/useHome';
import { scoringHubOf } from '@/hooks/scoringHub';
import { createFakeScoringPort, DOUBLES_SEED } from '@/services/fakeScoringPort';
import { createMemoryKeyValueStore } from '@/services/KeyValueStore';
import { createModeStore, STORE_KEYS } from '@/services/modeStore';
import { HomeScreen } from '@/ui/screens/HomeScreen';
import { createFakePorts, readRecord, TEST_NOW } from '../../../test/fakePorts';
import { captureRaw, epochSeconds } from '../../../test/fixtures/wire';
import { renderWithPorts, wrapperFor } from '../../../test/renderWithPorts';
import {
  FAKE_LABEL,
  FAKE_MATCH,
  LINK,
  STORED_LINK,
  RAW,
  TOKEN,
  leave,
  linkKey,
  queueHolding,
} from '../../../test/scoringHomeFixtures';

/** A scoring code saved by an earlier scan, as the store writes it. */
const savedMatch = (fixtureId: string, label: string): string =>
  encodeSavedCode({
    mode: 'scoring',
    raw: '',
    slot: null,
    savedAt: TEST_NOW,
    expiresAt: null,
    stream: null,
    scoring: { fixtureId, label },
  });

const IN_TWO_HOURS = new Date(TEST_NOW.getTime() + 2 * 3600_000);

// Plan S2-1 Task 10, the scan: a Remote Scoring link is read from the server BEFORE anything is saved (design §4 step 1),
// so a code that does not work never lands in the store, and the fixture id (the key of the link and the queue) is
// the server's, not ours. Offline at the scan nothing can be saved: the fixture id is unknown until the bootstrap
// answers, so the panel says "No connection" with Try again, as the stream code check does.

async function renderHome(options?: Parameters<typeof renderWithPorts>[1]) {
  const result = renderWithPorts(<HomeScreen />, options);
  await act(() => result.ports.modeStore.load());
  return result;
}

const scoringTile = () => screen.getByRole('button', { name: /Remote Scoring/ });
const scanScoring = (home: Awaited<ReturnType<typeof renderHome>>, raw = RAW) => {
  home.scanner.queue({ outcome: 'scanned', raw });
  fireEvent.click(scoringTile());
};

describe('a scoring link scanned from Home', () => {
  it('reads the match, then saves the link and the code, makes it active and opens /scoring', async () => {
    const home = await renderHome();
    scanScoring(home);
    await waitFor(() => expect(home.navigation.current()).toBe('scoring'));
    expect(home.kv.entries.get(STORE_KEYS.active)).toBe('scoring');
    const saved = decodeSavedCode(home.kv.entries.get(STORE_KEYS.code('scoring')) ?? '');
    expect(saved?.scoring).toEqual({ fixtureId: FAKE_MATCH, label: FAKE_LABEL });
    expect(JSON.parse(home.kv.entries.get(linkKey(FAKE_MATCH)) ?? 'null')).toEqual({
      ...LINK,
      sportKey: 'badminton',
    });
    // A scoring code never pairs (four questions, mode).
    expect(home.engine.intents).toEqual([]);
  });

  it('keeps the sport the bootstrap names with the link, where every runner reads it, and not in the saved code', async () => {
    const home = await renderHome();
    const bootstrap = home.scoring.bootstrap;
    vi.spyOn(home.scoring, 'bootstrap').mockImplementation(async (link) => {
      const answer = await bootstrap(link);
      return answer.kind === 'ok'
        ? { ...answer, bootstrap: { ...answer.bootstrap, sportKey: 'tabletennis' } }
        : answer;
    });
    scanScoring(home);
    await waitFor(() => expect(home.navigation.current()).toBe('scoring'));
    const kept = JSON.parse(home.kv.entries.get(linkKey(FAKE_MATCH)) ?? 'null');
    expect(kept).toEqual({ ...LINK, sportKey: 'tabletennis' });
    expect(home.kv.entries.get(STORE_KEYS.code('scoring'))).not.toContain('tabletennis');
  });

  it('asks the server first, saves the link before the code, and the code before the route', async () => {
    const home = await renderHome();
    const order: string[] = [];
    const bootstrap = home.scoring.bootstrap;
    vi.spyOn(home.scoring, 'bootstrap').mockImplementation(async (link) => {
      order.push('bootstrap');
      return bootstrap(link);
    });
    const set = home.kv.set;
    vi.spyOn(home.kv, 'set').mockImplementation(async (key, value) => {
      await set(key, value);
      order.push(key);
    });
    const go = home.navigation.go;
    vi.spyOn(home.navigation, 'go').mockImplementation((route) => {
      order.push(`route ${route}`);
      go(route);
    });
    scanScoring(home);
    await waitFor(() => expect(home.navigation.current()).toBe('scoring'));
    expect(order).toEqual([
      'bootstrap',
      linkKey(FAKE_MATCH),
      STORE_KEYS.code('scoring'),
      STORE_KEYS.active,
      'route scoring',
    ]);
  });

  it('asks the bootstrap with the build’s own origin and the scanned token, and never the stream code check', async () => {
    const home = await renderHome();
    const bootstrap = vi.spyOn(home.scoring, 'bootstrap');
    scanScoring(home);
    await waitFor(() => expect(home.navigation.current()).toBe('scoring'));
    expect(bootstrap.mock.calls).toEqual([[LINK]]);
    expect(home.code.calls).toHaveLength(0);
  });

  it('keeps the token in the secure store alone: not in the saved code, a queue file or the record', async () => {
    const home = await renderHome();
    scanScoring(home);
    await waitFor(() => expect(home.navigation.current()).toBe('scoring'));
    const holders = [...home.kv.entries].filter(([, value]) => value.includes(TOKEN));
    expect(holders.map(([key]) => key)).toEqual([linkKey(FAKE_MATCH)]);
    expect([...home.queueFiles.files.values()].join('')).not.toContain(TOKEN);
    expect(JSON.stringify(readRecord(home.record))).not.toContain(TOKEN);
  });

  it('says it is checking while the server has not answered, and saves nothing yet', async () => {
    const home = await renderHome();
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => (release = resolve));
    const bootstrap = home.scoring.bootstrap;
    vi.spyOn(home.scoring, 'bootstrap').mockImplementation(async (link) => {
      await held;
      return bootstrap(link);
    });
    scanScoring(home);
    await screen.findByText('Checking the link…');
    expect(home.kv.entries.has(STORE_KEYS.code('scoring'))).toBe(false);
    expect(home.kv.entries.has(linkKey(FAKE_MATCH))).toBe(false);
    release();
    await waitFor(() => expect(home.navigation.current()).toBe('scoring'));
    expect(screen.queryByText('Checking the link…')).toBeNull();
    expect(screen.queryByText('Checking code…')).toBeNull();
  });

  it('offline: saves nothing, says there is no connection, and Try again opens it once the network is back', async () => {
    const home = await renderHome();
    home.scoring.goOffline(true);
    scanScoring(home);
    await screen.findByText('No connection');
    // A link is checked, not a code: the panel says so (the Batch D review).
    expect(screen.getByText("Can't check this link — no connection. Try again.")).toBeTruthy();
    expect(screen.queryByText(/this code/)).toBeNull();
    expect(home.kv.entries.has(STORE_KEYS.code('scoring'))).toBe(false);
    expect(home.kv.entries.has(linkKey(FAKE_MATCH))).toBe(false);
    expect(home.navigation.current()).toBe('home');
    home.scoring.goOffline(false);
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(home.navigation.current()).toBe('scoring'));
    expect(home.kv.entries.has(STORE_KEYS.code('scoring'))).toBe(true);
  });

  it('a port that throws is no connection, and the panel settles', async () => {
    const home = await renderHome();
    vi.spyOn(home.scoring, 'bootstrap').mockRejectedValue(new Error('module missing'));
    scanScoring(home);
    await screen.findByText('No connection');
    expect(screen.queryByText('Checking the link…')).toBeNull();
    expect(home.kv.entries.has(STORE_KEYS.code('scoring'))).toBe(false);
  });

  it('a dead link (401): the bad-link panel, nothing saved, and Scan again scans again', async () => {
    const home = await renderHome();
    home.scoring.revoke();
    scanScoring(home);
    await screen.findByText('Link not valid');
    expect(
      screen.getByText('This scoring link is not valid. Ask the organiser for a fresh link.'),
    ).toBeTruthy();
    expect(home.kv.entries.has(STORE_KEYS.code('scoring'))).toBe(false);
    expect(home.kv.entries.has(linkKey(FAKE_MATCH))).toBe(false);
    expect(home.navigation.current()).toBe('home');
    fireEvent.click(screen.getByRole('button', { name: 'Scan again' }));
    await waitFor(() => expect(home.scanner.scans).toBe(2));
  });

  it('a busy door (429): says so and keeps nothing', async () => {
    const home = await renderHome();
    home.scoring.rateLimit(7000);
    scanScoring(home);
    await screen.findByText('Server busy');
    expect(screen.getByText('Busy — trying again in 7s')).toBeTruthy();
    expect(home.kv.entries.has(STORE_KEYS.code('scoring'))).toBe(false);
  });

  it('a link on another host is refused as before and never asked about', async () => {
    const home = await renderHome();
    const bootstrap = vi.spyOn(home.scoring, 'bootstrap');
    scanScoring(home, `https://evil.example/score/${TOKEN}`);
    await screen.findByText("This isn't a Seazn code.");
    expect(bootstrap).not.toHaveBeenCalled();
    expect(home.kv.entries.has(STORE_KEYS.code('scoring'))).toBe(false);
  });

  it('a stream code scanned from the scoring tile offers Live Stream and asks the scoring server nothing', async () => {
    const home = await renderHome();
    const bootstrap = vi.spyOn(home.scoring, 'bootstrap');
    home.scanner.queue({
      outcome: 'scanned',
      raw: captureRaw({ exp: epochSeconds(IN_TWO_HOURS), slot: 1 }),
    });
    fireEvent.click(scoringTile());
    await screen.findByText('This is a Live Stream code');
    expect(screen.getByRole('button', { name: 'Open Live Stream' })).toBeTruthy();
    expect(bootstrap).not.toHaveBeenCalled();
  });
});

describe('a scoring link opened twice, or over another match', () => {
  async function homeHook(options?: Parameters<typeof createFakePorts>[0]) {
    const fakes = createFakePorts(options);
    const hook = renderHook(() => useHome(), { wrapper: wrapperFor(fakes) });
    await act(() => fakes.ports.modeStore.load());
    return { ...fakes, hook };
  }
  const code = { mode: 'scoring', raw: RAW, token: TOKEN } as const;

  it('the same link opened twice in one moment is checked once and saved once', async () => {
    const home = await homeHook();
    const bootstrap = vi.spyOn(home.scoring, 'bootstrap');
    const set = vi.spyOn(home.kv, 'set');
    act(() => {
      home.hook.result.current.actions.openFromPanel(code);
      home.hook.result.current.actions.openFromPanel(code);
    });
    await waitFor(() => expect(home.navigation.current()).toBe('scoring'));
    await act(async () => undefined);
    expect(bootstrap).toHaveBeenCalledTimes(1);
    expect(set.mock.calls.filter(([key]) => key === STORE_KEYS.code('scoring'))).toHaveLength(1);
  });

  it('a link opened again after it settled is checked again: the guard lets go', async () => {
    const home = await homeHook();
    const bootstrap = vi.spyOn(home.scoring, 'bootstrap');
    act(() => home.hook.result.current.actions.openFromPanel(code));
    await waitFor(() => expect(home.navigation.current()).toBe('scoring'));
    await act(async () => undefined);
    act(() => home.hook.result.current.actions.openFromPanel(code));
    await waitFor(() => expect(bootstrap).toHaveBeenCalledTimes(2));
  });

  it('a failed check lets the next one run', async () => {
    const home = await homeHook();
    home.scoring.goOffline(true);
    act(() => home.hook.result.current.actions.openFromPanel(code));
    await waitFor(() => expect(home.hook.result.current.view.panel?.kind).toBe('codeError'));
    home.scoring.goOffline(false);
    act(() => home.hook.result.current.actions.openFromPanel(code));
    await waitFor(() => expect(home.navigation.current()).toBe('scoring'));
  });

  it('saves nothing before the store has loaded (R12), and asks nothing', async () => {
    const fakes = createFakePorts();
    const bootstrap = vi.spyOn(fakes.scoring, 'bootstrap');
    const hook = renderHook(() => useHome(), { wrapper: wrapperFor(fakes) });
    act(() => hook.result.current.actions.openFromPanel(code));
    await act(async () => undefined);
    expect(bootstrap).not.toHaveBeenCalled();
    expect(fakes.kv.entries.size).toBe(0);
    expect(fakes.navigation.current()).toBe('home');
  });

  it('another match replaces the saved scoring code; the old match’s taps stay queued, with their link', async () => {
    const fakes = createFakePorts({ scoring: createFakeScoringPort(DOUBLES_SEED) });
    await leave(fakes, queueHolding(FAKE_MATCH, 3, { label: FAKE_LABEL }));
    await fakes.kv.set(STORE_KEYS.code('scoring'), savedMatch(FAKE_MATCH, FAKE_LABEL));
    await fakes.kv.set(STORE_KEYS.active, 'scoring');
    const hook = renderHook(() => useHome(), { wrapper: wrapperFor(fakes) });
    await act(() => fakes.ports.modeStore.load());
    act(() => hook.result.current.actions.openFromPanel(code));
    await waitFor(() => expect(fakes.navigation.current()).toBe('scoring'));
    const saved = decodeSavedCode(fakes.kv.entries.get(STORE_KEYS.code('scoring')) ?? '');
    expect(saved?.scoring?.fixtureId).toBe('fake-doubles');
    expect((await fakes.tapQueue.load(FAKE_MATCH))?.pending).toHaveLength(3);
    expect(fakes.kv.entries.has(linkKey(FAKE_MATCH))).toBe(true);
    expect(fakes.kv.entries.has(linkKey('fake-doubles'))).toBe(true);
  });

  it('another match over one with nothing unsent lets the old match go: its link and files', async () => {
    const fakes = createFakePorts({ scoring: createFakeScoringPort(DOUBLES_SEED) });
    await leave(fakes, queueHolding(FAKE_MATCH, 0, { label: FAKE_LABEL }));
    await fakes.kv.set(STORE_KEYS.code('scoring'), savedMatch(FAKE_MATCH, FAKE_LABEL));
    const hook = renderHook(() => useHome(), { wrapper: wrapperFor(fakes) });
    await act(() => fakes.ports.modeStore.load());
    act(() => hook.result.current.actions.openFromPanel(code));
    await waitFor(() => expect(fakes.kv.entries.has(linkKey('fake-doubles'))).toBe(true));
    await waitFor(() => expect(fakes.kv.entries.has(linkKey(FAKE_MATCH))).toBe(false));
    expect(await fakes.tapQueue.load(FAKE_MATCH)).toBeNull();
  });

  it('the same match scanned again keeps its queue and replaces its link', async () => {
    const fakes = createFakePorts();
    await leave(fakes, queueHolding(FAKE_MATCH, 2, { label: FAKE_LABEL }), {
      origin: 'https://stg.seazn.club',
      token: 'dl_theOldTokenForHomeTests',
    });
    const hook = renderHook(() => useHome(), { wrapper: wrapperFor(fakes) });
    await act(() => fakes.ports.modeStore.load());
    act(() => hook.result.current.actions.openFromPanel(code));
    await waitFor(() => expect(fakes.navigation.current()).toBe('scoring'));
    await act(async () => undefined);
    expect(JSON.parse(fakes.kv.entries.get(linkKey(FAKE_MATCH)) ?? 'null')).toEqual({
      ...LINK,
      sportKey: 'badminton',
    });
    expect((await fakes.tapQueue.load(FAKE_MATCH))?.pending).toHaveLength(2);
  });

  it('a queue dead on its link comes back to life when a fresh link for the match is scanned', async () => {
    const fakes = createFakePorts();
    await leave(fakes, queueHolding(FAKE_MATCH, 2, { dead: 'LINK_REVOKED' }));
    const hook = renderHook(() => useHome(), { wrapper: wrapperFor(fakes) });
    await act(() => fakes.ports.modeStore.load());
    act(() => hook.result.current.actions.openFromPanel(code));
    await waitFor(() => expect(fakes.navigation.current()).toBe('scoring'));
    await act(async () => undefined);
    const revived = await fakes.tapQueue.load(FAKE_MATCH);
    expect(revived?.dead).toBeNull();
    expect(revived?.pending).toHaveLength(2);
  });

  it('a queue dead for another reason (the match is final) stays dead: a new link does not reopen it', async () => {
    const fakes = createFakePorts();
    await leave(fakes, queueHolding(FAKE_MATCH, 2, { dead: 'finalized' }));
    const hook = renderHook(() => useHome(), { wrapper: wrapperFor(fakes) });
    await act(() => fakes.ports.modeStore.load());
    act(() => hook.result.current.actions.openFromPanel(code));
    await waitFor(() => expect(fakes.navigation.current()).toBe('scoring'));
    await act(async () => undefined);
    expect((await fakes.tapQueue.load(FAKE_MATCH))?.dead).toBe('finalized');
  });
});

describe('which match is let go when another is scanned', () => {
  const code = { mode: 'scoring', raw: RAW, token: TOKEN } as const;
  const SETTLE = 12;

  /** Home over a phone that has `saved` as its saved match (code, link) and whatever `seed` leaves on the disk. */
  async function openOver(
    saved: string | null,
    seed: (fakes: ReturnType<typeof createFakePorts>) => Promise<void> = async () => undefined,
  ) {
    const fakes = createFakePorts({ scoring: createFakeScoringPort(DOUBLES_SEED) });
    if (saved !== null) {
      await fakes.kv.set(STORE_KEYS.code('scoring'), savedMatch(saved, FAKE_LABEL));
      await fakes.kv.set(STORE_KEYS.active, 'scoring');
    }
    await seed(fakes);
    const letGo = vi.spyOn(scoringHubOf(fakes.ports), 'leave');
    const hook = renderHook(() => useHome(), { wrapper: wrapperFor(fakes) });
    await act(() => fakes.ports.modeStore.load());
    act(() => hook.result.current.actions.openFromPanel(code));
    await waitFor(() => expect(fakes.navigation.current()).toBe('scoring'));
    for (let i = 0; i < SETTLE; i += 1) await act(async () => undefined);
    return { fakes, letGo };
  }

  it('the first match ever scanned lets nothing go', async () => {
    const { letGo } = await openOver(null);
    expect(letGo).not.toHaveBeenCalled();
  });

  it('the same match scanned again with nothing unsent is not "another match": its fresh link stays', async () => {
    const { fakes, letGo } = await openOver('fake-doubles', (f) =>
      leave(f, queueHolding('fake-doubles', 0), {
        origin: 'https://stg.seazn.club',
        token: 'dl_theOldTokenForHomeTests',
      }),
    );
    expect(letGo).not.toHaveBeenCalled();
    expect(JSON.parse(fakes.kv.entries.get(linkKey('fake-doubles')) ?? 'null')).toEqual({
      ...LINK,
      sportKey: 'badminton',
    });
  });

  it('an old match whose queue cannot be read is kept: its taps are the leftover Home shows', async () => {
    const { fakes, letGo } = await openOver(FAKE_MATCH, async (f) => {
      await leave(f, queueHolding(FAKE_MATCH, 1));
      f.queueFiles.files.set(`${FAKE_MATCH}.json`, '{ not json');
    });
    expect(letGo).not.toHaveBeenCalled();
    expect(fakes.kv.entries.has(linkKey(FAKE_MATCH))).toBe(true);
    // Kept on purpose, not by a read that failed and was recorded.
    expect(readRecord(fakes.record).map((line) => line.event)).not.toContain(
      'scoring.let-go-refused',
    );
  });

  it('an old match with no queue at all is let go even while a third match holds taps', async () => {
    const { fakes, letGo } = await openOver(FAKE_MATCH, async (f) => {
      await f.kv.set(linkKey(FAKE_MATCH), STORED_LINK);
      await leave(f, queueHolding('fx-third', 2, { label: 'Match 9' }));
    });
    expect(letGo).toHaveBeenCalledWith(FAKE_MATCH);
    expect(fakes.kv.entries.has(linkKey(FAKE_MATCH))).toBe(false);
    expect((await fakes.tapQueue.load('fx-third'))?.pending).toHaveLength(2);
  });
});

describe('a dead link scanned again', () => {
  it('offers Dismiss when the link is the one a queue of unsent taps is stuck on', async () => {
    const home = await renderHome();
    await leave(home, queueHolding(FAKE_MATCH, 3, { dead: 'LINK_REVOKED' }));
    home.scoring.revoke();
    scanScoring(home);
    await screen.findByText('Link not valid');
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    // Owner ruling B (2026-11-02): the panel's Dismiss asks first, as a card's does. Nothing is gone until it is answered.
    await screen.findByText('Dismiss Label of fake-singles?');
    expect(home.kv.entries.has(linkKey(FAKE_MATCH))).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    await waitFor(() => expect(home.kv.entries.has(linkKey(FAKE_MATCH))).toBe(false));
    expect(await home.tapQueue.load(FAKE_MATCH)).toBeNull();
    expect(screen.queryByText('Dismiss Label of fake-singles?')).toBeNull();
    expect(screen.queryByText('Link not valid')).toBeNull();
  });

  it('offers no Dismiss for a dead link no queue is stuck on', async () => {
    const home = await renderHome();
    await leave(home, queueHolding(FAKE_MATCH, 3, { dead: 'LINK_REVOKED' }), {
      origin: 'https://stg.seazn.club',
      token: 'dl_someOtherTokenForTests',
    });
    home.scoring.revoke();
    scanScoring(home);
    await screen.findByText('Link not valid');
    expect(screen.queryByRole('button', { name: 'Dismiss' })).toBeNull();
    expect((await home.tapQueue.load(FAKE_MATCH))?.pending).toHaveLength(3);
  });

  it('offers no Dismiss for a queue that is dead for another reason', async () => {
    const home = await renderHome();
    await leave(home, queueHolding(FAKE_MATCH, 3, { dead: 'finalized' }));
    home.scoring.revoke();
    scanScoring(home);
    await screen.findByText('Link not valid');
    expect(screen.queryByRole('button', { name: 'Dismiss' })).toBeNull();
  });

  it('a disk that cannot be listed leaves the bad-link panel with no Dismiss, never a crash', async () => {
    const home = await renderHome();
    await leave(home, queueHolding(FAKE_MATCH, 3, { dead: 'LINK_REVOKED' }));
    home.scoring.revoke();
    vi.spyOn(home.tapQueue, 'list').mockRejectedValue(new Error('disk gone'));
    scanScoring(home);
    await screen.findByText('Link not valid');
    expect(screen.queryByRole('button', { name: 'Dismiss' })).toBeNull();
  });

  it('is asked only after a dead link: an offline scan of the same link offers no Dismiss', async () => {
    const home = await renderHome();
    await leave(home, queueHolding(FAKE_MATCH, 3, { dead: 'LINK_REVOKED' }));
    home.scoring.goOffline(true);
    scanScoring(home);
    await screen.findByText('No connection');
    expect(screen.queryByRole('button', { name: 'Dismiss' })).toBeNull();
  });
});

describe('refused writes at the scan', () => {
  it('a link the phone will not keep opens nothing and says so; no code is saved', async () => {
    const memory = createMemoryKeyValueStore();
    const kv = {
      ...memory,
      set: (key: string, value: string) =>
        key === linkKey(FAKE_MATCH)
          ? Promise.reject(new Error('keystore locked'))
          : memory.set(key, value),
    };
    const home = await renderHome({ kv, modeStore: createModeStore(kv) });
    scanScoring(home);
    await screen.findByText("Couldn't save on this phone. Try again.");
    expect(home.navigation.current()).toBe('home');
    expect(memory.entries.has(STORE_KEYS.code('scoring'))).toBe(false);
  });

  it('a code the phone will not keep opens nothing and says so', async () => {
    const memory = createMemoryKeyValueStore();
    const kv = {
      ...memory,
      set: (key: string, value: string) =>
        key === STORE_KEYS.code('scoring')
          ? Promise.reject(new Error('keystore locked'))
          : memory.set(key, value),
    };
    const home = await renderHome({ kv, modeStore: createModeStore(kv) });
    scanScoring(home);
    await screen.findByText("Couldn't save on this phone. Try again.");
    expect(home.navigation.current()).toBe('home');
    expect(memory.entries.get(STORE_KEYS.active)).toBeUndefined();
  });

  /** A phone whose store takes the link but refuses the code that would name its match. */
  function refusingTheCode(seed: Record<string, string> = {}) {
    const memory = createMemoryKeyValueStore(seed);
    const kv = {
      ...memory,
      set: (key: string, value: string) =>
        key === STORE_KEYS.code('scoring')
          ? Promise.reject(new Error('keystore locked'))
          : memory.set(key, value),
    };
    return { memory, kv };
  }

  it('a code refused after the link was kept takes the link away again: no token is left with no code', async () => {
    const { memory, kv } = refusingTheCode();
    const home = await renderHome({ kv, modeStore: createModeStore(kv) });
    scanScoring(home);
    await screen.findByText("Couldn't save on this phone. Try again.");
    await waitFor(() => expect(memory.entries.has(linkKey(FAKE_MATCH))).toBe(false));
  });

  it('a code refused over a match that already had a link leaves that match a link', async () => {
    const { memory, kv } = refusingTheCode({
      [linkKey(FAKE_MATCH)]: JSON.stringify({
        origin: LINK.origin,
        token: 'dl_theOldTokenForHomeTests',
        sportKey: 'badminton',
      }),
    });
    const home = await renderHome({ kv, modeStore: createModeStore(kv) });
    scanScoring(home);
    await screen.findByText("Couldn't save on this phone. Try again.");
    await act(async () => undefined);
    expect(memory.entries.has(linkKey(FAKE_MATCH))).toBe(true);
  });

  it('a queue the disk will not read after the link was kept takes the link away again, and the refusal is said', async () => {
    const memory = createMemoryKeyValueStore();
    const home = await renderHome({ kv: memory, modeStore: createModeStore(memory) });
    await leave(home, queueHolding(FAKE_MATCH, 0), null);
    const load = home.ports.tapQueue.load.bind(home.ports.tapQueue);
    vi.spyOn(home.ports.tapQueue, 'load').mockImplementation((id) =>
      memory.entries.has(linkKey(id)) ? Promise.reject(new Error('disk gone')) : load(id),
    );
    scanScoring(home);
    await screen.findByText("Couldn't save on this phone. Try again.");
    await waitFor(() => expect(memory.entries.has(linkKey(FAKE_MATCH))).toBe(false));
    expect(memory.entries.has(STORE_KEYS.code('scoring'))).toBe(false);
    expect(home.navigation.current()).toBe('home');
    // The scan's hold on its match is let go with the refusal: a sweep may take what is left of the match now.
    await scoringHubOf(home.ports).resume();
    expect(await home.tapQueue.load(FAKE_MATCH)).toBeNull();
  });

  it('a sweep that lands between the link and the code does not take the link: the scan holds its match until the code is in', async () => {
    const home = await renderHome();
    await leave(home, queueHolding(FAKE_MATCH, 0), null);
    // The code's write is held, so the link is on the disk and the match is not yet the saved one.
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => (release = resolve));
    const set = home.kv.set;
    vi.spyOn(home.kv, 'set').mockImplementation(async (key, value) => {
      if (key === STORE_KEYS.code('scoring')) await held;
      return set(key, value);
    });
    scanScoring(home);
    await waitFor(() => expect(home.kv.entries.has(linkKey(FAKE_MATCH))).toBe(true));
    await scoringHubOf(home.ports).resume();
    expect(home.kv.entries.has(linkKey(FAKE_MATCH))).toBe(true);
    release();
    await waitFor(() => expect(home.navigation.current()).toBe('scoring'));
    expect(home.kv.entries.has(linkKey(FAKE_MATCH))).toBe(true);
    // The claim is let go once the code is in: the match is the saved one now, and a sweep leaves it for that reason.
    await scoringHubOf(home.ports).resume();
    expect(home.kv.entries.has(linkKey(FAKE_MATCH))).toBe(true);
  });

  it('a scan whose code is refused lets go of its match: a later sweep takes what is left of it', async () => {
    const { memory, kv } = refusingTheCode();
    const home = await renderHome({ kv, modeStore: createModeStore(kv) });
    await leave(home, queueHolding(FAKE_MATCH, 0), null);
    scanScoring(home);
    await screen.findByText("Couldn't save on this phone. Try again.");
    await waitFor(() => expect(memory.entries.has(linkKey(FAKE_MATCH))).toBe(false));
    // The empty queue file stays until a sweep, which is allowed now: nothing holds the match.
    await scoringHubOf(home.ports).resume();
    expect(await home.tapQueue.load(FAKE_MATCH)).toBeNull();
  });

  it('a link that cannot be taken away again is no more than a recorded line: the refusal is still said', async () => {
    const { memory, kv } = refusingTheCode();
    const home = await renderHome({
      kv: { ...kv, delete: () => Promise.reject(new Error('keystore locked')) },
      modeStore: createModeStore(kv),
    });
    scanScoring(home);
    await screen.findByText("Couldn't save on this phone. Try again.");
    await waitFor(() =>
      expect(readRecord(home.record).map((line) => line.event)).toContain(
        'scoring.orphan-link-kept',
      ),
    );
    expect(memory.entries.has(linkKey(FAKE_MATCH))).toBe(true);
  });
});

describe('the words, in every language', () => {
  it.each([
    ['en', 'Remote Scoring', 'Checking the link…', 'Link not valid'],
    ['es', 'Anotación remota', 'Comprobando el enlace…', 'Enlace no válido'],
    ['fr', 'Score à distance', 'Vérification du lien…', 'Lien non valide'],
    ['nl', 'Scoren op afstand', 'Link controleren…', 'Link ongeldig'],
  ])(
    '%s: the tile scans, the check shows, a dead link is named',
    async (lang, tile, checking, dead) => {
      const home = await renderHome({ deviceLanguages: [lang] });
      home.scoring.revoke();
      let release: () => void = () => undefined;
      const held = new Promise<void>((resolve) => (release = resolve));
      const bootstrap = home.scoring.bootstrap;
      vi.spyOn(home.scoring, 'bootstrap').mockImplementation(async (link) => {
        await held;
        return bootstrap(link);
      });
      home.scanner.queue({ outcome: 'scanned', raw: RAW });
      fireEvent.click(screen.getByRole('button', { name: new RegExp(tile) }));
      await screen.findByText(checking);
      release();
      await screen.findByText(dead);
    },
  );
});
