import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { SessionState } from '@/domain/session/SessionState';
import { useViewfinder } from '@/hooks/useViewfinder';
import { createFakePorts } from '../../test/fakePorts';
import { savedCourtCode, savedStreamCode } from '../../test/fixtures/savedStream';
import { pairCode } from '../../test/pairCode';
import { wrapperFor } from '../../test/renderWithPorts';

type Kind = SessionState['kind'];

/** Every kind, each in a shape native reports. Typed over every kind, so a new kind is a compile error here. */
const STATE: Record<Kind, SessionState> = {
  idle: { kind: 'idle' },
  pairing: { kind: 'pairing' },
  paired: { kind: 'paired' },
  arming: { kind: 'arming', cause: 'operator', retrying: false },
  armed: { kind: 'armed', cause: 'operator', notReady: null },
  connecting: { kind: 'connecting', transport: 'srt' },
  publishing: { kind: 'publishing', transport: 'srt', sinceEpochMs: 1 },
  degraded: { kind: 'degraded', transport: 'srt', reason: 'poor-uplink', sinceEpochMs: 1 },
  reconnecting: {
    kind: 'reconnecting',
    cause: 'uplink-lost',
    holdRemainingSeconds: 30,
    holdWindowSeconds: 60,
    sinceEpochMs: 1,
  },
  ended: { kind: 'ended', reason: 'operator-stopped', durationMs: null },
};

/** The kinds that went live (owner decision 1): on a fixture's code their Stop ends the pairing. */
const WENT_LIVE: readonly Kind[] = ['publishing', 'degraded', 'reconnecting'];

/**
 * Court stream (spec 2026-11-14 §6.3, O5): a court code's Stop ends this match only, in every state, so the viewfinder
 * never says it unpairs; a fixture's code keeps owner decision 1's rule. `court` is the snapshot's, as native seeds it.
 */
describe('Stop on a court code never unpairs', () => {
  it('reads the court, and no Stop unpairs, over every kind on a court code', () => {
    let checked = 0;
    for (const kind of Object.keys(STATE) as Kind[]) {
      const fakes = createFakePorts();
      pairCode(fakes.engine, savedCourtCode());
      fakes.engine.forceState(STATE[kind]);
      const view = renderHook(() => useViewfinder(), { wrapper: wrapperFor(fakes) });
      const { court, stopUnpairs } = view.result.current;
      expect({ kind, court, stopUnpairs }).toEqual({ kind, court: 'Court 2', stopUnpairs: false });
      checked += 1;
      view.unmount();
    }
    expect(checked).toBe(10);
  });

  it('keeps owner decision 1 on a fixture’s code: only the kinds that went live unpair', () => {
    const unpairs: Kind[] = [];
    for (const kind of Object.keys(STATE) as Kind[]) {
      const fakes = createFakePorts();
      pairCode(fakes.engine, savedStreamCode());
      fakes.engine.forceState(STATE[kind]);
      const view = renderHook(() => useViewfinder(), { wrapper: wrapperFor(fakes) });
      expect(view.result.current.court).toBeNull();
      if (view.result.current.stopUnpairs) unpairs.push(kind);
      view.unmount();
    }
    expect(unpairs).toEqual(WENT_LIVE);
  });

  // Four questions (3): a court the descriptor names later (a code saved before courts, P1 review M4) turns it over.
  it('follows the court when it arrives on a held pairing', () => {
    const fakes = createFakePorts();
    pairCode(fakes.engine, savedStreamCode());
    fakes.engine.forceState(STATE.publishing);
    const view = renderHook(() => useViewfinder(), { wrapper: wrapperFor(fakes) });
    expect(view.result.current.stopUnpairs).toBe(true);
    act(() => fakes.engine.setPairing({ court: 'Court 2' }));
    expect([view.result.current.court, view.result.current.stopUnpairs]).toEqual([
      'Court 2',
      false,
    ]);
  });
});
