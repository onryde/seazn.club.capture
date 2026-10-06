import { act, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HOLD_MS } from '@/hooks/useHold';
import type { Peek } from '@/hooks/usePeek';
import type { Viewfinder } from '@/hooks/useViewfinder';
import { StreamColumn } from '@/ui/components/StreamColumn';
import { pressIn } from '../../../test/press';
import { renderWithPorts } from '../../../test/renderWithPorts';

const PEEK: Peek = { showing: false, mounted: false, pressIn: vi.fn(), pressOut: vi.fn() };
const GREEN = { camera: true, network: true, sound: true };

/** A hand-built projection, so the column's own gates are tested apart from the hooks'. */
const viewOf = (overrides: Partial<Viewfinder>): Viewfinder => ({
  kind: 'paired',
  plate: 'ready',
  statusKey: 'stream.status.waitingGoLive',
  holdRemaining: null,
  holdWindow: null,
  preflight: GREEN,
  blocker: null,
  reason: null,
  action: 'goLive',
  stopUnpairs: false,
  onAir: false,
  peekable: false,
  startsAt: null,
  auto: false,
  destination: 'YouTube · Fake CC',
  start: vi.fn(),
  stop: vi.fn(),
  ...overrides,
});

const goLive = () => screen.getByRole('button', { name: 'Go live. Press and hold for 3 seconds.' });

describe('StreamColumn’s Go live', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('starts after the hold when paired with nothing blocking', () => {
    const view = viewOf({});
    renderWithPorts(
      <StreamColumn view={view} blocked={false} peek={PEEK} onScanAnother={vi.fn()} />,
    );
    pressIn(goLive());
    act(() => vi.advanceTimersByTime(HOLD_MS));
    expect(view.start).toHaveBeenCalledTimes(1);
  });

  // Not reachable through the engine today (idle and pairing have no camera
  // of ours ready), so pinned here: the column never offers Go live before the
  // engine is paired, since native refuses a start that is not.
  it.each(['idle', 'pairing'] as const)(
    'stays off while the engine is %s, even with every chip green',
    (kind) => {
      const view = viewOf({ kind, plate: 'starting' });
      renderWithPorts(
        <StreamColumn view={view} blocked={false} peek={PEEK} onScanAnother={vi.fn()} />,
      );
      pressIn(goLive());
      act(() => vi.advanceTimersByTime(HOLD_MS));
      expect(view.start).not.toHaveBeenCalled();
    },
  );

  it('fills the waiting line with the destination it is given, cut at 24', () => {
    renderWithPorts(
      <StreamColumn
        view={viewOf({ destination: 'YouTube · A Very Long Club Name CC' })}
        blocked={false}
        peek={PEEK}
        onScanAnother={vi.fn()}
      />,
    );
    // en['stream.status.waitingGoLive'] with PV29's cut name written out by hand.
    expect(screen.getByText('Waiting for Go live · YouTube · A Very Long C…')).toBeTruthy();
  });

  // A3: Stop ends the broadcast and the pairing, and its label says so.
  // Owner decision 1 (2026-10-05): Stop unpairs only once live; before, it says it stops, and nothing more.
  it('labels Stop for a screen reader as stopping and unpairing once live, as stopping before; Go live keeps its own', () => {
    const { rerender } = renderWithPorts(
      <StreamColumn view={viewOf({})} blocked={false} peek={PEEK} onScanAnother={vi.fn()} />,
    );
    expect(goLive()).toBeTruthy();
    rerender(
      <StreamColumn
        view={viewOf({ kind: 'connecting', action: 'stop', onAir: true, plate: 'connecting' })}
        blocked={false}
        peek={PEEK}
        onScanAnother={vi.fn()}
      />,
    );
    expect(screen.getByRole('button', { name: 'Hold to stop' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Hold to stop and unpair' })).toBeNull();
    rerender(
      <StreamColumn
        view={viewOf({
          kind: 'publishing',
          action: 'stop',
          stopUnpairs: true,
          onAir: true,
          plate: 'live',
        })}
        blocked={false}
        peek={PEEK}
        onScanAnother={vi.fn()}
      />,
    );
    expect(screen.getByRole('button', { name: 'Hold to stop and unpair' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Hold to stop' })).toBeNull();
    expect(screen.queryByRole('button', { name: /^Stop\. Press and hold/ })).toBeNull();
  });

  it('says the reason it is given, and only once paired', () => {
    const reason = 'stream.blocker.sound' as const;
    const blocked = { blocker: 'sound', reason, preflight: { ...GREEN, sound: false } } as const;
    const { rerender } = renderWithPorts(
      <StreamColumn view={viewOf(blocked)} blocked={false} peek={PEEK} onScanAnother={vi.fn()} />,
    );
    expect(screen.getByText('No sound')).toBeTruthy();
    rerender(
      <StreamColumn
        view={viewOf({ ...blocked, kind: 'pairing' })}
        blocked={false}
        peek={PEEK}
        onScanAnother={vi.fn()}
      />,
    );
    expect(screen.queryByText('No sound')).toBeNull();
  });
});
