import { act, fireEvent, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HOLD_MS } from '@/hooks/useHold';
import type { Peek } from '@/hooks/usePeek';
import type { Viewfinder } from '@/hooks/useViewfinder';
import { StreamColumn } from '@/ui/components/StreamColumn';
import { pressIn } from '../../../test/press';
import { renderWithPorts } from '../../../test/renderWithPorts';

const PEEK: Peek = { showing: false, mounted: false, pressIn: vi.fn(), pressOut: vi.fn() };
const GREEN = { camera: true, network: true, sound: true };
/** What StreamScreen hands the icon row; these tests are of the column's own gates, not of leaving. */
const ICONS = {
  canLeave: true,
  onHome: vi.fn(),
  onSettings: vi.fn(),
} as const;

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
    renderWithPorts(<StreamColumn view={view} {...ICONS} peek={PEEK} onScanAnother={vi.fn()} />);
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
      renderWithPorts(<StreamColumn view={view} {...ICONS} peek={PEEK} onScanAnother={vi.fn()} />);
      pressIn(goLive());
      act(() => vi.advanceTimersByTime(HOLD_MS));
      expect(view.start).not.toHaveBeenCalled();
    },
  );

  // A3: Stop ends the broadcast and the pairing, and its label says so.
  // Owner decision 1 (2026-10-05): Stop unpairs only once live; before, it says it stops, and nothing more.
  it('labels Stop for a screen reader as stopping and unpairing once live, as stopping before; Go live keeps its own', () => {
    const { rerender } = renderWithPorts(
      <StreamColumn view={viewOf({})} {...ICONS} peek={PEEK} onScanAnother={vi.fn()} />,
    );
    expect(goLive()).toBeTruthy();
    rerender(
      <StreamColumn
        view={viewOf({ kind: 'connecting', action: 'stop', onAir: true, plate: 'connecting' })}
        {...ICONS}
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
        {...ICONS}
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
      <StreamColumn view={viewOf(blocked)} {...ICONS} peek={PEEK} onScanAnother={vi.fn()} />,
    );
    expect(screen.getByText('Mic not available')).toBeTruthy();
    rerender(
      <StreamColumn
        view={viewOf({ ...blocked, kind: 'pairing' })}
        {...ICONS}
        peek={PEEK}
        onScanAnother={vi.fn()}
      />,
    );
    expect(screen.queryByText('Mic not available')).toBeNull();
  });
});

describe('StreamColumn’s icon row (spec §3)', () => {
  const column = (canLeave: boolean, onSettings: () => void, onHome: () => void) => (
    <StreamColumn
      view={viewOf({})}
      canLeave={canLeave}
      onHome={onHome}
      onSettings={onSettings}
      peek={PEEK}
      onScanAnother={vi.fn()}
    />
  );

  it('presses Settings and Home each to its own handler, and offers Home only while leaving is allowed', () => {
    const onSettings = vi.fn();
    const onHome = vi.fn();
    const { rerender } = renderWithPorts(column(true, onSettings, onHome));
    fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
    expect(onSettings).toHaveBeenCalledTimes(1);
    expect(onHome).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Home' }));
    expect(onHome).toHaveBeenCalledTimes(1);
    expect(onSettings).toHaveBeenCalledTimes(1);
    // Leaving is not allowed: Home goes and Settings stays, so the absence is not an empty row.
    rerender(column(false, onSettings, onHome));
    expect(screen.queryByRole('button', { name: 'Home' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Settings' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Diagnostics' })).toBeNull();
  });
});
