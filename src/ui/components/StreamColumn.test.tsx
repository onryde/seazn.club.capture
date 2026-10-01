import { act, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HOLD_MS } from '@/hooks/useHold';
import type { Peek } from '@/hooks/usePeek';
import type { Viewfinder } from '@/hooks/useViewfinder';
import { StreamColumn } from '@/ui/components/StreamColumn';
import { pressIn } from '../../../test/press';
import { renderWithPorts } from '../../../test/renderWithPorts';

const PEEK: Peek = { showing: false, mounted: false, pressIn: vi.fn(), pressOut: vi.fn() };
const GREEN = { code: true, camera: true, network: true, sound: true };

/** A hand-built projection, so the column's own gates are tested apart from the hooks'. */
const viewOf = (overrides: Partial<Viewfinder>): Viewfinder => ({
  kind: 'armed',
  plate: 'ready',
  statusKey: 'stream.status.ready',
  holdRemaining: null,
  holdWindow: null,
  preflight: GREEN,
  blocker: null,
  reason: null,
  goLiveBy: null,
  action: 'goLive',
  onAir: false,
  peekable: false,
  replacing: false,
  start: vi.fn(),
  stop: vi.fn(),
  ...overrides,
});

const goLive = () => screen.getByRole('button', { name: 'Go live. Press and hold for 3 seconds.' });

describe('StreamColumn’s Go live', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('starts after the hold when armed with nothing blocking', () => {
    const view = viewOf({});
    renderWithPorts(
      <StreamColumn view={view} blocked={false} peek={PEEK} onScanAnother={vi.fn()} />,
    );
    pressIn(goLive());
    act(() => vi.advanceTimersByTime(HOLD_MS));
    expect(view.start).toHaveBeenCalledTimes(1);
  });

  // Not reachable through the engine today (idle has no camera of ours), so
  // pinned here: the column never offers Go live before the engine is armed.
  it('stays off before the engine is armed, even with every chip green', () => {
    const view = viewOf({ kind: 'idle', plate: 'starting' });
    renderWithPorts(
      <StreamColumn view={view} blocked={false} peek={PEEK} onScanAnother={vi.fn()} />,
    );
    pressIn(goLive());
    act(() => vi.advanceTimersByTime(HOLD_MS));
    expect(view.start).not.toHaveBeenCalled();
  });

  it('says the code reason it is given, and only once armed', () => {
    const reason = 'stream.blocker.noDetails' as const;
    const blocked = { blocker: 'code', reason, preflight: { ...GREEN, code: false } } as const;
    const { rerender } = renderWithPorts(
      <StreamColumn view={viewOf(blocked)} blocked={false} peek={PEEK} onScanAnother={vi.fn()} />,
    );
    expect(screen.getByText('No session details')).toBeTruthy();
    rerender(
      <StreamColumn
        view={viewOf({ ...blocked, kind: 'idle' })}
        blocked={false}
        peek={PEEK}
        onScanAnother={vi.fn()}
      />,
    );
    expect(screen.queryByText('No session details')).toBeNull();
  });
});
