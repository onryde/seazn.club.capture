import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { SessionState } from '@/domain/session/SessionState';
import { useViewfinder } from '@/hooks/useViewfinder';
import { createFakePorts } from '../../test/fakePorts';
import { wrapperFor } from '../../test/renderWithPorts';

type Kind = SessionState['kind'];

/**
 * Q-C2: Remote scoring is offered while a pairing is held, Paired and on air, before and during live. It is a field of
 * its own, not the shutter's: the two buttons happen to share a rule today, for different reasons (a camera picture to
 * save, a code to show). Typed over every kind, so a new kind is a compile error here.
 */
const SCORING: Record<Kind, boolean> = {
  idle: false,
  pairing: false,
  paired: true,
  arming: true,
  armed: true,
  connecting: true,
  publishing: true,
  degraded: true,
  reconnecting: true,
  ended: false,
};

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

describe('when Remote scoring is offered (spec §10, Q-C2)', () => {
  it('is offered in exactly Paired and on air, over every kind', () => {
    let checked = 0;
    let offered = 0;
    for (const kind of Object.keys(SCORING) as Kind[]) {
      const fakes = createFakePorts();
      fakes.engine.forceState(STATE[kind]);
      const view = renderHook(() => useViewfinder(), { wrapper: wrapperFor(fakes) });
      expect({ kind, scoring: view.result.current.scoring }).toEqual({
        kind,
        scoring: SCORING[kind],
      });
      checked += 1;
      if (view.result.current.scoring) offered += 1;
      view.unmount();
    }
    expect(checked).toBe(10);
    expect(offered).toBe(7);
  });

  it('follows one session through: offered paired and on air, gone when it ends', () => {
    const fakes = createFakePorts();
    fakes.engine.forceState(STATE.paired);
    const view = renderHook(() => useViewfinder(), { wrapper: wrapperFor(fakes) });
    const seen: boolean[] = [view.result.current.scoring];
    for (const kind of ['publishing', 'reconnecting', 'ended'] as const) {
      act(() => fakes.engine.forceState(STATE[kind]));
      seen.push(view.result.current.scoring);
    }
    expect(seen).toEqual([true, true, true, false]);
  });
});
