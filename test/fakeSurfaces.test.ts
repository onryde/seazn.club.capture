// @vitest-environment jsdom
import { act, cleanup, render, screen } from '@testing-library/react';
import { createElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createFakeSurfaces } from './fakeSurfaces';

const URL = 'https://stg.seazn.club/overlay/fixtures/f';

afterEach(cleanup);

function overlay(surfaces: ReturnType<typeof createFakeSurfaces>, onFailed: () => void) {
  return createElement(surfaces.Overlay, { url: URL, onFailed });
}

describe('the fake surfaces', () => {
  it('reports an overlay load failure to the overlay on screen', () => {
    const surfaces = createFakeSurfaces();
    const first = vi.fn();
    const onFailed = vi.fn();
    const view = render(overlay(surfaces, first));
    view.rerender(overlay(surfaces, onFailed));
    act(() => surfaces.failOverlay());
    expect(onFailed).toHaveBeenCalledTimes(1);
    expect(first).not.toHaveBeenCalled();
  });

  it('reports nothing when no overlay has rendered', () => {
    const surfaces = createFakeSurfaces();
    expect(() => surfaces.failOverlay()).not.toThrow();
  });

  it('reports nothing once the overlay has gone, as a torn-down WebView would (m5)', () => {
    const surfaces = createFakeSurfaces();
    const onFailed = vi.fn();
    render(overlay(surfaces, onFailed)).unmount();
    act(() => surfaces.failOverlay());
    expect(onFailed).not.toHaveBeenCalled();
  });

  it('keeps reporting to a later overlay after an earlier one goes', () => {
    const surfaces = createFakeSurfaces();
    const earlier = vi.fn();
    const later = vi.fn();
    const first = render(overlay(surfaces, earlier));
    render(overlay(surfaces, later));
    first.unmount();
    act(() => surfaces.failOverlay());
    expect(later).toHaveBeenCalledTimes(1);
    expect(earlier).not.toHaveBeenCalled();
  });

  it('throws from the overlay once told to crash', () => {
    const surfaces = createFakeSurfaces();
    surfaces.crashOverlay();
    expect(() => surfaces.Overlay({ url: URL, onFailed: vi.fn() })).toThrow('overlay crashed');
  });

  it('renders the overlay, the viewer video and the preview with what they were given', () => {
    const surfaces = createFakeSurfaces();
    const peek = 'https://customer-x.cloudflarestream.com/v/manifest/video.m3u8';
    render(overlay(surfaces, vi.fn()));
    render(createElement(surfaces.Preview));
    const video = render(createElement(surfaces.Video, { url: peek, playing: false }));
    expect(screen.getByTestId('overlay').getAttribute('data-url')).toBe(URL);
    expect(screen.getByTestId('preview')).toBeTruthy();
    expect(screen.getByTestId('viewer-video').getAttribute('data-url')).toBe(peek);
    expect(screen.getByTestId('viewer-video').getAttribute('data-playing')).toBe('false');
    video.rerender(createElement(surfaces.Video, { url: peek, playing: true }));
    expect(screen.getByTestId('viewer-video').getAttribute('data-playing')).toBe('true');
  });
});
