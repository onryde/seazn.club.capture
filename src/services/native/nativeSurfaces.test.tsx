import { render, screen, waitFor, within } from '@testing-library/react';
import { createElement } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { createLogger } from '@/services/logger';
import { createNativeSurfaces, type SurfacePackages } from '@/services/native/nativeSurfaces';
import { NO_MEDIA_CAPTURE } from '@/services/overlayGuard';
import { createRingRecord } from '@/services/sessionRecord';

// This "binary" has neither package: importing one throws, as the native halves
// do on a phone built without them (requireNativeModule / getEnforcing). With a
// static import anywhere in nativeSurfaces, this whole file would fail to load.
vi.mock('react-native-webview', () => {
  throw new Error('RNCWebViewModule could not be found');
});
vi.mock('expo-video', () => {
  throw new Error("Cannot find native module 'ExpoVideo'");
});

const OVERLAY = 'https://stg.seazn.club/overlay/fixtures/fake-fixture?delayMs=0';
const PEEK = 'https://video.example/fake/manifest/video.m3u8?clientBandwidthHint=1.0';

type Props = Record<string, unknown>;
type WebViewPackage = Awaited<ReturnType<SurfacePackages['webview']>>;
type VideoPackage = Awaited<ReturnType<SurfacePackages['video']>>;

/** A WebView package whose component records the props it was given. */
function fakeWebView() {
  const renders: Props[] = [];
  function WebView(props: Props) {
    renders.push(props);
    return createElement('div', { 'data-testid': 'webview' });
  }
  return { renders, pkg: { WebView } as unknown as WebViewPackage };
}

/** An expo-video package with one player that records what it was told. */
function fakeVideo() {
  const player = { muted: false, loop: true, play: vi.fn(), pause: vi.fn() };
  const useVideoPlayer = vi.fn((_source: unknown, setup?: (p: typeof player) => void) => {
    setup?.(player);
    return player;
  });
  function VideoView() {
    return createElement('div', { 'data-testid': 'video-view' });
  }
  return { player, useVideoPlayer, pkg: { useVideoPlayer, VideoView } as unknown as VideoPackage };
}

const absent = () => Promise.reject(new Error('native module missing'));

function build(packages: Partial<SurfacePackages> = {}) {
  const record = createRingRecord();
  const webview = fakeWebView();
  const video = fakeVideo();
  const loads = {
    webview: vi.fn(async () => webview.pkg),
    video: vi.fn(async () => video.pkg),
  };
  const surfaces = createNativeSurfaces({
    logger: createLogger({ record, now: () => 0 }),
    packages: { ...loads, ...packages },
  });
  const entries = () =>
    record.lines().map((line) => {
      const { event, fields } = JSON.parse(line);
      return { event, fields };
    });
  return { surfaces, webview, video, loads, entries };
}

async function renderOverlay(built: ReturnType<typeof build>, onFailed = vi.fn()) {
  const view = render(createElement(built.surfaces.Overlay, { url: OVERLAY, onFailed }));
  await within(view.container).findByTestId('webview');
  const props = built.webview.renders.at(-1) ?? {};
  return { view, props, onFailed };
}

describe('the native overlay, confined to its own origin (I1)', () => {
  it('locks the WebView down: every URL to our guard, no windows, no files, no camera', async () => {
    const { props } = await renderOverlay(build());
    expect(props).toMatchObject({
      source: { uri: OVERLAY },
      originWhitelist: ['*'],
      setSupportMultipleWindows: false,
      javaScriptCanOpenWindowsAutomatically: false,
      mediaCapturePermissionGrantType: 'deny',
      allowFileAccess: false,
      allowFileAccessFromFileURLs: false,
      allowUniversalAccessFromFileURLs: false,
      injectedJavaScriptBeforeContentLoaded: NO_MEDIA_CAPTURE,
      injectedJavaScriptBeforeContentLoadedForMainFrameOnly: false,
    });
  });

  it('lets its own origin load and refuses the rest, reporting and logging by host', async () => {
    const built = build();
    const { props, onFailed } = await renderOverlay(built);
    const guard = props.onShouldStartLoadWithRequest as (request: { url: string }) => boolean;
    expect(guard({ url: OVERLAY })).toBe(true);
    expect(onFailed).not.toHaveBeenCalled();
    expect(guard({ url: 'intent://scan/#Intent;end' })).toBe(false);
    expect(onFailed).toHaveBeenCalledTimes(1);
    expect(built.entries()).toEqual([{ event: 'overlay.blocked', fields: { host: 'scan' } }]);
  });

  it('reports every way the WebView can fail', async () => {
    const { props, onFailed } = await renderOverlay(build());
    for (const name of [
      'onError',
      'onHttpError',
      'onRenderProcessGone',
      'onContentProcessDidTerminate',
    ]) {
      (props[name] as () => void)();
    }
    expect(onFailed).toHaveBeenCalledTimes(4);
  });

  it('keeps the same source and guard across a re-render with the same URL', async () => {
    const built = build();
    const { view, props, onFailed } = await renderOverlay(built);
    view.rerender(createElement(built.surfaces.Overlay, { url: OVERLAY, onFailed }));
    const again = built.webview.renders.at(-1) ?? {};
    expect(again.source).toBe(props.source);
    expect(again.onShouldStartLoadWithRequest).toBe(props.onShouldStartLoadWithRequest);
  });
});

describe('a native package missing from the binary (m3)', () => {
  it('loads nothing until a surface is drawn', () => {
    const { loads } = build();
    expect(loads.webview).not.toHaveBeenCalled();
    expect(loads.video).not.toHaveBeenCalled();
  });

  it('loads each package once, however many overlays are drawn', async () => {
    const built = build();
    await renderOverlay(built);
    await renderOverlay(built);
    expect(built.loads.webview).toHaveBeenCalledTimes(1);
  });

  it('reports the overlay failed, once per overlay, and says why once', async () => {
    const built = build({ webview: absent });
    const first = vi.fn();
    const second = vi.fn();
    render(createElement(built.surfaces.Overlay, { url: OVERLAY, onFailed: first }));
    await waitFor(() => expect(first).toHaveBeenCalledTimes(1));
    render(createElement(built.surfaces.Overlay, { url: OVERLAY, onFailed: second }));
    await waitFor(() => expect(second).toHaveBeenCalledTimes(1));
    expect(first).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId('webview')).toBeNull();
    expect(built.entries()).toEqual([
      { event: 'surface.unavailable', fields: { kind: 'overlay' } },
    ]);
  });

  it('treats a loader that throws before it returns a promise as missing', async () => {
    const built = build({
      webview: () => {
        throw new Error('native module missing');
      },
    });
    const onFailed = vi.fn();
    render(createElement(built.surfaces.Overlay, { url: OVERLAY, onFailed }));
    await waitFor(() => expect(onFailed).toHaveBeenCalledTimes(1));
  });

  it('reports nothing for an overlay taken down before its package turned out missing', async () => {
    let refuse = (_: Error) => {};
    const slow = vi.fn(() => new Promise<never>((_, reject) => (refuse = reject)));
    const built = build({ webview: slow });
    const onFailed = vi.fn();
    const view = render(createElement(built.surfaces.Overlay, { url: OVERLAY, onFailed }));
    await waitFor(() => expect(slow).toHaveBeenCalledTimes(1));
    view.unmount();
    refuse(new Error('native module missing'));
    await waitFor(() =>
      expect(built.entries()).toEqual([
        { event: 'surface.unavailable', fields: { kind: 'overlay' } },
      ]),
    );
    expect(onFailed).not.toHaveBeenCalled();
  });

  it('draws an empty stage for the viewer video, and says why', async () => {
    const built = build({ video: absent });
    const view = render(createElement(built.surfaces.Video, { url: PEEK, playing: true }));
    await waitFor(() =>
      expect(built.entries()).toEqual([
        { event: 'surface.unavailable', fields: { kind: 'video' } },
      ]),
    );
    expect(view.queryByTestId('video-view')).toBeNull();
  });

  it('degrades the same way through the real loaders, with both packages absent', async () => {
    const record = createRingRecord();
    const surfaces = createNativeSurfaces({ logger: createLogger({ record, now: () => 0 }) });
    const onFailed = vi.fn();
    render(createElement(surfaces.Overlay, { url: OVERLAY, onFailed }));
    render(createElement(surfaces.Video, { url: PEEK, playing: true }));
    await waitFor(() => expect(onFailed).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(record.lines()).toHaveLength(2));
    const kinds = record.lines().map((line) => JSON.parse(line).fields.kind);
    expect(kinds.sort()).toEqual(['overlay', 'video']);
  });
});

describe('the native viewer video', () => {
  it('plays the peek muted, without looping or caching, and follows `playing`', async () => {
    const built = build();
    const view = render(createElement(built.surfaces.Video, { url: PEEK, playing: true }));
    await screen.findByTestId('video-view');
    expect(built.video.useVideoPlayer.mock.calls[0]?.[0]).toEqual({ uri: PEEK, useCaching: false });
    expect(built.video.player).toMatchObject({ muted: true, loop: false });
    expect(built.video.player.play).toHaveBeenCalledTimes(1);
    view.rerender(createElement(built.surfaces.Video, { url: PEEK, playing: false }));
    expect(built.video.player.pause).toHaveBeenCalledTimes(1);
  });
});
