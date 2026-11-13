import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Candidate } from '@/domain/matchday/callWire';
import type { Row } from '@/domain/matchday/matchDay';
import { encodeSavedCode, type SavedCode } from '@/domain/mode/savedCode';
import { useCallCourt } from '@/hooks/useCallCourt';
import { useUndoCall } from '@/hooks/useUndoCall';
import { STORE_KEYS } from '@/services/modeStore';
import { createFakePorts, TEST_NOW, type FakePorts } from '../../test/fakePorts';
import { dayLink } from '../../test/fixtures/dayCode';
import { wrapperFor } from '../../test/renderWithPorts';

// MD-2 Task 8e: the call hooks' single-flight rules, tested where two calls land in ONE tick, before any render can
// disable a control (the screen's own double-tap tests re-render between the taps, so the render hides these guards).

const SAVED_DAY: SavedCode = {
  mode: 'matchday',
  raw: dayLink(),
  slot: null,
  savedAt: TEST_NOW,
  expiresAt: null,
  stream: null,
  scoring: null,
};
const COURT = '1f6a7b8c-9d0e-4f1a-9b2c-4d5e6f7a8b9c';
const FIXTURE = '2c3d4e5f-6a7b-4c8d-9e0f-1a2b3c4d5e6f';
const MATCH: Row = {
  fixtureId: FIXTURE,
  sportKey: 'badminton',
  divisionName: "Men's singles",
  roundLabel: 'R2',
  roundTag: 'R2',
  home: 'Kim',
  away: 'Lee',
  homeSlot: null,
  awaySlot: null,
  status: 'upcoming',
  scheduledAt: new Date('2026-10-03T14:20:00.000Z'),
  summary: null,
};
const PICK: Candidate = {
  match: MATCH,
  source: 'thisCourt',
  fromCourtName: null,
  plannedAt: null,
  waitingMinutes: 0,
  behindMinutes: 0,
  blocked: null,
};

const settle = (ms = 0) => act(() => vi.advanceTimersByTimeAsync(ms));
const ops = (fakes: FakePorts, op: string) => fakes.matchDay.calls.filter((c) => c.op === op);

async function fakes(): Promise<FakePorts> {
  const f = createFakePorts({
    kvSeed: {
      [STORE_KEYS.code('matchday')]: encodeSavedCode(SAVED_DAY),
      [STORE_KEYS.active]: 'matchday',
    },
  });
  await f.ports.modeStore.load();
  f.matchDay.answerCandidates({
    ok: true,
    value: { courtId: COURT, courtName: 'Court 2', candidates: [PICK] },
  });
  f.matchDay.answerPreview({ ok: true, value: { shifts: [], warnings: [] } });
  f.matchDay.answerCall({
    ok: true,
    value: { fixtureId: FIXTURE, courtId: COURT, calledAt: new Date(TEST_NOW) },
  });
  f.matchDay.answerUndo({
    ok: true,
    value: { fixtureId: FIXTURE, courtId: null, scheduledAt: null },
  });
  return f;
}

beforeEach(() => vi.useFakeTimers({ now: TEST_NOW }));
afterEach(() => vi.useRealTimers());

describe('useCallCourt: one request at a time, even in one tick', () => {
  const sink = { refresh: vi.fn(), close: vi.fn() };

  async function mount() {
    const f = await fakes();
    const view = renderHook(() => useCallCourt(COURT, 'Court 2', sink), {
      wrapper: wrapperFor(f),
    });
    await settle();
    return { f, view };
  }

  it('two picks in one tick ask one preview', async () => {
    const { f, view } = await mount();
    const { pick } = view.result.current;
    act(() => {
      pick(PICK);
      pick(PICK);
    });
    await settle();
    expect(ops(f, 'preview')).toHaveLength(1);
  });

  it('a pick before the candidates are read asks nothing', async () => {
    const f = await fakes();
    f.matchDay.hold();
    const view = renderHook(() => useCallCourt(COURT, 'Court 2', sink), {
      wrapper: wrapperFor(f),
    });
    await settle();
    expect(view.result.current.list).toBe('loading');
    act(() => view.result.current.pick(PICK));
    expect(ops(f, 'preview')).toHaveLength(0);
  });

  it('a refused preview reads the day again and the candidates again', async () => {
    const { f, view } = await mount();
    f.matchDay.answerPreview({
      ok: false,
      refused: { code: 'MD_CALL_REFUSED', reason: 'courtBusy', personName: null, courtName: null },
    });
    sink.refresh.mockClear();
    const reads = ops(f, 'candidates').length;
    act(() => view.result.current.pick(PICK));
    await settle();
    expect(sink.refresh).toHaveBeenCalledTimes(1);
    expect(ops(f, 'candidates')).toHaveLength(reads + 1);
  });

  it('a pick once the preview shows asks nothing more', async () => {
    const { f, view } = await mount();
    act(() => view.result.current.pick(PICK));
    await settle();
    expect(view.result.current.preview).toBe('ready');
    act(() => view.result.current.pick(PICK));
    await settle();
    expect(ops(f, 'preview')).toHaveLength(1);
  });

  it('two calls in one tick send one call', async () => {
    const { f, view } = await mount();
    act(() => view.result.current.pick(PICK));
    await settle();
    const { call } = view.result.current;
    expect(view.result.current.preview).toBe('ready');
    act(() => {
      call();
      call();
    });
    await settle();
    expect(ops(f, 'call')).toHaveLength(1);
  });
});

describe('useUndoCall: one request, even in one tick', () => {
  it('two undos in one tick send one DELETE', async () => {
    const f = await fakes();
    const sink = { say: vi.fn(), refresh: vi.fn() };
    const view = renderHook(() => useUndoCall(sink), { wrapper: wrapperFor(f) });
    act(() => view.result.current.ask(MATCH, 'Court 2'));
    const { undo } = view.result.current;
    act(() => {
      undo();
      undo();
    });
    await settle();
    expect(ops(f, 'undo')).toHaveLength(1);
  });
});
