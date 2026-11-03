import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BadmintonTap } from '@/domain/scoring/badmintonPad';
import { scoringHubOf, type FocusHandle } from '@/hooks/scoringHub';
import { SINGLES_SEED } from '@/services/fakeScoringPort';
import { readScoringLink, saveScoringLink } from '@/services/scoringLinkStore';
import { FAKE_SCORING_SECRET } from '../../test/fakeScoringLinkPort';
import { createFakePorts, timerClock, type FakePorts } from '../../test/fakePorts';

// Owner, 2026-11-03: Undo closes 30 s after a match is decided by this phone's own tap. The start of that window is
// the reducer's (`scoringMatchWindow.test.ts`: the dispatched tap that decides); the hub keeps it between screens, per
// launch (the `Ports`) and per match, and lets it go with the match: a leave, a Dismiss (which Close and Forget are). Over
// the real runner, queue store and fake server. A restart is a new `Ports` over the same files and the same server.

const FIXTURE = SINGLES_SEED.fixtureId;
const HOST = 'stg.seazn.club';
const LINK = { origin: 'https://stg.seazn.club', token: FAKE_SCORING_SECRET };
const AT = '2026-11-03T09:00:00.000Z';
const START: BadmintonTap = { kind: 'start', server: 'first' };
const RALLY: BadmintonTap = { kind: 'rally', side: 'first' };
const UNDO = { kind: 'undo', key: 'u1', at: AT } as const;

async function flush(): Promise<void> {
  for (let i = 0; i < 400; i += 1) await Promise.resolve();
}
const wait = (ms: number) => vi.advanceTimersByTimeAsync(ms);

async function rig(): Promise<FakePorts> {
  const fakes = createFakePorts({ clock: timerClock });
  await saveScoringLink(fakes.kv, FIXTURE, LINK, HOST, 'badminton');
  return fakes;
}

const decidedAtOf = (handle: FocusHandle): number | null | 'not ready' => {
  const snapshot = handle.runner.snapshot();
  return snapshot.kind === 'ready' ? snapshot.state.decidedAt : 'not ready';
};
const nowOf = (fakes: FakePorts): number => fakes.ports.clock().getTime();

/** Start, then 41 rallies from another scorer: the next rally for the first side decides the match. */
async function oneToGo(fakes: FakePorts, handle: FocusHandle): Promise<void> {
  await flush();
  handle.runner.dispatch({ kind: 'tap', tap: START, key: 'k0', at: AT });
  await flush();
  await wait(1_000);
  for (let i = 0; i < 41; i += 1) {
    fakes.scoring.addOtherScorerEvent('badminton.rally', {
      wonBy: SINGLES_SEED.sides.home.entrantId,
    });
  }
  handle.runner.dispatch({ kind: 'read' });
  await flush();
  await wait(1_000);
}

/** The match decided by this phone's own tap; the hub's handle and the clock at that tap. */
async function decided(fakes: FakePorts): Promise<{ handle: FocusHandle; at: number }> {
  const handle = scoringHubOf(fakes.ports).focus(FIXTURE);
  await oneToGo(fakes, handle);
  const at = nowOf(fakes);
  expect(handle.runner.dispatch({ kind: 'tap', tap: RALLY, key: 'k1', at: AT })).toEqual({
    ok: true,
  });
  await flush();
  await wait(1_000);
  return { handle, at };
}

/** The server's ledger answers only once released, so the pad meets the bootstrap (0-0, in play) before the events. */
function holdLedgerReads(fakes: FakePorts): { release: () => void } {
  let release: () => void = () => undefined;
  const open = new Promise<void>((resolve) => {
    release = resolve;
  });
  const real = fakes.scoring.events.bind(fakes.scoring);
  vi.spyOn(fakes.scoring, 'events').mockImplementation(async (...args) => {
    await open;
    return real(...args);
  });
  return { release };
}

/**
 * Nothing the server says reaches the pad: the screen stays as the hub opened it, before the first read. The reducer
 * clears a start on the first frame that is not decided, so a start the hub failed to let go of shows only here.
 */
function holdFirstReads(fakes: FakePorts): void {
  const never = <T>() => new Promise<T>(() => undefined);
  vi.spyOn(fakes.scoring, 'bootstrap').mockImplementation(() => never());
  vi.spyOn(fakes.scoring, 'events').mockImplementation(() => never());
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-11-03T09:00:00.000Z'));
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('the Undo window’s start, kept by the hub', () => {
  it('is the clock of the tap that decided the match', async () => {
    const fakes = await rig();
    const { handle, at } = await decided(fakes);
    expect(decidedAtOf(handle)).toBe(at);
  });

  it('is the same window when the screen goes and comes back: Home and back within 30 s', async () => {
    const fakes = await rig();
    const { handle, at } = await decided(fakes);
    handle.release();
    await flush();
    await wait(4_000);
    const back = scoringHubOf(fakes.ports).focus(FIXTURE);
    await flush();
    expect(decidedAtOf(back)).toBe(at);
    // Not a fresh 30 s: the rest of this one, to the millisecond.
    expect(back.runner.dispatch({ ...UNDO })).toEqual({ ok: true });
  });

  it('is shut for Undo on the screen that comes back after the 30 s, whatever it was opened with', async () => {
    const fakes = await rig();
    const { handle } = await decided(fakes);
    handle.release();
    await flush();
    await wait(31_000);
    const back = scoringHubOf(fakes.ports).focus(FIXTURE);
    await flush();
    expect(back.runner.dispatch({ ...UNDO })).toEqual({ ok: false, refusal: 'notNow' });
  });

  it('is gone with a restart: a new launch finds the decided match with no start, and Undo refused', async () => {
    const fakes = await rig();
    const { handle } = await decided(fakes);
    handle.release();
    await flush();
    await wait(1_000);
    const relaunched = scoringHubOf({ ...fakes.ports }).focus(FIXTURE);
    await flush();
    expect(decidedAtOf(relaunched)).toBeNull();
    expect(relaunched.runner.dispatch({ ...UNDO })).toEqual({ ok: false, refusal: 'notNow' });
  });

  // Scanning another match calls `leave`: the boot and ledger caches go and this phone's own tap ids are kept for a day.
  // The rescan then reads the bootstrap and an EMPTY ledger first (0-0, in play) and the real ledger after: it must not
  // take the ledger landing, decided, with the kept ids for a decision of this phone's.
  it('is gone with a leave: the rescan shows the match decided with no start, even when its ledger lands after a 0-0', async () => {
    const fakes = await rig();
    await decided(fakes);
    await scoringHubOf(fakes.ports).leave(FIXTURE);
    await saveScoringLink(fakes.kv, FIXTURE, LINK, HOST, 'badminton');
    const gate = holdLedgerReads(fakes);
    const rescanned = scoringHubOf(fakes.ports).focus(FIXTURE);
    await flush();
    await wait(1_000);
    expect(decidedAtOf(rescanned)).toBeNull();
    gate.release();
    await wait(1_000);
    await flush();
    expect(decidedAtOf(rescanned)).toBeNull();
    expect(rescanned.runner.dispatch({ ...UNDO })).toEqual({ ok: false, refusal: 'notNow' });
  });

  it('is gone with a Dismiss, which Close and Forget are: the same match scanned again has no window', async () => {
    const fakes = await rig();
    await decided(fakes);
    await scoringHubOf(fakes.ports).dismiss(FIXTURE);
    await saveScoringLink(fakes.kv, FIXTURE, LINK, HOST, 'badminton');
    const rescanned = scoringHubOf(fakes.ports).focus(FIXTURE);
    await flush();
    await wait(1_000);
    expect(decidedAtOf(rescanned)).toBeNull();
  });

  // A launch (or a return) sweeps a match nothing wants any more: link, files and all but this phone's tap ids, as a leave.
  it('is gone with a sweep of a match nothing wants any more, which is a leave by another road', async () => {
    const fakes = await rig();
    const { handle } = await decided(fakes);
    handle.release();
    await flush();
    await wait(1_000);
    await fakes.ports.modeStore.load();
    await scoringHubOf(fakes.ports).resume();
    await flush();
    expect((await readScoringLink(fakes.kv, FIXTURE, HOST)).kind).toBe('none');
    await saveScoringLink(fakes.kv, FIXTURE, LINK, HOST, 'badminton');
    const rescanned = scoringHubOf(fakes.ports).focus(FIXTURE);
    await flush();
    await wait(1_000);
    expect(decidedAtOf(rescanned)).toBeNull();
  });

  // The hub's own letting go, apart from the reducer's (which clears a start on the first undecided frame): the screen
  // that opens, before it has read anything, is handed the start the hub kept, or none once the match is gone.
  describe('as the screen opens, before it has read anything', () => {
    it('is handed the start the hub kept: Home and back', async () => {
      const fakes = await rig();
      const { handle, at } = await decided(fakes);
      handle.release();
      await flush();
      holdFirstReads(fakes);
      const back = scoringHubOf(fakes.ports).focus(FIXTURE);
      await flush();
      expect(decidedAtOf(back)).toBe(at);
    });

    it.each(['dismiss', 'leave'] as const)(
      'is none after a %s: the hub has let it go, and the reducer has not yet been asked',
      async (ending) => {
        const fakes = await rig();
        await decided(fakes);
        await scoringHubOf(fakes.ports)[ending](FIXTURE);
        await saveScoringLink(fakes.kv, FIXTURE, LINK, HOST, 'badminton');
        holdFirstReads(fakes);
        const rescanned = scoringHubOf(fakes.ports).focus(FIXTURE);
        await flush();
        expect(decidedAtOf(rescanned)).toBeNull();
      },
    );

    it('is none after a sweep of a match nothing wants any more', async () => {
      const fakes = await rig();
      const { handle } = await decided(fakes);
      handle.release();
      await flush();
      await wait(1_000);
      await fakes.ports.modeStore.load();
      await scoringHubOf(fakes.ports).resume();
      await flush();
      expect((await readScoringLink(fakes.kv, FIXTURE, HOST)).kind).toBe('none');
      await saveScoringLink(fakes.kv, FIXTURE, LINK, HOST, 'badminton');
      holdFirstReads(fakes);
      const rescanned = scoringHubOf(fakes.ports).focus(FIXTURE);
      await flush();
      expect(decidedAtOf(rescanned)).toBeNull();
    });
  });

  it('is kept per match: another match’s leave does not take this one’s', async () => {
    const fakes = await rig();
    const { handle, at } = await decided(fakes);
    await scoringHubOf(fakes.ports).leave('some-other-match');
    await scoringHubOf(fakes.ports).dismiss('another-match');
    expect(decidedAtOf(handle)).toBe(at);
  });
});
