import { act, fireEvent, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import en from '@/i18n/en.json';
import es from '@/i18n/es.json';
import fr from '@/i18n/fr.json';
import nl from '@/i18n/nl.json';
import { readRecord } from '../../../test/fakePorts';
import { renderViewfinder } from '../../../test/renderViewfinder';

const peek = (label = en['stream.peek.label']) => screen.getByRole('button', { name: label });
const cover = () => screen.queryByTestId('viewer-cover');
const video = () => screen.queryByTestId('viewer-video');
const fill = (text: string, seconds: number) => text.replace('{seconds}', String(seconds));

type View = Awaited<ReturnType<typeof renderViewfinder>>;

/** On air, on a phone with nothing to warn about. */
async function onAir(options: Parameters<typeof renderViewfinder>[0] = {}) {
  const view = await renderViewfinder(options, { quiet: true });
  act(() => view.engine.scene('live'));
  return view;
}

/**
 * Ledger P7: the phone's clock (and the fake engine's, which stamps its reports) moves with the timers, so each wait
 * below is the spec's and a 3 s phase after a 5 s one lasts 3. One phase per call: React renders an act's updates as
 * it exits, and the next phase's timer is set then.
 */
function advance(view: View, ms: number) {
  view.setNow(new Date(view.ports.clock().getTime() + ms));
  act(() => vi.advanceTimersByTime(ms));
}

describe('What viewers see on the viewfinder (D2 §4.3)', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('a tap: a 5 s countdown, the picture with its honest line, 20 s from the first frame, then closed and unmounted', async () => {
    const view = await onAir();
    fireEvent.click(peek());
    expect(cover()).not.toBeNull();
    expect(screen.getByText(fill(en['stream.peek.loading'], 5))).toBeTruthy();
    expect(screen.getByText(en['stream.peek.honest'])).toBeTruthy();
    advance(view, 1_000);
    expect(screen.getByText(fill(en['stream.peek.loading'], 4))).toBeTruthy();
    act(() => view.surfaces.videoStatus('ready'));
    expect(screen.getByText(fill(en['stream.peek.closesIn'], 20))).toBeTruthy();
    expect(screen.getByText(en['stream.peek.honest'])).toBeTruthy();
    advance(view, 19_999);
    expect(video()).not.toBeNull();
    advance(view, 1);
    expect(cover()).toBeNull();
    expect(video()).toBeNull();
  });

  it('no picture in 5 s: the honest not-ready line for 3 s, then closed', async () => {
    const view = await onAir();
    fireEvent.click(peek());
    advance(view, 4_999);
    expect(screen.queryByText(en['stream.peek.notReady'])).toBeNull();
    advance(view, 1);
    expect(screen.getByText(en['stream.peek.notReady'])).toBeTruthy();
    expect(video()).toBeNull();
    advance(view, 2_999);
    expect(cover()).not.toBeNull();
    advance(view, 1);
    expect(cover()).toBeNull();
  });

  it('a second tap on the peek closes it, and a tap on the cover does too; neither restarts it', async () => {
    const view = await onAir();
    fireEvent.click(peek());
    act(() => view.surfaces.videoStatus('ready'));
    advance(view, 10_000);
    fireEvent.click(peek());
    expect(cover()).toBeNull();
    fireEvent.click(peek());
    fireEvent.click(screen.getByTestId('viewer-cover'));
    expect(cover()).toBeNull();
  });

  it('Hide on the cover closes the view: idle, the player unmounted, the peek no longer selected (D2 §4.3)', async () => {
    const view = await onAir();
    fireEvent.click(peek());
    act(() => view.surfaces.videoStatus('ready'));
    expect(video()).not.toBeNull();
    const hide = screen.getByRole('button', { name: en['stream.scoring.hide'] });
    // The Hide that is drawn, a button of its own: not the box's name for itself.
    expect(hide).not.toBe(cover());
    expect(cover()?.contains(hide)).toBe(true);
    fireEvent.click(hide);
    expect(cover()).toBeNull();
    expect(video()).toBeNull();
    expect(peek().getAttribute('aria-selected')).toBe('false');
    const states = readRecord(view.record)
      .filter((entry) => entry.event === 'viewer.check')
      .map((entry) => entry.fields.state);
    expect(states).toEqual(['loading', 'showing', 'idle']);
  });

  it('reads selected on the peek while the view is open, and not once it closes', async () => {
    await onAir();
    expect(peek().getAttribute('aria-selected')).toBe('false');
    fireEvent.click(peek());
    expect(peek().getAttribute('aria-selected')).toBe('true');
    fireEvent.click(peek());
    expect(peek().getAttribute('aria-selected')).toBe('false');
  });

  it('one cover at a time: Remote scoring closes the view, and the view closes the panel', async () => {
    const view = await onAir();
    fireEvent.click(peek());
    fireEvent.click(screen.getByRole('button', { name: en['stream.scoring.open'] }));
    expect(cover()).toBeNull();
    fireEvent.click(peek());
    expect(cover()).not.toBeNull();
    expect(screen.queryByText(en['stream.scoring.title'])).toBeNull();
    expect(view.scoringLink.calls).toBe(1);
  });

  it('the ladder sheds mid-view: the cover goes, and the peek is disabled with its reason (D2 §4.2)', async () => {
    const view = await onAir();
    fireEvent.click(peek());
    act(() => view.engine.patch({ shed: 'viewer-feed' }));
    expect(cover()).toBeNull();
    expect(peek().getAttribute('aria-disabled')).toBe('true');
    expect(screen.getByText(en['stream.peek.hot'])).toBeTruthy();
    fireEvent.click(peek());
    expect(cover()).toBeNull();
  });

  it('a later step down the ladder sheds the first rung too (step 3, encode)', async () => {
    const view = await onAir();
    act(() => view.engine.patch({ shed: 'encode' }));
    expect(peek().getAttribute('aria-disabled')).toBe('true');
  });

  it('the shed scene, as native sends it (thermal status 2), closes and disables the view', async () => {
    const view = await onAir();
    fireEvent.click(peek());
    act(() => view.engine.scene('shed'));
    expect(cover()).toBeNull();
    expect(peek().getAttribute('aria-disabled')).toBe('true');
  });

  it('the app leaves the foreground mid-view: closed, the player unmounted', async () => {
    const view = await onAir();
    fireEvent.click(peek());
    act(() => view.surfaces.videoStatus('ready'));
    act(() => view.foreground.leave());
    expect(cover()).toBeNull();
    expect(video()).toBeNull();
  });

  it('leaving live mid-view closes it (no playback URL off air)', async () => {
    const view = await onAir();
    fireEvent.click(peek());
    act(() => view.engine.forceState({ kind: 'paired' }));
    expect(cover()).toBeNull();
  });

  it('writes each state and the time to the first frame to the record (PD6, spec §8)', async () => {
    const view = await onAir();
    fireEvent.click(peek());
    advance(view, 2_000);
    act(() => view.surfaces.videoStatus('ready'));
    advance(view, 20_000);
    const lines = readRecord(view.record)
      .filter((entry) => entry.event.startsWith('viewer.'))
      .map((entry) => [entry.event, entry.fields]);
    expect(lines).toEqual([
      ['viewer.check', { state: 'loading' }],
      ['viewer.firstFrame', { ms: 2_000 }],
      ['viewer.check', { state: 'showing' }],
      ['viewer.check', { state: 'idle' }],
    ]);
  });

  it.each([
    ['es', es],
    ['fr', fr],
    ['nl', nl],
  ] as const)(
    '%s: the honest line and the countdown in the operator’s language',
    async (lang, d) => {
      const view = await onAir({ deviceLanguages: [lang] });
      fireEvent.click(peek(d['stream.peek.label']));
      expect(screen.getByText(fill(d['stream.peek.loading'], 5))).toBeTruthy();
      act(() => view.surfaces.videoStatus('ready'));
      expect(screen.getByText(d['stream.peek.honest'])).toBeTruthy();
      expect(screen.getByText(fill(d['stream.peek.closesIn'], 20))).toBeTruthy();
    },
  );
});
