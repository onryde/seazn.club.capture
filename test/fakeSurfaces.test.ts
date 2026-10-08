// @vitest-environment jsdom
import { act, cleanup, render, screen } from '@testing-library/react';
import { createElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { VideoStatus } from '@/services/surfaces';
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

describe('the fake viewer video reports its status', () => {
  const PEEK = 'https://video.example/fake/manifest/video.m3u8';
  const video = (
    surfaces: ReturnType<typeof createFakeSurfaces>,
    onStatus?: (status: VideoStatus) => void,
  ) => createElement(surfaces.Video, { url: PEEK, playing: true, onStatus });

  it('hands every status it is told to the Video on screen, whole', () => {
    const surfaces = createFakeSurfaces();
    const heard: VideoStatus[] = [];
    render(video(surfaces, (status) => heard.push(status)));
    const told: VideoStatus[] = ['ready', 'failed', 'loading'];
    for (const status of told) act(() => surfaces.videoStatus(status));
    expect(heard).toEqual(told);
    expect(told).toHaveLength(3);
  });

  it('reaches the latest onStatus after a rerender, and only the Video on screen', () => {
    const surfaces = createFakeSurfaces();
    const first = vi.fn();
    const second = vi.fn();
    const view = render(video(surfaces, first));
    view.rerender(video(surfaces, second));
    act(() => surfaces.videoStatus('ready'));
    expect(second).toHaveBeenCalledWith('ready');
    expect(first).not.toHaveBeenCalled();
  });

  it('reports nothing once the Video has gone, and not to a Video that carries no onStatus', () => {
    const surfaces = createFakeSurfaces();
    const onStatus = vi.fn();
    render(video(surfaces, onStatus)).unmount();
    expect(() => act(() => surfaces.videoStatus('failed'))).not.toThrow();
    render(video(surfaces, undefined));
    expect(() => act(() => surfaces.videoStatus('failed'))).not.toThrow();
    expect(onStatus).not.toHaveBeenCalled();
  });

  it('keeps reporting to a later Video after an earlier one goes', () => {
    const surfaces = createFakeSurfaces();
    const earlier = vi.fn();
    const later = vi.fn();
    const first = render(video(surfaces, earlier));
    render(video(surfaces, later));
    first.unmount();
    act(() => surfaces.videoStatus('ready'));
    expect(later).toHaveBeenCalledWith('ready');
    expect(earlier).not.toHaveBeenCalled();
  });

  it('counts every Video that mounts, a remount by key included, and not a re-render', () => {
    const surfaces = createFakeSurfaces();
    expect(surfaces.videoMounts()).toBe(0);
    const keyed = (key: number) =>
      createElement(surfaces.Video, { key, url: PEEK, playing: true, onStatus: vi.fn() });
    const view = render(keyed(0));
    expect(surfaces.videoMounts()).toBe(1);
    view.rerender(keyed(0));
    expect(surfaces.videoMounts()).toBe(1);
    view.rerender(keyed(1));
    expect(surfaces.videoMounts()).toBe(2);
    view.unmount();
    expect(surfaces.videoMounts()).toBe(2);
  });
});
