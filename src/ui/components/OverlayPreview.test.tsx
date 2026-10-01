import { act, render, screen } from '@testing-library/react';
import { createElement } from 'react';
import { Text } from 'react-native';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { OverlayProps } from '@/services/surfaces';
import { OverlayPreview } from '@/ui/components/OverlayPreview';
import { createFakePorts, readRecord } from '../../../test/fakePorts';
import { createFakeSurfaces } from '../../../test/fakeSurfaces';
import { renderWithPorts, wrapperFor } from '../../../test/renderWithPorts';

const URL = 'https://stg.seazn.club/overlay/fixtures/fake-fixture';
const OTHER = 'https://stg.seazn.club/overlay/fixtures/other-fixture';

/** The fake surfaces, with an Overlay that records each onFailed it is handed. */
function recordingSurfaces() {
  const fake = createFakeSurfaces();
  const handed: (() => void)[] = [];
  function Overlay(props: OverlayProps) {
    handed.push(props.onFailed);
    return createElement(fake.Overlay, props);
  }
  return { fake, handed, surfaces: { ...fake, Overlay } };
}

function renderPreview(props: { url: string | null; visible: boolean }) {
  const { fake, handed, surfaces } = recordingSurfaces();
  const onFailed = vi.fn();
  const view = renderWithPorts(<OverlayPreview {...props} onFailed={onFailed} />, { surfaces });
  const events = () => readRecord(view.record).map((entry) => `${entry.level} ${entry.event}`);
  return { ...view, fake, handed, onFailed, events };
}

const overlay = () => screen.queryByTestId('overlay');

describe('OverlayPreview (AGENTS §7)', () => {
  it('draws the Tier A route with no delay', () => {
    renderPreview({ url: URL, visible: true });
    expect(overlay()?.dataset.url).toBe(`${URL}?delay=0`);
  });

  it('draws nothing when hidden, and says nothing about it', () => {
    const view = renderPreview({ url: URL, visible: false });
    expect(overlay()).toBeNull();
    expect(view.onFailed).not.toHaveBeenCalled();
    expect(view.events()).toEqual([]);
  });

  it('reports a page that failed to load, records it, and takes the WebView down', () => {
    const view = renderPreview({ url: URL, visible: true });
    act(() => view.fake.failOverlay());
    expect(view.onFailed).toHaveBeenCalledTimes(1);
    expect(view.events()).toEqual(['warn overlay.failed']);
    // Carry 9: never the WebView's own white English error plate; the caption says it.
    expect(overlay()).toBeNull();
  });

  it('reports two failures arriving together once', () => {
    const view = renderPreview({ url: URL, visible: true });
    act(() => {
      view.fake.failOverlay();
      view.fake.failOverlay();
    });
    expect(view.onFailed).toHaveBeenCalledTimes(1);
    expect(view.events()).toEqual(['warn overlay.failed']);
  });

  it('tries again, and reports again, on a fresh showing', () => {
    const view = renderPreview({ url: URL, visible: true });
    act(() => view.fake.failOverlay());
    view.rerender(<OverlayPreview url={URL} visible={false} onFailed={view.onFailed} />);
    view.rerender(<OverlayPreview url={URL} visible onFailed={view.onFailed} />);
    expect(overlay()?.dataset.url).toBe(`${URL}?delay=0`);
    act(() => view.fake.failOverlay());
    expect(view.onFailed).toHaveBeenCalledTimes(2);
    expect(view.events()).toEqual(['warn overlay.failed', 'warn overlay.failed']);
  });

  it('draws a new URL after the old one failed', () => {
    const view = renderPreview({ url: URL, visible: true });
    act(() => view.fake.failOverlay());
    view.rerender(<OverlayPreview url={OTHER} visible onFailed={view.onFailed} />);
    expect(overlay()?.dataset.url).toBe(`${OTHER}?delay=0`);
  });

  it('hands the surface one stable onFailed, so a re-render never rebuilds the WebView (carry 11)', () => {
    const view = renderPreview({ url: URL, visible: true });
    const drawn = overlay();
    const later = vi.fn();
    view.rerender(<OverlayPreview url={URL} visible onFailed={later} />);
    expect(view.handed.length).toBeGreaterThan(1);
    expect(new Set(view.handed).size).toBe(1);
    expect(overlay()).toBe(drawn);
    act(() => view.fake.failOverlay());
    expect(later).toHaveBeenCalledTimes(1);
    expect(view.onFailed).not.toHaveBeenCalled();
  });
});

describe('an overlay the server did not send (carry 8)', () => {
  it('shows the failed caption and logs overlay.absent once', () => {
    const view = renderPreview({ url: null, visible: true });
    view.rerender(<OverlayPreview url={null} visible onFailed={view.onFailed} />);
    expect(overlay()).toBeNull();
    expect(view.onFailed).toHaveBeenCalledTimes(1);
    expect(view.events()).toEqual(['warn overlay.absent']);
  });

  // RTL's option puts StrictMode at the root; a <StrictMode> nested inside the
  // ports' providers did not run this effect twice under React 19.2.3.
  it('logs it once when an effect runs twice (StrictMode)', () => {
    const { surfaces } = recordingSurfaces();
    const fakes = createFakePorts({ surfaces });
    const onFailed = vi.fn();
    render(<OverlayPreview url={null} visible onFailed={onFailed} />, {
      wrapper: wrapperFor(fakes),
      reactStrictMode: true,
    });
    expect(onFailed).toHaveBeenCalledTimes(1);
    expect(readRecord(fakes.record).map((entry) => entry.event)).toEqual(['overlay.absent']);
  });

  it('says nothing while the preview is hidden', () => {
    const view = renderPreview({ url: null, visible: false });
    expect(view.onFailed).not.toHaveBeenCalled();
    expect(view.events()).toEqual([]);
  });

  it('draws the overlay once a URL arrives', () => {
    const view = renderPreview({ url: null, visible: true });
    view.rerender(<OverlayPreview url={URL} visible onFailed={view.onFailed} />);
    expect(overlay()?.dataset.url).toBe(`${URL}?delay=0`);
  });
});

describe('a crash inside the overlay', () => {
  // React reports every caught render error on console.error; keep the run quiet.
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('never takes its neighbours down, and is reported and recorded', () => {
    const { fake, surfaces } = recordingSurfaces();
    const onFailed = vi.fn();
    const view = renderWithPorts(<Text>HUD</Text>, { surfaces });
    fake.crashOverlay();
    view.rerender(
      <>
        <OverlayPreview url={URL} visible onFailed={onFailed} />
        <Text>HUD</Text>
      </>,
    );
    expect(screen.getByText('HUD')).toBeTruthy();
    expect(screen.queryByText('Something broke')).toBeNull();
    expect(overlay()).toBeNull();
    expect(onFailed).toHaveBeenCalledTimes(1);
    expect(readRecord(view.record).map((e) => `${e.level} ${e.event}`)).toEqual([
      'error overlay.crashed',
    ]);
  });
});
