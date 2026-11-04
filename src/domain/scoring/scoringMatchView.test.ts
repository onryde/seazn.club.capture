import { describe, expect, it } from 'vitest';
import { step } from '@/domain/scoring/scoringMatch';
import { viewOf } from '@/domain/scoring/scoringMatchView';
import {
  PHONE_LINK,
  SINGLES,
  eventId,
  ledgerOf,
  queuedOf,
  rally,
  start,
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
    ['a cancelled match', { dead: 'cancelled' as const }, { kind: 'viewOnly' }],
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

  it('a closure a read brought, with nothing queued, is a card though the queue is not dead', () => {
    const state = step(
      ready(),
      { kind: 'bootstrapRead', bootstrap: { ...SINGLES, status: 'finalized' } },
      NOW,
    ).state;
    expect(padOf(state).view.card).toEqual({ kind: 'viewOnly' });
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
