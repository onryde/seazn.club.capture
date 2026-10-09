import { act, fireEvent, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HOLD_MS } from '@/hooks/useHold';
import type { ViewerCheckView } from '@/hooks/useViewerCheck';
import type { Viewfinder } from '@/hooks/useViewfinder';
import en from '@/i18n/en.json';
import { StreamColumn } from '@/ui/components/StreamColumn';
import { pressIn } from '../../../test/press';
import { renderWithPorts } from '../../../test/renderWithPorts';

const VIEWER: ViewerCheckView = {
  kind: 'idle',
  toggle: vi.fn(),
  close: vi.fn(),
  firstFrame: vi.fn(),
};
const GREEN = { camera: true, network: true, sound: true };
/** What StreamScreen hands the icon row; these tests are of the column's own gates, not of leaving. */
const ICONS = {
  canLeave: true,
  onHome: vi.fn(),
  onSettings: vi.fn(),
  onScoringLink: vi.fn(),
  scoringOpen: false,
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
  shutter: false,
  scoring: false,
  peekable: false,
  shed: false,
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
    renderWithPorts(<StreamColumn view={view} {...ICONS} viewer={VIEWER} />);
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
      renderWithPorts(<StreamColumn view={view} {...ICONS} viewer={VIEWER} />);
      pressIn(goLive());
      act(() => vi.advanceTimersByTime(HOLD_MS));
      expect(view.start).not.toHaveBeenCalled();
    },
  );

  // A3: Stop ends the broadcast and the pairing, and its label says so.
  // Owner decision 1 (2026-10-05): Stop unpairs only once live; before, it says it stops, and nothing more.
  it('labels Stop for a screen reader as stopping and unpairing once live, as stopping before; Go live keeps its own', () => {
    const { rerender } = renderWithPorts(
      <StreamColumn view={viewOf({})} {...ICONS} viewer={VIEWER} />,
    );
    expect(goLive()).toBeTruthy();
    rerender(
      <StreamColumn
        view={viewOf({ kind: 'connecting', action: 'stop', onAir: true, plate: 'connecting' })}
        {...ICONS}
        viewer={VIEWER}
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
        viewer={VIEWER}
      />,
    );
    expect(screen.getByRole('button', { name: 'Hold to stop and unpair' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Hold to stop' })).toBeNull();
    expect(screen.queryByRole('button', { name: /^Stop\. Press and hold/ })).toBeNull();
  });

  // Spec §5: an Ended is the one frame before the viewfinder leaves for Home. It offers no hold control, neither
  // Go live nor Stop (nor the old Scan another); its positive pair is the 'goLive' column above.
  it('offers no hold control when the action is none', () => {
    renderWithPorts(
      <StreamColumn
        view={viewOf({ kind: 'ended', action: 'none', plate: 'ended' })}
        {...ICONS}
        viewer={VIEWER}
      />,
    );
    expect(screen.queryByRole('button', { name: /Press and hold|Hold to stop/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Scan another/ })).toBeNull();
    expect(screen.getByRole('button', { name: 'Settings' })).toBeTruthy();
  });

  it('says the reason it is given, and only once paired', () => {
    const reason = 'stream.blocker.sound' as const;
    const blocked = { blocker: 'sound', reason, preflight: { ...GREEN, sound: false } } as const;
    const { rerender } = renderWithPorts(
      <StreamColumn view={viewOf(blocked)} {...ICONS} viewer={VIEWER} />,
    );
    expect(screen.getByText('Mic not available')).toBeTruthy();
    rerender(
      <StreamColumn view={viewOf({ ...blocked, kind: 'pairing' })} {...ICONS} viewer={VIEWER} />,
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
      onScoringLink={vi.fn()}
      scoringOpen={false}
      viewer={VIEWER}
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

  /** The icon row's accessible names, in order (an icon button has no text, only its label). */
  const rowNames = () =>
    within(screen.getByTestId('icon-row'))
      .getAllByRole('button')
      .map((button) => button.getAttribute('aria-label') ?? button.textContent);

  it('offers Remote scoring only while a pairing is held, presses onScoringLink once and nothing else, and keeps Settings either way', () => {
    const onScoringLink = vi.fn();
    const onSettings = vi.fn();
    const onHome = vi.fn();
    const handlers = { ...ICONS, onScoringLink, onSettings, onHome };
    const { rerender } = renderWithPorts(
      <StreamColumn view={viewOf({ scoring: true })} {...handlers} viewer={VIEWER} />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Remote scoring' }));
    expect(onScoringLink).toHaveBeenCalledTimes(1);
    expect(onSettings).not.toHaveBeenCalled();
    expect(onHome).not.toHaveBeenCalled();
    // No pairing held: the button goes and Settings stays, so the absence is not an empty row.
    rerender(<StreamColumn view={viewOf({ scoring: false })} {...handlers} viewer={VIEWER} />);
    expect(screen.queryByRole('button', { name: 'Remote scoring' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Settings' })).toBeTruthy();
  });

  it('before air it is the last of the row, after Take photo', () => {
    renderWithPorts(
      <StreamColumn view={viewOf({ scoring: true, shutter: true })} {...ICONS} viewer={VIEWER} />,
    );
    expect(rowNames()).toEqual(['Settings', 'Home', 'Take photo', 'Remote scoring']);
  });

  it('on air it follows Take photo and leads What viewers see, and Home is not offered (leaving is not allowed on air)', () => {
    renderWithPorts(
      <StreamColumn
        view={viewOf({ onAir: true, action: 'stop', scoring: true, shutter: true })}
        {...ICONS}
        canLeave={false}
        viewer={VIEWER}
      />,
    );
    expect(rowNames()).toEqual(['Settings', 'Take photo', 'Remote scoring', 'What viewers see']);
  });

  // B5: the button is pressed in while its panel shows, and only that button.
  it('marks Remote scoring selected while its panel is open, unselected when it is not, and no other button either way', () => {
    const scoringButton = () => screen.getByRole('button', { name: 'Remote scoring' });
    const { rerender } = renderWithPorts(
      <StreamColumn
        view={viewOf({ scoring: true, shutter: true })}
        {...ICONS}
        scoringOpen
        viewer={VIEWER}
      />,
    );
    expect(scoringButton().getAttribute('aria-selected')).toBe('true');
    const others = () =>
      screen
        .getAllByRole('button')
        .filter((button) => button.getAttribute('aria-label') !== 'Remote scoring')
        .map((button) => button.getAttribute('aria-selected'));
    expect(others().length).toBeGreaterThan(0);
    expect(others().every((state) => state === null)).toBe(true);
    rerender(
      <StreamColumn
        view={viewOf({ scoring: true, shutter: true })}
        {...ICONS}
        scoringOpen={false}
        viewer={VIEWER}
      />,
    );
    expect(scoringButton().getAttribute('aria-selected')).toBe('false');
    expect(others().every((state) => state === null)).toBe(true);
  });
});

describe('the peek cell’s reasons (D2 §4.2, carry 13)', () => {
  it('says the phone is hot when the ladder shed, ahead of no picture', () => {
    const view = viewOf({
      kind: 'publishing',
      action: 'stop',
      onAir: true,
      plate: 'live',
      peekable: false,
      shed: true,
    });
    renderWithPorts(<StreamColumn view={view} {...ICONS} viewer={VIEWER} />);
    expect(screen.getByText(en['stream.peek.hot'])).toBeTruthy();
    expect(screen.queryByText(en['stream.peek.unavailable'])).toBeNull();
  });

  it('says the phone is hot with the picture there too, and the peek is off', () => {
    const view = viewOf({
      kind: 'publishing',
      action: 'stop',
      onAir: true,
      plate: 'live',
      peekable: true,
      shed: true,
    });
    renderWithPorts(<StreamColumn view={view} {...ICONS} viewer={VIEWER} />);
    expect(screen.getByText(en['stream.peek.hot'])).toBeTruthy();
    expect(
      screen.getByRole('button', { name: en['stream.peek.label'] }).getAttribute('aria-disabled'),
    ).toBe('true');
  });

  it('says there is no viewer picture on air with no playback URL', () => {
    const view = viewOf({
      kind: 'publishing',
      action: 'stop',
      onAir: true,
      plate: 'live',
      peekable: false,
    });
    renderWithPorts(<StreamColumn view={view} {...ICONS} viewer={VIEWER} />);
    expect(screen.getByText(en['stream.peek.unavailable'])).toBeTruthy();
  });

  it('gives no reason, and reads selected, while the view is open', () => {
    const view = viewOf({
      kind: 'publishing',
      action: 'stop',
      onAir: true,
      plate: 'live',
      peekable: true,
    });
    renderWithPorts(
      <StreamColumn view={view} {...ICONS} viewer={{ ...VIEWER, kind: 'showing' }} />,
    );
    const peek = screen.getByRole('button', { name: en['stream.peek.label'] });
    expect(peek.getAttribute('aria-selected')).toBe('true');
    expect(peek.getAttribute('aria-disabled')).toBeNull();
    expect(screen.queryByText(en['stream.peek.hot'])).toBeNull();
    expect(screen.queryByText(en['stream.peek.unavailable'])).toBeNull();
  });
});
