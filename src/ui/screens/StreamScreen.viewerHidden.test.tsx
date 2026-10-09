import { act, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import en from '@/i18n/en.json';
import es from '@/i18n/es.json';
import fr from '@/i18n/fr.json';
import nl from '@/i18n/nl.json';
import { FEATURES } from '@/ui/features';
import { readRecord } from '../../../test/fakePorts';
import { renderViewfinder } from '../../../test/renderViewfinder';

/** How often the view's two hooks ran: `useViewerCheck` (the screen's) and `useViewerFeed` (the camera box's). */
const ran = vi.hoisted(() => ({ check: 0, feed: 0 }));

vi.mock('@/hooks/useViewerCheck', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/hooks/useViewerCheck')>();
  return {
    ...actual,
    useViewerCheck: (...args: Parameters<typeof actual.useViewerCheck>) => {
      ran.check += 1;
      return actual.useViewerCheck(...args);
    },
  };
});
vi.mock('@/hooks/useViewerFeed', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/hooks/useViewerFeed')>();
  return {
    ...actual,
    useViewerFeed: (...args: Parameters<typeof actual.useViewerFeed>) => {
      ran.feed += 1;
      return actual.useViewerFeed(...args);
    },
  };
});

type View = Awaited<ReturnType<typeof renderViewfinder>>;

const byId = (id: string) => screen.getByTestId(id);
/** The accessible names of the buttons in a row, in order: an icon button has no text, only its label. */
const buttonNames = (row: HTMLElement) =>
  within(row)
    .getAllByRole('button')
    .map((button) => button.getAttribute('aria-label') ?? button.textContent);
const message = () => within(byId('status-strip')).getByTestId('strip-message').textContent;
/** Every record line the view's two hooks write: `viewer.*` (the view's states) and `peek.*` (the feed's). */
const viewLines = (view: View) =>
  readRecord(view.record).filter(
    (entry) => entry.event.startsWith('viewer.') || entry.event.startsWith('peek.'),
  );

/** A broadcast the view could play: live, with a playback URL, on a phone with nothing to warn about. */
async function onAir(setup: { viewerCheck?: boolean } = {}) {
  const view = await renderViewfinder({}, { quiet: true, ...setup });
  act(() => view.engine.scene('live'));
  // Anti-vacuity: the snapshot carries the picture the cell would offer, so its absence is the switch's doing.
  expect(view.engine.getSnapshot().broadcast?.playbackUrl).toBeTruthy();
  return view;
}

/** Everything that would open, time or close the view: the clock, the ladder, the background and the end. */
function driveTheBroadcast(view: View) {
  act(() => vi.advanceTimersByTime(30_000));
  act(() => view.engine.patch({ shed: 'viewer-feed' }));
  act(() => view.engine.patch({ shed: null }));
  act(() => view.foreground.leave());
  act(() => view.foreground.fire());
  act(() => vi.advanceTimersByTime(30_000));
  act(() => view.engine.scene('stopped'));
}

// The owner's ruling, 2026-10-09: "can we hide the what's viewer see? and keep all code and just hide button then when
// later stage like when org reqeust we can implemnt". The shipped value is the spec under test here, so these tests
// render the screen as the route does, reading the switch, and never pass it.
describe('What viewers see, as shipped: hidden (owner ruling, 2026-10-09)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    ran.check = 0;
    ran.feed = 0;
  });
  afterEach(() => vi.useRealTimers());

  it('ships with the switch off', () => {
    expect(FEATURES.viewerCheck).toBe(false);
  });

  it('on air with a viewer picture, the icon row is Settings, Take photo and Remote scoring, and no cell for the view', async () => {
    await onAir();
    expect(buttonNames(byId('icon-row'))).toEqual([
      en['stream.link.settings'],
      en['stream.photo.label'],
      en['stream.scoring.open'],
    ]);
    expect(screen.queryByRole('button', { name: en['stream.peek.label'] })).toBeNull();
    expect(screen.queryByTestId('peek-cell')).toBeNull();
    expect(screen.queryByText(en['stream.peek.unavailable'])).toBeNull();
  });

  // The decision the three-cell row needed (final-fix brief A.2): the viewers' cell was the one that flexed, to end the
  // row. With it gone NO cell flexes: the three 48 dp buttons pack from the start, as the four do before air.
  it('lets no cell of the on-air row flex: three 48 dp buttons from the start, as before air', async () => {
    await onAir();
    const row = byId('icon-row');
    const cells = [...row.children].map((cell) => {
      const style = getComputedStyle(cell);
      return [style.flexGrow, style.width];
    });
    expect(cells).toEqual([
      ['0', '48px'],
      ['0', '48px'],
      ['0', '48px'],
    ]);
    expect(getComputedStyle(row).justifyContent).toBe('normal');
  });

  it('with no viewer picture either, there is no cell and no reason', async () => {
    await renderViewfinder(
      {},
      {
        engine: 'idle',
        prepare: (fakes) =>
          fakes.engine.forceState({ kind: 'publishing', transport: 'srt', sinceEpochMs: 1 }),
      },
    );
    expect(screen.queryByTestId('peek-cell')).toBeNull();
    expect(screen.queryByText(en['stream.peek.unavailable'])).toBeNull();
  });

  it('mounts nothing of the view through a whole broadcast: no cover, no player, neither hook, no record line', async () => {
    const view = await onAir();
    driveTheBroadcast(view);
    expect(screen.queryByTestId('viewer-cover')).toBeNull();
    expect(screen.queryByTestId('viewer-video')).toBeNull();
    expect(ran).toEqual({ check: 0, feed: 0 });
    expect(viewLines(view)).toEqual([]);
  });

  // The positive pair: the same broadcast with the view built in runs both hooks and writes the feed's first line, so
  // the counts and the record above can see the view when it is there.
  it('the same broadcast with the switch on runs both hooks and writes the feed’s lines', async () => {
    const view = await onAir({ viewerCheck: true });
    driveTheBroadcast(view);
    expect(ran.check).toBeGreaterThan(0);
    expect(ran.feed).toBeGreaterThan(0);
    expect(viewLines(view).map((entry) => entry.event)).toContain('peek.state');
  });
});

// The heat caption with the view hidden (controller's ruling implementing the owner's, 2026-10-09; final review m2):
// it must not name the hidden view, and it must be true in every state native sends `shed` in, which is from Armed on
// (Projection.kt:29). It says "still live" only beside a LIVE plate (Publishing). Before air it says the heat alone.
describe('the heat caption with What viewers see hidden', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('is the controller’s words in en, and names no view', () => {
    expect(en['stream.advisory.hotLive']).toBe('Phone hot · still live');
    expect(en['stream.advisory.hot']).toBe('Phone hot');
    for (const text of [en['stream.advisory.hotLive'], en['stream.advisory.hot']]) {
      expect(text).not.toMatch(/viewer/i);
    }
  });

  it('live, the plate LIVE: "Phone hot · still live", over the live line', async () => {
    const view = await renderViewfinder({}, { quiet: true });
    act(() => view.engine.scene('shed'));
    expect(byId('tally-plate').textContent).toBe(en['stream.tally.live']);
    expect(message()).toBe(en['stream.advisory.hotLive']);
    expect(screen.queryByText(en['stream.advisory.shed'])).toBeNull();
  });

  it.each([
    ['Armed, the organiser’s start', { kind: 'armed', cause: 'organiser', notReady: null }],
    ['Connecting', { kind: 'connecting', transport: 'srt' }],
  ] as const)('before air, %s: "Phone hot", and never "still live"', async (_name, state) => {
    const view = await renderViewfinder({}, { quiet: true });
    act(() => view.engine.forceState(state));
    act(() => view.engine.patch({ shed: 'viewer-feed' }));
    expect(byId('tally-plate').textContent).toBe(en['stream.tally.connecting']);
    expect(message()).toBe(en['stream.advisory.hot']);
    expect(screen.queryByText(en['stream.advisory.hotLive'])).toBeNull();
  });

  it.each([
    ['es', es],
    ['fr', fr],
    ['nl', nl],
  ] as const)('%s: the live caption and the before-air one', async (lang, d) => {
    const view = await renderViewfinder({ deviceLanguages: [lang] }, { quiet: true });
    act(() => view.engine.scene('shed'));
    expect(message()).toBe(d['stream.advisory.hotLive']);
    act(() => view.engine.forceState({ kind: 'connecting', transport: 'srt' }));
    act(() => view.engine.patch({ shed: 'viewer-feed' }));
    expect(message()).toBe(d['stream.advisory.hot']);
  });

  it('with the switch on, the caption is the spec’s, unchanged', async () => {
    const view = await renderViewfinder({}, { quiet: true, viewerCheck: true });
    act(() => view.engine.scene('shed'));
    expect(message()).toBe(en['stream.advisory.shed']);
  });
});
