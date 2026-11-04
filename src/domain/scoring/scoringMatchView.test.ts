import { describe, expect, it } from 'vitest';
import { step } from '@/domain/scoring/scoringMatch';
import { deadOf } from '@/domain/scoring/scoringMatchState';
import { viewOf } from '@/domain/scoring/scoringMatchView';
import {
  PHONE_LINK,
  SINGLES,
  eventId,
  ledgerOf,
  queuedOf,
  rally,
  rallies,
  start,
  voiding,
} from '../../../test/badmintonLedger';
import { NOW, drive, opened, queueOf, ready, tapped } from '../../../test/scoringMatchFixtures';

// What the screen shows of a match (plan S2-1 Task 9): the pad under the card that matters most, or the state that takes
// its place. Literal expectations; the words are dictionary keys.

const AT = '2026-11-02T09:00:00.000Z';
const padOf = (state: Parameters<typeof viewOf>[0]) => {
  const view = viewOf(state);
  if (view.kind !== 'pad') throw new Error(`expected the pad, got ${view.kind}`);
  return view;
};

describe('the states that take the pad’s place', () => {
  it('no bootstrap and no news of the link: loading, and offline once the first read could not be made', () => {
    const state = opened({ bootstrap: null });
    expect(viewOf(state)).toEqual({ kind: 'loading', offline: false });
    const failed = step(
      state,
      { kind: 'bootstrapFailed', failure: { kind: 'offline' } },
      NOW,
    ).state;
    expect(viewOf(failed)).toEqual({ kind: 'loading', offline: true });
  });

  it('no bootstrap and a link the door does not take: the link is gone', () => {
    const state = opened({ bootstrap: null });
    const gone = step(
      state,
      { kind: 'bootstrapFailed', failure: { kind: 'linkDead', code: 'LINK_REVOKED' } },
      NOW,
    ).state;
    expect(viewOf(gone)).toEqual({ kind: 'linkGone' });
  });

  it('a sport this build does not score, named', () => {
    expect(viewOf(ready({ bootstrap: { ...SINGLES, sportKey: 'tennis' } }))).toEqual({
      kind: 'unsupportedSport',
      sportKey: 'tennis',
    });
  });

  it('a ledger over the read’s cap', () => {
    const state = step(ready(), { kind: 'fetchFailed', failure: { kind: 'tooLarge' } }, NOW).state;
    expect(viewOf(state)).toEqual({ kind: 'tooLarge' });
  });

  it.each([
    ['a seat with no entrant', { ...SINGLES, sides: { ...SINGLES.sides, away: null } }, 'sides'],
    ['a config the engine refuses', { ...SINGLES, cfg: { bestOf: 'many' } }, 'cfg'],
  ] as const)('%s cannot be folded: said, with the reason', (_name, bootstrap, reason) => {
    expect(viewOf(ready({ bootstrap }))).toEqual({ kind: 'unfoldable', reason });
  });

  it('an app too old, and a match that cannot be folded: the banner’s count of unsent taps', () => {
    const base = opened({
      ...tapped([queuedOf('k1', rally('H')), queuedOf('k2', rally('A'))]),
      bootstrap: { ...SINGLES, cfg: { bestOf: 'many' }, epochRequired: 3 },
    });
    expect(viewOf(base)).toEqual({ kind: 'outdated', unsent: 2 });
  });
});

describe('the pad and its card', () => {
  it('an ordinary match is the pad with no card, synced, its halves tapping', () => {
    const { view, history } = padOf(ready());
    expect(view.card).toBeNull();
    expect(view.sync).toEqual({ kind: 'synced' });
    expect(view.halves.map((half) => half.tappable)).toEqual([true, true]);
    expect(history.map((group) => [group.heading.key, group.rows.length])).toEqual([
      ['scoring.badminton.gameHeading', 1],
    ]);
  });

  it.each([
    ['a link the door does not take', { dead: 'LINK_REVOKED' as const }, { kind: 'linkInvalid' }],
    ['a match gone', { dead: 'gone' as const }, { kind: 'linkInvalid' }],
    ['an account to pay', { dead: 'payment' as const }, { kind: 'linkInvalid' }],
    ['a forbidden write', { dead: 'forbidden' as const }, { kind: 'linkInvalid' }],
    ['a finalized match', { dead: 'finalized' as const }, { kind: 'viewOnly' }],
    ['a cancelled match', { dead: 'cancelled' as const }, { kind: 'cancelled' }],
    ['a result carried forward', { dead: 'carriedForward' as const }, { kind: 'carriedForward' }],
  ])('%s is a card over the pad, its halves not tapping', (_name, { dead }, card) => {
    const { view } = padOf(ready({ queue: queueOf({ dead }) }));
    expect(view.card).toEqual(card);
    expect(view.halves.map((half) => half.tappable)).toEqual([false, false]);
  });

  it('the server’s view-only screen is the view-only card, with no taps', () => {
    expect(padOf(ready({ bootstrap: { ...SINGLES, screen: 'viewOnly' } })).view.card).toEqual({
      kind: 'viewOnly',
    });
  });

  // Task 8d. The web's View-only screen names why (scan-screen.ts `ViewOnlyReason`), and the card's words follow the reason
  // (controller, 2026-11-04): only a finalize says "finalised". A screen that names no reason we know keeps the old card.
  const VIEW_ONLY = (viewOnlyReason: string | null, status = 'decided') => ({
    ...SINGLES,
    screen: 'viewOnly' as const,
    viewOnlyReason,
    status,
  });

  it('the server’s view-only screen for a carried-forward result is its own card, with no taps', () => {
    const { view } = padOf(ready({ bootstrap: VIEW_ONLY('carried_forward') }));
    expect(view.card).toEqual({ kind: 'carriedForward' });
    expect(view.halves.map((half) => half.tappable)).toEqual([false, false]);
  });

  it.each([
    ['finalized', 'finalized', { kind: 'viewOnly' }],
    ['cancelled', 'cancelled', { kind: 'cancelled' }],
    ['no_opponent', 'scheduled', { kind: 'noOpponent' }],
    ['carried_forward', 'decided', { kind: 'carriedForward' }],
    [null, 'decided', { kind: 'viewOnly' }],
    ['a_reason_made_up', 'decided', { kind: 'viewOnly' }],
  ] as const)(
    'the server’s view-only screen for %s (status %s) is the card %j, with no taps',
    (reason, status, card) => {
      const { view } = padOf(ready({ bootstrap: VIEW_ONLY(reason, status) }));
      expect(view.card).toEqual(card);
      expect(view.halves.map((half) => half.tappable)).toEqual([false, false]);
    },
  );

  // The web's table puts finalized before carried forward (scanScreen), and a queue closed as finalized stays so.
  it('a queue closed as finalized is the view-only card, whatever the stale bootstrap says', () => {
    const state = ready({
      bootstrap: VIEW_ONLY('carried_forward'),
      queue: queueOf({ dead: 'finalized' }),
    });
    expect(padOf(state).view.card).toEqual({ kind: 'viewOnly' });
  });

  // Controller, 2026-11-04. The web's table, top to bottom, decides between the facts the phone holds (its queue's word
  // and the bootstrap's reason), not which of them it learned last.
  it.each([
    ['carriedForward', 'finalized', { kind: 'viewOnly' }],
    ['carriedForward', 'cancelled', { kind: 'cancelled' }],
    ['carriedForward', 'no_opponent', { kind: 'carriedForward' }],
    ['cancelled', 'carried_forward', { kind: 'cancelled' }],
    ['cancelled', 'finalized', { kind: 'viewOnly' }],
    ['finalized', 'cancelled', { kind: 'viewOnly' }],
    ['finalized', 'no_opponent', { kind: 'viewOnly' }],
  ] as const)(
    'a queue closed as %s and a bootstrap that now says %s is the card %j: the web’s table, finalized first',
    (dead, reason, card) => {
      const state = ready({ bootstrap: VIEW_ONLY(reason), queue: queueOf({ dead }) });
      expect(padOf(state).view.card).toEqual(card);
    },
  );

  it('a dead link outranks every reason the bootstrap gives', () => {
    for (const reason of ['finalized', 'cancelled', 'carried_forward', 'no_opponent']) {
      const state = ready({
        bootstrap: VIEW_ONLY(reason),
        queue: queueOf({ dead: 'LINK_REVOKED' }),
      });
      expect(padOf(state).view.card).toEqual({ kind: 'linkInvalid' });
    }
  });

  it('a queue closed as carried forward is that card on the pad, and outranks the update card', () => {
    const state = ready({
      bootstrap: { ...SINGLES, epochRequired: 3 },
      queue: queueOf({ dead: 'carriedForward' }),
    });
    expect(padOf(state).view.card).toEqual({ kind: 'carriedForward' });
  });

  it.each(['divisionNotStarted', 'waiting'] as const)(
    'the %s screen is the not-started card',
    (screen) => {
      expect(padOf(ready({ bootstrap: { ...SINGLES, screen } })).view.card).toEqual({
        kind: 'notStarted',
      });
    },
  );

  it('the confirm screen is the Start screen, with no card', () => {
    const { view } = padOf(ready({ bootstrap: { ...SINGLES, screen: 'confirm' } }, []));
    expect(view.card).toBeNull();
    expect(view.start).not.toBeNull();
  });

  it('a server that needs a newer app is the update card with the count of unsent taps, the pad still showing', () => {
    const state = ready({ bootstrap: { ...SINGLES, epochRequired: 3 } });
    expect(padOf(state).view.card).toEqual({ kind: 'updateNeeded', unsent: 0 });
  });

  it('a 426 answer is the update card too, naming what is still unsent', () => {
    const read = step(
      opened(tapped([queuedOf('k1', rally('H'))])),
      { kind: 'fetched', events: [] },
      NOW,
    );
    const send = read.effects.flatMap((effect) => (effect.kind === 'send' ? [effect] : []))[0];
    const old = step(
      read.state,
      { kind: 'answered', sent: send.sent, answer: { kind: 'outdated', required: 3 } },
      NOW,
    ).state;
    expect(padOf(old).view.card).toEqual({ kind: 'updateNeeded', unsent: 1 });
  });

  it('a card of a dead link outranks the update card, and a closed match outranks it too', () => {
    const base = { ...SINGLES, epochRequired: 3 };
    expect(
      padOf(ready({ bootstrap: base, queue: queueOf({ dead: 'LINK_REVOKED' }) })).view.card,
    ).toEqual({ kind: 'linkInvalid' });
    expect(
      padOf(ready({ bootstrap: base, queue: queueOf({ dead: 'finalized' }) })).view.card,
    ).toEqual({ kind: 'viewOnly' });
  });

  it('a decided match is the recorded result’s card, from the fold', () => {
    const decided = [start(), ...Array.from({ length: 42 }, () => rally('H'))];
    expect(padOf(ready({}, decided)).view.card).toEqual({ kind: 'resultRecorded', undoLeft: null });
  });

  // The bootstrap names the reason but does not close the queue: the web judges "carried forward" live and answers a
  // keyed retry of a write it already holds (scoring.ts), so a tap the phone still has waiting is sent and the server
  // says whether it stands. Only a 403 RESULT_CARRIED_FORWARD closes the queue.
  it('a bootstrap that says carried forward changes the card, not the queue: its taps are kept to go, nothing is dead', () => {
    const state = step(
      opened(tapped([queuedOf('k1', rally('H'))])),
      { kind: 'bootstrapRead', bootstrap: VIEW_ONLY('carried_forward') },
      NOW,
    ).state;
    expect(deadOf(state)).toBeNull();
    expect(state.sync.queue.pending).toHaveLength(1);
    expect(padOf(state).view.card).toEqual({ kind: 'carriedForward' });
  });

  it('a closure a read brought, with nothing queued, is a card though the queue is not dead', () => {
    const state = step(
      ready(),
      { kind: 'bootstrapRead', bootstrap: { ...SINGLES, status: 'finalized' } },
      NOW,
    ).state;
    expect(padOf(state).view.card).toEqual({ kind: 'viewOnly' });
  });
});

// Task 8d follow-up (controller, 2026-11-04). Under a closed match (finalized, or a result carried forward) the pad's
// score is the server's ledger (AGENTS §2), never a fold with the taps the server refused or never took: a refused Undo
// must not take a point off a result that stands. The taps stay in the queue, in the badge and in History.
describe('a result that stands is the ledger’s, not the fold of a refused tap', () => {
  // Home 3, away 0 on the server; the phone's Undo of the third rally was refused (or never sent).
  const LEDGER = [start(), ...rallies('HHH')];
  const refusedUndo = (dead: 'finalized' | 'carriedForward' | 'cancelled' | 'LINK_REVOKED') =>
    ready(
      {
        queue: queueOf({ dead, pending: [queuedOf('k1', voiding(4))], ownEventIds: [eventId(4)] }),
      },
      LEDGER,
    );
  const values = (state: Parameters<typeof viewOf>[0]) =>
    padOf(state).view.halves.map((half) => half.value);

  it.each(['finalized', 'carriedForward'] as const)(
    'a %s queue holding a refused Undo shows the ledger’s 3–0, not 2–0',
    (dead) => {
      expect(values(refusedUndo(dead))).toEqual(['3', '0']);
    },
  );

  it('the same Undo on a live queue is folded, as it always was: 2–0 while it waits to go', () => {
    const live = ready(
      { queue: queueOf({ pending: [queuedOf('k1', voiding(4))], ownEventIds: [eventId(4)] }) },
      LEDGER,
    );
    expect(values(live)).toEqual(['2', '0']);
  });

  // The ruling names a result that stands. A cancelled match has no result and a gone link says nothing of the match.
  it.each(['cancelled', 'LINK_REVOKED'] as const)(
    'a %s queue is not a result that stands: its taps are folded as before',
    (dead) => {
      expect(values(refusedUndo(dead))).toEqual(['2', '0']);
    },
  );

  // History is the trace of what the phone did, and it lists what it listed before the ruling: an unsent Undo strikes
  // out the rally it was for (it has no row of its own), an unsent rally is a Sending row on top. Neither says "refused".
  it.each(['finalized', 'carriedForward'] as const)(
    'a %s queue keeps the badge and History’s trace of a refused Undo: the rally struck out, as before',
    (dead) => {
      const { view, history } = padOf(refusedUndo(dead));
      expect(view.sync).toEqual({ kind: 'refused', count: 1 });
      expect(history.map((group) => group.rows.map((row) => [row.sending, row.undone]))).toEqual([
        [
          [false, true],
          [false, false],
          [false, false],
          [false, false],
        ],
      ]);
    },
  );

  it('a refused rally past the ledger is no point either: the ledger’s 3–0 stands, the rallies are Sending rows', () => {
    const state = ready(
      {
        queue: queueOf({
          dead: 'carriedForward',
          pending: [queuedOf('k1', rally('A')), queuedOf('k2', rally('A'))],
        }),
      },
      LEDGER,
    );
    const { view, history } = padOf(state);
    expect(view.halves.map((half) => half.value)).toEqual(['3', '0']);
    expect(view.sync).toEqual({ kind: 'refused', count: 2 });
    expect(history[0].rows.map((row) => row.sending)).toEqual([
      true,
      true,
      false,
      false,
      false,
      false,
    ]);
  });

  it('a closed match with nothing queued reads as it did: the ledger folded', () => {
    const state = ready({ queue: queueOf({ dead: 'carriedForward' }) }, LEDGER);
    expect(padOf(state).view.halves.map((half) => half.value)).toEqual(['3', '0']);
    expect(padOf(state).view.sync).toEqual({ kind: 'synced' });
  });
});

describe('what the pad says of the transport', () => {
  const unsent = (extra: Parameters<typeof opened>[0] = {}) =>
    opened({ ...tapped([queuedOf('k1', rally('H')), queuedOf('k2', rally('A'))]), ...extra });

  it('nothing queued is synced; taps queued are sending', () => {
    expect(padOf(ready()).view.sync).toEqual({ kind: 'synced' });
    expect(padOf(unsent()).view.sync).toEqual({ kind: 'sending', count: 2 });
  });

  it('a send that found no network is offline, with the count', () => {
    const read = step(unsent(), { kind: 'fetched', events: [] }, NOW);
    const send = read.effects.flatMap((effect) => (effect.kind === 'send' ? [effect] : []))[0];
    const down = step(
      read.state,
      { kind: 'answered', sent: send.sent, answer: { kind: 'offline' } },
      NOW,
    ).state;
    expect(padOf(down).view.sync).toEqual({ kind: 'offline', count: 2 });
  });

  // The pad's send badge (owner, 2026-11-02): a phone whose taps the server keeps refusing is "can't send", not "sending".
  // The sixth refusal in a row is `stallOf`'s line (the record's `scoring.stalled`); the badge reads the same reading.
  describe('taps the server keeps refusing', () => {
    type Patch = Partial<ReturnType<typeof unsent>['sync']>;
    const withSync = (state: ReturnType<typeof unsent>, patch: Patch) => ({
      ...state,
      sync: { ...state.sync, ...patch },
    });
    const refused = (count: number, by: 'rules' | 'conflict' = 'rules') =>
      withSync(unsent(), { refusedRun: { by, count } });

    it('are still sending through the fifth refusal and are stalled from the sixth, with the count', () => {
      expect(padOf(refused(5)).view.sync).toEqual({ kind: 'sending', count: 2 });
      expect(padOf(refused(6)).view.sync).toEqual({ kind: 'stalled', count: 2 });
      expect(padOf(refused(40, 'conflict')).view.sync).toEqual({ kind: 'stalled', count: 2 });
    });

    it('are offline, not stalled, when the network is what failed last', () => {
      const down = withSync(unsent(), { status: 'offline', refusedRun: { by: 'rules', count: 9 } });
      expect(padOf(down).view.sync).toEqual({ kind: 'offline', count: 2 });
    });

    it('are refused, not stalled, in a dead queue', () => {
      const dead = unsent({
        queue: queueOf({ pending: [queuedOf('k1', rally('H'))], dead: 'LINK_REVOKED' }),
      });
      const state = withSync(dead, { refusedRun: { by: 'rules', count: 9 } });
      expect(padOf(state).view.sync).toEqual({ kind: 'refused', count: 1 });
    });

    it('are synced once the queue is empty, whatever run was counted', () => {
      const state = withSync(ready(), { refusedRun: { by: 'rules', count: 9 } });
      expect(padOf(state).view.sync).toEqual({ kind: 'synced' });
    });
  });

  // Review, 2026-11-02: a 426 was read as "offline", so the badge told a phone that needs an update to wait for a signal.
  describe('taps kept for an update', () => {
    it('are outdated, with the count, not offline: the answer was 426', () => {
      const state = { ...unsent(), sync: { ...unsent().sync, status: 'outdated' as const } };
      expect(padOf(state).view.sync).toEqual({ kind: 'outdated', count: 2 });
    });

    it('are outdated when the bootstrap names a newer engine, with nothing sent yet', () => {
      const old = unsent();
      const state = { ...old, bootstrap: { ...SINGLES, epochRequired: old.sync.engineEpoch + 1 } };
      expect(padOf(state).view.sync).toEqual({ kind: 'outdated', count: 2 });
    });

    it('are refused first in a dead queue, even when the app is also too old; and offline is still offline', () => {
      const old = unsent();
      const dead = {
        ...old,
        bootstrap: { ...SINGLES, epochRequired: old.sync.engineEpoch + 1 },
        sync: { ...old.sync, queue: { ...old.sync.queue, dead: 'gone' as const } },
      };
      expect(padOf(dead).view.sync).toEqual({ kind: 'refused', count: 2 });
      const down = { ...unsent(), sync: { ...unsent().sync, status: 'offline' as const } };
      expect(padOf(down).view.sync).toEqual({ kind: 'offline', count: 2 });
    });
  });

  // The reconnect question (owner ruling 43): the badge reads "can't send" while it stands, and the pad carries what the
  // sheet asks: how many were scored elsewhere, how many taps wait, and the score as the server has it, without them.
  describe('the reconnect question', () => {
    // Recorded after the phone's taps (made at 10:30, `queuedOf`): another scorer's.
    const foreign = {
      kind: 'fetched',
      events: ledgerOf([start(), rally('A')], '2026-11-01T10:31:00.000Z').slice(1),
    } as const;
    const questioned = () => step(unsent(), foreign, NOW).state;

    it('is a can’t-send badge with the count of the taps waiting', () => {
      expect(padOf(questioned()).view.sync).toEqual({ kind: 'asked', count: 2 });
    });

    it('beats offline: a phone that dropped and came back is waiting for an answer, not for a signal', () => {
      const state = questioned();
      const down = { ...state, sync: { ...state.sync, status: 'offline' as const } };
      expect(padOf(down).view.sync).toEqual({ kind: 'asked', count: 2 });
    });

    it('carries the counts and the server’s score without the phone’s taps (the pad shows 1:2 with them: k1 home, k2 away)', () => {
      const pad = padOf(questioned());
      expect(pad.ask).toEqual({
        foreign: 1,
        queued: 2,
        score: [
          { label: 'A. Sharma', value: '0' },
          { label: 'L. Chen', value: '1' },
        ],
      });
      expect(pad.view.halves.map((half) => half.value)).toEqual(['1', '2']);
    });

    it('is nothing when none stands', () => {
      expect(padOf(unsent()).ask).toBeNull();
    });

    it('gives way to a link the door does not take: that is the card’s to say', () => {
      const state = questioned();
      const dead = {
        ...state,
        sync: { ...state.sync, queue: { ...state.sync.queue, dead: 'LINK_REVOKED' as const } },
      };
      expect(padOf(dead).ask).toBeNull();
      expect(padOf(dead).view.sync).toEqual({ kind: 'refused', count: 2 });
    });
  });

  it('taps kept in a dead queue are refused, with the count', () => {
    expect(
      padOf(
        unsent({ queue: queueOf({ pending: [queuedOf('k1', rally('H'))], dead: 'LINK_REVOKED' }) }),
      ).view.sync,
    ).toEqual({
      kind: 'refused',
      count: 1,
    });
  });
});

describe('the last-tap line', () => {
  it('shows the reducer’s own words when it has some', () => {
    const state = step(
      ready(),
      { kind: 'say', words: { kind: 'note', key: 'scoring.pad.countedOnce' } },
      NOW,
    ).state;
    expect(padOf(state).line).toEqual({ kind: 'note', key: 'scoring.pad.countedOnce' });
  });

  it('says another scorer has scored since, as a standing note, while that keeps Undo off', () => {
    const ledger = ledgerOf([start(), { ...rally('H'), link: PHONE_LINK }, rally('A')]);
    const state = ready({ ledger, queue: queueOf({ ownEventIds: [eventId(2)] }) });
    expect(padOf(state).line).toEqual({ kind: 'note', key: 'scoring.pad.otherScorerSince' });
    expect(padOf(state).view.lastTap?.undo).toBe(false);
  });

  it('says nothing of another scorer when this phone’s last event is the last in the match', () => {
    const ledger = ledgerOf([start(), { ...rally('H'), link: PHONE_LINK }]);
    const state = ready({ ledger, queue: queueOf({ ownEventIds: [eventId(2)] }) });
    expect(padOf(state).line).toBeNull();
    expect(padOf(state).view.lastTap?.undo).toBe(true);
  });

  it('a tap discarded by Undo leaves its "undone" sentence while the match is as it was left, and no longer', () => {
    const queued = drive(ready(), [
      { kind: 'tap', tap: { kind: 'rally', side: 'first' }, key: 'k1', at: AT },
    ]).state;
    const undone = step(queued, { kind: 'undo', key: 'u1', at: AT }, NOW).state;
    expect(padOf(undone).view.lastTap?.text).toEqual({
      key: 'scoring.badminton.undone.rally',
      vars: { side: 'A. Sharma' },
    });
    const moved = step(
      undone,
      { kind: 'tap', tap: { kind: 'rally', side: 'second' }, key: 'k2', at: AT },
      NOW,
    ).state;
    expect(padOf(moved).view.lastTap?.text.key).toBe('scoring.badminton.last.rally');
    const grown = step(
      undone,
      { kind: 'fetched', events: ledgerOf([start(), rally('A')]).slice(1) },
      NOW,
    ).state;
    expect(padOf(grown).view.lastTap?.text.key).not.toBe('scoring.badminton.undone.rally');
  });
});

describe('the Start screen’s pick', () => {
  it('is shown while the match has not started and goes once it has', () => {
    const before = ready({ toss: 'second' }, []);
    expect(padOf(before).toss).toBe('second');
    expect(padOf(ready({ toss: 'second' })).toss).toBeNull();
  });
});

describe('the match is counted once while a tap is in flight', () => {
  it('a ledger that already holds the sent tap does not score it a second time', () => {
    const read = step(
      opened(tapped([queuedOf('k1', rally('H'))])),
      { kind: 'fetched', events: [] },
      NOW,
    );
    const copy = ledgerOf([start(), { ...rally('H'), link: PHONE_LINK }]).slice(1);
    const merged = step(read.state, { kind: 'fetched', events: copy }, NOW).state;
    expect(padOf(merged).view.halves.map((half) => half.value)).toEqual(['1', '0']);
  });

  it('and while its copy is not in yet the tap counts once, from the queue', () => {
    const read = step(
      opened(tapped([queuedOf('k1', rally('H'))])),
      { kind: 'fetched', events: [] },
      NOW,
    );
    expect(padOf(read.state).view.halves.map((half) => half.value)).toEqual(['1', '0']);
  });
});
