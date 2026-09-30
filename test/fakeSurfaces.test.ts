import { isValidElement, type ReactElement } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { createFakeSurfaces } from './fakeSurfaces';

const URL = 'https://stg.seazn.club/overlay/fixtures/f';

/** What a fake surface rendered, as the element's props. */
function propsOf(node: unknown): Record<string, unknown> {
  expect(isValidElement(node)).toBe(true);
  return (node as ReactElement<Record<string, unknown>>).props;
}

describe('the fake surfaces', () => {
  it('reports an overlay load failure to the last rendered overlay', () => {
    const surfaces = createFakeSurfaces();
    const first = vi.fn();
    const onFailed = vi.fn();
    surfaces.Overlay({ url: URL, onFailed: first });
    surfaces.Overlay({ url: URL, onFailed });
    surfaces.failOverlay();
    expect(onFailed).toHaveBeenCalledTimes(1);
    expect(first).not.toHaveBeenCalled();
  });

  it('reports nothing when no overlay has rendered', () => {
    const surfaces = createFakeSurfaces();
    expect(() => surfaces.failOverlay()).not.toThrow();
  });

  it('throws from the overlay once told to crash', () => {
    const surfaces = createFakeSurfaces();
    surfaces.crashOverlay();
    expect(() => surfaces.Overlay({ url: URL, onFailed: vi.fn() })).toThrow('overlay crashed');
  });

  it('renders the overlay and the viewer video with what they were given', () => {
    const surfaces = createFakeSurfaces();
    expect(propsOf(surfaces.Overlay({ url: URL, onFailed: vi.fn() }))).toMatchObject({
      'data-testid': 'overlay',
      'data-url': URL,
    });
    const peek = 'https://customer-x.cloudflarestream.com/v/manifest/video.m3u8';
    expect(propsOf(surfaces.Video({ url: peek, playing: false }))).toMatchObject({
      'data-testid': 'viewer-video',
      'data-url': peek,
      'data-playing': 'false',
    });
    expect(propsOf(surfaces.Video({ url: peek, playing: true }))['data-playing']).toBe('true');
    expect(propsOf(surfaces.Preview({}))['data-testid']).toBe('preview');
  });
});
