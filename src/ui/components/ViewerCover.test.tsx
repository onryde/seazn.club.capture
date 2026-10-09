import { act, fireEvent, render, screen, within } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ViewerCheck } from '@/domain/session/viewerCheck';
import type { Feed } from '@/domain/session/viewerFeed';
import type { ViewerFeed } from '@/hooks/useViewerFeed';
import en from '@/i18n/en.json';
import type { VideoStatus } from '@/services/surfaces';
import { ViewerCover } from '@/ui/components/ViewerCover';
import { createFakePorts } from '../../../test/fakePorts';
import { wrapperFor } from '../../../test/renderWithPorts';

type Open = Exclude<ViewerCheck['kind'], 'idle'>;

const fill = (text: string, seconds: number) => text.replace('{seconds}', String(seconds));
const note = () => screen.queryByTestId('viewer-note')?.textContent ?? null;
const video = () => screen.queryByTestId('viewer-video');
const NONE = en['stream.peek.unavailable'];
const HIDE = en['stream.scoring.hide'];
const box = () => screen.getByTestId('viewer-cover');

/**
 * The props each Pressable is handed. react-native-web drops `accessible` (it is not in its `forwardedProps`), and on
 * Android a Pressable is accessible unless told otherwise (react-native 0.86.3, Pressable.js:252), which groups its
 * children under one focus. What the cover hands its Pressables is what TalkBack is given; what it speaks is a
 * device check.
 */
const handed = vi.hoisted(() => [] as Record<string, unknown>[]);
vi.mock('react-native', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-native')>();
  const { createElement } = await import('react');
  return {
    ...actual,
    Pressable: (props: ComponentProps<typeof actual.Pressable>) => {
      handed.push(props as Record<string, unknown>);
      return createElement(actual.Pressable, props);
    },
  };
});

/** The cover alone, on air (a playback URL to play), with its owner's two handlers as spies. */
function cover(kind: Open, feed: Feed) {
  const fakes = createFakePorts();
  fakes.engine.scene('live');
  const onClose = vi.fn();
  const onFirstFrame = vi.fn();
  const reported: VideoStatus[] = [];
  const viewers: ViewerFeed = {
    feed,
    attempt: 0,
    onStatus: (status) => reported.push(status),
  };
  const view = render(
    <ViewerCover kind={kind} feed={viewers} onClose={onClose} onFirstFrame={onFirstFrame} />,
    { wrapper: wrapperFor(fakes) },
  );
  return { ...fakes, ...view, onClose, onFirstFrame, reported };
}

/** The cover by itself (D2 §4.3): its owner, useViewerCheck, decides when it opens and closes. */
describe('ViewerCover', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('loading counts down from 5 s, a second at a time, and never below 1 however long it is kept', () => {
    cover('loading', 'waiting');
    expect(note()).toBe(fill(en['stream.peek.loading'], 5));
    act(() => vi.advanceTimersByTime(1_000));
    expect(note()).toBe(fill(en['stream.peek.loading'], 4));
    act(() => vi.advanceTimersByTime(3_000));
    expect(note()).toBe(fill(en['stream.peek.loading'], 1));
    // The owner's timer closes the phase as the last second ends; kept longer, the cover still never says 0.
    act(() => vi.advanceTimersByTime(3_000));
    expect(note()).toBe(fill(en['stream.peek.loading'], 1));
  });

  it('showing counts down from 20 s in its corner, with no line over the picture', () => {
    cover('showing', 'playing');
    expect(screen.getByText(fill(en['stream.peek.closesIn'], 20))).toBeTruthy();
    act(() => vi.advanceTimersByTime(1_000));
    expect(screen.getByText(fill(en['stream.peek.closesIn'], 19))).toBeTruthy();
    expect(note()).toBeNull();
    expect(video()).not.toBeNull();
  });

  it('passes every player status to the feed, and tells its owner of the first frame on ready only', () => {
    const view = cover('loading', 'playing');
    for (const status of ['loading', 'failed'] as const)
      act(() => view.surfaces.videoStatus(status));
    expect(view.onFirstFrame).not.toHaveBeenCalled();
    act(() => view.surfaces.videoStatus('ready'));
    expect(view.onFirstFrame).toHaveBeenCalledTimes(1);
    expect(view.reported).toEqual(['loading', 'failed', 'ready']);
  });

  /**
   * What the middle of the box says, by phase and feed (D2 §4.3): loading is its countdown whatever the feed; showing
   * says there is no picture when there is nothing to play, and nothing over a playing feed (one quiet retry); a feed of
   * `none` is the air going, and the cover closes in the next render, so it draws no line for that one (M53).
   */
  it.each([
    ['loading', 'none', fill(en['stream.peek.loading'], 5)],
    ['loading', 'waiting', fill(en['stream.peek.loading'], 5)],
    ['loading', 'unavailable', fill(en['stream.peek.loading'], 5)],
    ['loading', 'playing', fill(en['stream.peek.loading'], 5)],
    ['showing', 'none', null],
    ['showing', 'waiting', NONE],
    ['showing', 'unavailable', NONE],
    ['showing', 'playing', null],
    ['notReady', 'playing', en['stream.peek.notReady']],
    ['notReady', 'unavailable', en['stream.peek.notReady']],
  ] as const)('%s with the feed %s: the line is %j', (kind, feed, line) => {
    cover(kind, feed);
    expect(note()).toBe(line);
  });

  it('draws the player only while the feed plays, and never once the view says it is not ready', () => {
    const rows = [
      ['loading', 'playing', true],
      ['loading', 'waiting', false],
      ['showing', 'unavailable', false],
      ['notReady', 'playing', false],
    ] as const;
    for (const [kind, feed, drawn] of rows) {
      const view = cover(kind, feed);
      expect({ kind, feed, drawn: video() !== null }).toEqual({ kind, feed, drawn });
      view.unmount();
    }
  });

  it('carries the honest line while loading and showing, and not on the not-ready line', () => {
    const rows = [
      ['loading', true],
      ['showing', true],
      ['notReady', false],
    ] as const;
    for (const [kind, honest] of rows) {
      const view = cover(kind, 'playing');
      const said = screen.queryByText(en['stream.peek.honest']) !== null;
      expect({ kind, honest: said }).toEqual({ kind, honest });
      view.unmount();
    }
  });

  it('closes on one tap anywhere on the box', () => {
    const view = cover('showing', 'playing');
    fireEvent.click(box());
    expect(view.onClose).toHaveBeenCalledTimes(1);
  });

  it('sets the loading countdown in tabular figures, so its digit does not twitch (AGENTS §5)', () => {
    cover('loading', 'waiting');
    const line = screen.getByText(fill(en['stream.peek.loading'], 5));
    expect(getComputedStyle(line).fontVariant).toBe('tabular-nums');
  });

  /** Spec §4.3: the view closes on a tap on the box or on Hide, the word the Remote scoring panel uses for its own. */
  it.each(['loading', 'showing', 'notReady'] as const)(
    '%s: draws Hide, the cover’s one button, and Hide closes the view',
    (kind) => {
      const view = cover(kind, 'playing');
      const hide = screen.getByRole('button', { name: HIDE });
      expect(within(hide).getByText(HIDE)).toBeTruthy();
      expect(screen.getAllByRole('button')).toHaveLength(1);
      fireEvent.click(hide);
      expect(view.onClose).toHaveBeenCalledTimes(1);
    },
  );

  it('hands TalkBack the lines and a named Hide: the box itself is not one accessible element', () => {
    handed.length = 0;
    cover('loading', 'waiting');
    const boxProps = handed.filter((props) => props.testID === 'viewer-cover').at(-1);
    expect(boxProps).toMatchObject({ accessible: false });
    expect(boxProps?.accessibilityLabel).toBeUndefined();
    expect(boxProps?.accessibilityRole).toBeUndefined();
    const hideProps = handed.filter((props) => props.accessibilityLabel === HIDE).at(-1);
    expect(hideProps).toMatchObject({ accessibilityRole: 'button', accessibilityLabel: HIDE });
    // In the DOM too: the box names nothing, and the lines are not inside the button.
    expect(box().getAttribute('aria-label')).toBeNull();
    expect(box().getAttribute('role')).toBeNull();
    const hide = screen.getByRole('button', { name: HIDE });
    expect(hide.contains(screen.getByText(fill(en['stream.peek.loading'], 5)))).toBe(false);
    expect(hide.contains(screen.getByText(en['stream.peek.honest']))).toBe(false);
  });
});
