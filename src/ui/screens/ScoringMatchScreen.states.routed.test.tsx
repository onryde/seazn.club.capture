import { act, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { encodeSavedCode, type SavedCode } from '@/domain/mode/savedCode';
import { STORE_URL } from '@/hooks/useScoringMatch';
import en from '@/i18n/en.json';
import es from '@/i18n/es.json';
import fr from '@/i18n/fr.json';
import nl from '@/i18n/nl.json';
import { STORE_KEYS } from '@/services/modeStore';
import { SINGLES, ledgerOf, rally } from '../../../test/badmintonLedger';
import { TEST_NOW, type FakePorts } from '../../../test/fakePorts';
import {
  FAKE_LABEL,
  FAKE_MATCH,
  LINK,
  STORED_LINK,
  leave,
  linkKey,
  queueHolding,
} from '../../../test/scoringHomeFixtures';
import { screenIsHeld, type HoldLog } from '../../../test/heldScreen';
import { backgroundAndBack, flush, launchApp, type LaunchedApp } from '../../../test/routedApp';

const holds = vi.hoisted((): HoldLog => []);
vi.mock('@/hooks/keepAwake', async () => {
  const { recordingHold } = await import('../../../test/heldScreen');
  return { holdScreenOn: recordingHold(holds) };
});

beforeEach(() => {
  vi.useFakeTimers();
  holds.length = 0;
});
afterEach(() => vi.useRealTimers());

// Plan S2-1 Task 11 (design §4 step 3, §8): every state of a scoring match that is not the pad, on the route the phone
// opens it by: drawn in words with the way out it has, never a blank. The fake server stands in for Seazn, and the
// real runner, hub, queue and reducer run under it. Each state is reached the way a phone reaches it.

const saved: SavedCode = {
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
  [STORE_KEYS.code('scoring')]: encodeSavedCode(saved),
  [linkKey(FAKE_MATCH)]: STORED_LINK,
};

type Patch = Record<string, unknown>;

/** The bootstrap the fake server answers, with these fields changed: a match that is the way a test needs it. */
function patchBootstrap(fakes: FakePorts, patch: Patch): void {
  const real = fakes.scoring.bootstrap.bind(fakes.scoring);
  vi.spyOn(fakes.scoring, 'bootstrap').mockImplementation(async (...args) => {
    const answer = await real(...args);
    return answer.kind === 'ok'
      ? { ...answer, bootstrap: { ...answer.bootstrap, ...patch } }
      : answer;
  });
}

const card = () => screen.getByTestId('scoring-state-card');
const title = () => within(card()).getByRole('heading').textContent;
const buttons = () =>
  within(card())
    .queryAllByRole('button')
    .map((b) => b.textContent);

async function opened(over: Parameters<typeof launchApp>[0] = {}): Promise<LaunchedApp> {
  const app = await launchApp({ kvSeed: IN_MATCH, ...over });
  await flush(200);
  return app;
}

describe('waiting', () => {
  it('says it is opening the match while the first read is on its way, with no button', async () => {
    const app = await opened({
      prepare: (fakes) => {
        vi.spyOn(fakes.scoring, 'bootstrap').mockReturnValue(new Promise(() => undefined));
      },
    });
    expect(app.nav.current()).toBe('scoring');
    expect(title()).toBe(en['scoring.state.loading.title']);
    expect(buttons()).toEqual([]);
  });

  it('says there is no connection when nothing is cached, then opens the pad by itself once there is', async () => {
    const app = await opened({ prepare: (fakes) => fakes.scoring.goOffline(true) });
    expect(title()).toBe(en['scoring.state.offline.title']);
    expect(screen.getByText(en['scoring.state.offline.body'])).toBeTruthy();
    expect(buttons()).toEqual([]);
    app.scoring.goOffline(false);
    await flush(16_000);
    expect(screen.queryByTestId('scoring-state-card')).toBeNull();
    expect(screen.getByTestId('start-screen')).toBeTruthy();
  });

  it('opens by itself on a return to the foreground too', async () => {
    const app = await opened({ prepare: (fakes) => fakes.scoring.goOffline(true) });
    app.scoring.goOffline(false);
    await backgroundAndBack(app);
    await flush(1_000);
    expect(screen.getByTestId('start-screen')).toBeTruthy();
  });
});

describe('a link that is gone', () => {
  it('says so when no link is saved, and Dismiss lets the match go and goes Home', async () => {
    const seed: Record<string, string> = { ...IN_MATCH };
    delete seed[linkKey(FAKE_MATCH)];
    const app = await opened({ kvSeed: seed });
    expect(title()).toBe(en['scoring.state.linkGone.title']);
    expect(buttons()).toEqual([en['home.scoring.dismiss']]);
    act(() => within(card()).getByRole('button', { name: en['home.scoring.dismiss'] }).click());
    await flush(200);
    expect(app.nav.current()).toBe('home');
    expect(app.kv.entries.has(STORE_KEYS.code('scoring'))).toBe(false);
  });

  it('says so when the organiser revoked the link and nothing of the match is kept', async () => {
    await opened({ prepare: (fakes) => fakes.scoring.revoke() });
    expect(title()).toBe(en['scoring.state.linkGone.title']);
  });

  it('asks before it discards the taps a dead link left, and Keep leaves them', async () => {
    const app = await opened({
      prepare: (fakes) => fakes.scoring.revoke(),
      seed: (fakes) => leave(fakes, queueHolding(FAKE_MATCH, 2, { label: FAKE_LABEL }), null),
    });
    expect(title()).toBe(en['scoring.state.linkGone.title']);
    act(() => within(card()).getByRole('button', { name: en['home.scoring.dismiss'] }).click());
    await flush(200);
    expect(screen.getByText(`Dismiss ${FAKE_LABEL}?`)).toBeTruthy();
    act(() => screen.getByRole('button', { name: en['home.scoring.confirm.keep'] }).click());
    await flush(200);
    expect(app.nav.current()).toBe('scoring');
    expect(await app.tapQueue.load(FAKE_MATCH)).not.toBeNull();
  });
});

describe('what the phone cannot read', () => {
  it('a queue file it cannot read: told to the organiser, with Dismiss', async () => {
    await opened({
      prepare: (fakes) => fakes.queueFiles.files.set(`${FAKE_MATCH}.json`, '{ not json'),
    });
    expect(title()).toBe(en['scoring.state.unreadableQueue.title']);
    expect(buttons()).toEqual([en['home.scoring.dismiss']]);
  });

  it('a secure store that does not answer: says so, with no Dismiss that would delete a link it cannot see', async () => {
    await opened({
      prepare: (fakes) => {
        const get = fakes.kv.get.bind(fakes.kv);
        vi.spyOn(fakes.kv, 'get').mockImplementation(async (key) => {
          if (key === linkKey(FAKE_MATCH)) throw new Error('the store did not answer');
          return get(key);
        });
      },
    });
    expect(title()).toBe(en['scoring.state.unreadableLink.title']);
    expect(buttons()).toEqual([]);
  });
});

describe('a match the phone cannot score', () => {
  it('another sport: named, with the browser', async () => {
    const app = await opened({
      kvSeed: {
        ...IN_MATCH,
        [linkKey(FAKE_MATCH)]: JSON.stringify({ ...LINK, sportKey: 'tennis' }),
      },
    });
    expect(title()).toBe(en['scoring.state.unsupported.title']);
    expect(screen.getByText('Sport: tennis')).toBeTruthy();
    expect(buttons()).toEqual([en['scoring.card.updateNeeded.browser']]);
    act(() => within(card()).getByRole('button').click());
    await flush(100);
    expect(app.link.opened).toEqual([`https://stg.seazn.club/score/${LINK.token}`]);
  });

  it('a ledger over the cap: told, with the browser', async () => {
    await opened({
      prepare: (fakes) => {
        vi.spyOn(fakes.scoring, 'events').mockResolvedValue({ kind: 'tooLarge' });
      },
    });
    expect(title()).toBe(en['scoring.state.tooLarge.title']);
    expect(buttons()).toEqual([en['scoring.card.updateNeeded.browser']]);
  });

  it.each([
    ['a seat with no entrant', { sides: { ...SINGLES.sides, away: null } }, 'sides', []],
    ['rules the engine refuses', { cfg: { bestOf: 'many' } }, 'cfg', ['browser']],
  ] as const)('%s: told why', async (_name, patch, reason, extra) => {
    await opened({ prepare: (fakes) => patchBootstrap(fakes, patch) });
    expect(title()).toBe(en[`scoring.state.${reason}.title`]);
    expect(buttons()).toEqual(extra.map(() => en['scoring.card.updateNeeded.browser']));
  });

  it('a record the engine refuses: told, with the browser', async () => {
    await opened({
      prepare: (fakes) => {
        vi.spyOn(fakes.scoring, 'events').mockResolvedValue(ledgerOf([rally('H')]));
      },
    });
    expect(title()).toBe(en['scoring.state.ledger.title']);
    expect(buttons()).toEqual([en['scoring.card.updateNeeded.browser']]);
  });

  it('an app too old to read the match: Update first, the browser beside it, and the taps still unsent', async () => {
    const app = await opened({
      prepare: (fakes) => patchBootstrap(fakes, { cfg: { bestOf: 'many' }, epochRequired: 99 }),
      seed: (fakes) => leave(fakes, queueHolding(FAKE_MATCH, 2, { label: FAKE_LABEL }), null),
    });
    expect(title()).toBe(en['scoring.state.outdated.title']);
    expect(screen.getByText('2 taps not sent yet. They send after the update.')).toBeTruthy();
    expect(buttons()).toEqual([
      en['scoring.card.updateNeeded.update'],
      en['scoring.card.updateNeeded.browser'],
    ]);
    act(() => screen.getByRole('button', { name: en['scoring.card.updateNeeded.update'] }).click());
    await flush(100);
    expect(app.link.opened).toEqual([STORE_URL]);
  });
});

describe('Home from a state', () => {
  it('Back goes Home and the phone’s Back does too, whatever the state', async () => {
    const app = await opened({ prepare: (fakes) => fakes.scoring.goOffline(true) });
    let handled = false;
    act(() => {
      handled = app.back.press();
    });
    await flush();
    expect(handled).toBe(true);
    expect(app.nav.current()).toBe('home');
  });

  it('a state is read in the phone’s language', async () => {
    await opened({ deviceLanguages: ['fr'], prepare: (fakes) => fakes.scoring.goOffline(true) });
    expect(title()).toBe(fr['scoring.state.offline.title']);
  });
});

describe.each([
  ['es', es],
  ['fr', fr],
  ['nl', nl],
] as const)('in %s', (lang, words) => {
  it('draws a state in the phone’s language, buttons included', async () => {
    await opened({
      deviceLanguages: [lang],
      prepare: (fakes) => patchBootstrap(fakes, { cfg: { bestOf: 'many' }, epochRequired: 99 }),
    });
    expect(title()).toBe(words['scoring.state.outdated.title']);
    expect(buttons()).toEqual([
      words['scoring.card.updateNeeded.update'],
      words['scoring.card.updateNeeded.browser'],
    ]);
  });
});

/**
 * Owner ruling 9 (2026-10-31: the screen stays on while the pad shows), as the controller applied it on 2026-11-02: the
 * scorer waiting to score (the match opening, or no connection yet) keeps the screen on, as the pad does; a state that
 * needs a person to act (a link gone, a file the phone cannot read, a sport or an app it cannot score) lets the screen
 * sleep, since nothing on it will change by itself. Whether the phone's screen really stays lit is the device check's.
 */
describe('keeping the screen on', () => {
  const held = () => screenIsHeld(holds);

  it('offline holds it, and Back lets it go', async () => {
    const app = await opened({ prepare: (fakes) => fakes.scoring.goOffline(true) });
    expect(title()).toBe(en['scoring.state.offline.title']);
    expect(held()).toBe(true);
    act(() => {
      app.back.press();
    });
    await flush();
    expect(held()).toBe(false);
  });

  it('the match opening holds it', async () => {
    await opened({
      prepare: (fakes) => {
        vi.spyOn(fakes.scoring, 'bootstrap').mockReturnValue(new Promise(() => undefined));
      },
    });
    expect(title()).toBe(en['scoring.state.loading.title']);
    expect(held()).toBe(true);
  });

  it('a link that is gone does not hold it', async () => {
    const seed: Record<string, string> = { ...IN_MATCH };
    delete seed[linkKey(FAKE_MATCH)];
    await opened({ kvSeed: seed });
    expect(title()).toBe(en['scoring.state.linkGone.title']);
    expect(held()).toBe(false);
  });

  it.each([
    ['a queue the phone cannot read', 'unreadableQueue'],
    ['another sport', 'unsupported'],
    ['a ledger over the cap', 'tooLarge'],
    ['a seat with no entrant', 'sides'],
    ['an app too old', 'outdated'],
  ] as const)('%s does not hold it', async (_name, key) => {
    await opened({
      kvSeed:
        key === 'unsupported'
          ? { ...IN_MATCH, [linkKey(FAKE_MATCH)]: JSON.stringify({ ...LINK, sportKey: 'tennis' }) }
          : IN_MATCH,
      prepare: (fakes) => {
        if (key === 'unreadableQueue')
          fakes.queueFiles.files.set(`${FAKE_MATCH}.json`, '{ not json');
        if (key === 'tooLarge')
          vi.spyOn(fakes.scoring, 'events').mockResolvedValue({ kind: 'tooLarge' });
        if (key === 'sides') patchBootstrap(fakes, { sides: { ...SINGLES.sides, away: null } });
        if (key === 'outdated')
          patchBootstrap(fakes, { cfg: { bestOf: 'many' }, epochRequired: 99 });
      },
    });
    expect(title()).toBe(en[`scoring.state.${key}.title`]);
    expect(held()).toBe(false);
  });

  it('a wait that ends in the pad is held through the wait and held on the pad', async () => {
    const app = await opened({ prepare: (fakes) => fakes.scoring.goOffline(true) });
    expect(held()).toBe(true);
    app.scoring.goOffline(false);
    await flush(16_000);
    expect(screen.getByTestId('start-screen')).toBeTruthy();
    expect(held()).toBe(true);
  });

  it('a wait that ends in a state that needs a person lets the screen go', async () => {
    const app = await opened({ prepare: (fakes) => fakes.scoring.goOffline(true) });
    expect(held()).toBe(true);
    app.scoring.goOffline(false);
    app.scoring.revoke();
    await flush(16_000);
    expect(title()).toBe(en['scoring.state.linkGone.title']);
    expect(held()).toBe(false);
  });
});
