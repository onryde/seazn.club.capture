import { act, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { encodeSavedCode, type SavedCode } from '@/domain/mode/savedCode';
import { STORE_KEYS } from '@/services/modeStore';
import { TEST_NOW } from '../../../test/fakePorts';
import { savedStreamCode } from '../../../test/fixtures/savedStream';
import { pairCode } from '../../../test/pairCode';
import {
  FAKE_LABEL,
  FAKE_MATCH,
  LINK,
  STORED_LINK,
  RAW,
  leave,
  linkKey,
  queueHolding,
} from '../../../test/scoringHomeFixtures';
import { backgroundAndBack, flush, launchApp } from '../../../test/routedApp';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

const match = (): SavedCode => ({
  mode: 'scoring',
  raw: '',
  slot: null,
  savedAt: TEST_NOW,
  expiresAt: null,
  stream: null,
  scoring: { fixtureId: FAKE_MATCH, label: FAKE_LABEL },
});
const inMatch = {
  [STORE_KEYS.active]: 'scoring',
  [STORE_KEYS.code('scoring')]: encodeSavedCode(match()),
  [linkKey(FAKE_MATCH)]: STORED_LINK,
};

const scoringTile = () => screen.getByRole('button', { name: /Remote Scoring/ });
const matchScreen = () => screen.queryByTestId('pad-content');

/**
 * Remote Scoring in the app as the root layout composes it (plan S2-1 Task 10; design §4 step 1): a scan opens the
 * match on /scoring, a cold start reopens it, Back goes Home freely (ruling 10), and a foreground leaves the scorer
 * where they are. The match is drawn by its sport's own pad (Task 11): `pad-content` is the badminton pad's root.
 */
describe('Remote Scoring, routed', () => {
  it('a scan from the tile opens the match on /scoring', async () => {
    const app = await launchApp();
    app.scanner.queue({ outcome: 'scanned', raw: RAW });
    act(() => scoringTile().click());
    await flush(200);
    expect(app.nav.current()).toBe('scoring');
    expect(matchScreen()).not.toBeNull();
    expect(app.nav.history).toEqual(['scoring']);
  });

  it('a cold start with the match saved and the mode active reopens into the match', async () => {
    const app = await launchApp({ kvSeed: inMatch });
    expect(app.nav.current()).toBe('scoring');
    expect(matchScreen()).not.toBeNull();
    expect(app.splash.hides).toBe(1);
  });

  it('a cold start with the match saved but another mode last stays Home', async () => {
    const app = await launchApp({ kvSeed: { ...inMatch, [STORE_KEYS.active]: 'stream' } });
    expect(app.nav.current()).toBe('home');
  });

  it('a cold start with no mode active stays Home, though a match is saved', async () => {
    const seed: Record<string, string> = { ...inMatch };
    delete seed[STORE_KEYS.active];
    const app = await launchApp({ kvSeed: seed });
    expect(app.nav.current()).toBe('home');
  });

  it('a cold start with the match saved and no link behind it still opens the pad route (the pad says the link is gone)', async () => {
    const seed: Record<string, string> = { ...inMatch };
    delete seed[linkKey(FAKE_MATCH)];
    const app = await launchApp({ kvSeed: seed });
    expect(app.nav.current()).toBe('scoring');
  });

  it('a held or paired broadcast outranks the match at a cold start', async () => {
    const stream = savedStreamCode();
    const app = await launchApp({
      kvSeed: { ...inMatch, [STORE_KEYS.code('stream')]: encodeSavedCode(stream) },
      prepare: (fakes) => pairCode(fakes.engine, stream),
    });
    expect(app.nav.current()).toBe('stream');
  });

  it('a return to the foreground stays on the pad', async () => {
    const app = await launchApp({ kvSeed: inMatch });
    await backgroundAndBack(app);
    expect(app.nav.current()).toBe('scoring');
    expect(matchScreen()).not.toBeNull();
  });

  it('Back goes Home, and a return to the foreground there does not pull the scorer back in', async () => {
    const app = await launchApp({ kvSeed: inMatch });
    let handled = false;
    act(() => {
      handled = app.back.press();
    });
    await flush();
    expect(handled).toBe(true);
    expect(app.nav.current()).toBe('home');
    await backgroundAndBack(app);
    expect(app.nav.current()).toBe('home');
  });

  it('a broadcast started remotely moves the phone to Live Stream from the pad (A2)', async () => {
    const app = await launchApp({
      kvSeed: inMatch,
      prepare: (fakes) => fakes.engine.scene('paired-ready'),
    });
    // The paired engine had the cold start; the scorer then goes to the pad by hand.
    act(() => app.ports.navigation.go('scoring'));
    await flush();
    expect(app.nav.current()).toBe('scoring');
    act(() => app.engine.scene('live'));
    await flush();
    expect(app.nav.current()).toBe('stream');
  });
});

/**
 * The route with no match saved goes Home through the navigation port (the Batch D review): a bare `<Redirect>` moved the
 * router behind the port's back, so the port still said `scoring`, and its next `go('scoring')` was taken for a move
 * to where it already was and did nothing.
 */
describe('the Remote Scoring route with no match saved', () => {
  it('goes Home with one move, and the port knows it is Home', async () => {
    const app = await launchApp();
    const go = vi.spyOn(app.ports.navigation, 'go');
    act(() => app.ports.navigation.go('scoring'));
    await flush();
    expect(app.nav.current()).toBe('home');
    expect(app.ports.navigation.current()).toBe('home');
    expect(app.nav.history).toEqual(['scoring', 'home']);
    expect(go.mock.calls).toEqual([['scoring'], ['home']]);
    expect(matchScreen()).toBeNull();
  });

  it('a go(scoring) after a match is saved opens the pad: the earlier trip Home did not leave the port believing it was on the route', async () => {
    const app = await launchApp();
    act(() => app.ports.navigation.go('scoring'));
    await flush();
    expect(app.nav.current()).toBe('home');
    app.scanner.queue({ outcome: 'scanned', raw: RAW });
    act(() => scoringTile().click());
    await flush(200);
    expect(app.nav.current()).toBe('scoring');
    expect(matchScreen()).not.toBeNull();
    expect(app.nav.history).toEqual(['scoring', 'home', 'scoring']);
  });

  it('moves the router once: a return to the foreground at Home moves nothing more', async () => {
    const app = await launchApp();
    act(() => app.ports.navigation.go('scoring'));
    await flush();
    await backgroundAndBack(app);
    await flush(200);
    expect(app.nav.history).toEqual(['scoring', 'home']);
  });
});

describe('the background sender, mounted at the root', () => {
  it('sends the taps a match left queued at launch, with nobody looking at the match', async () => {
    const app = await launchApp({
      kvSeed: { [linkKey(FAKE_MATCH)]: STORED_LINK },
      seed: (fakes) => leave(fakes, queueHolding(FAKE_MATCH, 2, { label: FAKE_LABEL }), null),
    });
    await flush(2000);
    expect(app.nav.current()).toBe('home');
    // Sent, and a match nobody has saved leaves nothing behind it: no queue file and no link.
    expect(await app.ports.tapQueue.load(FAKE_MATCH)).toBeNull();
    expect(app.kv.entries.has(linkKey(FAKE_MATCH))).toBe(false);
  });

  it('looks again at every return to the foreground', async () => {
    const app = await launchApp({ kvSeed: { [linkKey(FAKE_MATCH)]: STORED_LINK } });
    await leave(app, queueHolding(FAKE_MATCH, 2, { label: FAKE_LABEL }), null);
    await backgroundAndBack(app);
    await flush(2000);
    expect(await app.ports.tapQueue.load(FAKE_MATCH)).toBeNull();
  });
});
