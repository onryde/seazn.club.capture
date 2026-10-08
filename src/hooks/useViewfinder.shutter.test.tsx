import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { SessionState } from '@/domain/session/SessionState';
import { useViewfinder } from '@/hooks/useViewfinder';
import { createFakePorts } from '../../test/fakePorts';
import { wrapperFor } from '../../test/renderWithPorts';

type Kind = SessionState['kind'];

/** The owner’s scope cut: the shutter shows whenever the camera picture does, Paired and on air. */
const SHUTTER: Record<Kind, boolean> = {
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

describe('when the shutter is offered (spec §8, the owner’s scope cut)', () => {
  it('M17 is offered in exactly Paired and on air, over every kind', () => {
    let checked = 0;
    let offered = 0;
    for (const kind of Object.keys(SHUTTER) as Kind[]) {
      const fakes = createFakePorts();
      fakes.engine.forceState(STATE[kind]);
      const view = renderHook(() => useViewfinder(), { wrapper: wrapperFor(fakes) });
      expect({ kind, shutter: view.result.current.shutter }).toEqual({
        kind,
        shutter: SHUTTER[kind],
      });
      checked += 1;
      if (view.result.current.shutter) offered += 1;
      view.unmount();
    }
    expect(checked).toBe(10);
    expect(offered).toBe(7);
  });

  it('follows one session through: offered paired and on air, gone when it ends', () => {
    const fakes = createFakePorts();
    fakes.engine.forceState(STATE.paired);
    const view = renderHook(() => useViewfinder(), { wrapper: wrapperFor(fakes) });
    const seen: boolean[] = [view.result.current.shutter];
    for (const kind of ['publishing', 'reconnecting', 'ended'] as const) {
      act(() => fakes.engine.forceState(STATE[kind]));
      seen.push(view.result.current.shutter);
    }
    expect(seen).toEqual([true, true, true, false]);
  });
});
