import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { createLogger } from '@/services/logger';
import {
  NO_MEDIA_CAPTURE,
  OVERLAY_ORIGIN_WHITELIST,
  overlayNavigationGuard,
} from '@/services/overlayGuard';
import { createRingRecord } from '@/services/sessionRecord';

const OVERLAY = 'https://stg.seazn.club/overlay/fixtures/fake-fixture?delay=0';

function build() {
  const record = createRingRecord();
  const onFailed = vi.fn();
  const guard = overlayNavigationGuard({
    url: OVERLAY,
    onFailed,
    logger: createLogger({ record, now: () => 0 }),
  });
  const entries = () =>
    record.lines().map((line) => {
      const { event, fields } = JSON.parse(line);
      return { event, fields };
    });
  return { guard, onFailed, entries };
}

describe('the overlay navigation guard (I1)', () => {
  it('lets the overlay load and move within its own origin, silently', () => {
    const { guard, onFailed, entries } = build();
    expect(guard({ url: OVERLAY })).toBe(true);
    expect(guard({ url: 'https://stg.seazn.club/overlay/fixtures/other' })).toBe(true);
    expect(onFailed).not.toHaveBeenCalled();
    expect(entries()).toEqual([]);
  });

  it('refuses another origin, reports the overlay failed, and logs the host only', () => {
    const { guard, onFailed, entries } = build();
    expect(guard({ url: 'https://evil.example/path?token=secret' })).toBe(false);
    expect(onFailed).toHaveBeenCalledTimes(1);
    expect(entries()).toEqual([{ event: 'overlay.blocked', fields: { host: 'evil.example' } }]);
  });

  it.each([
    ['http://stg.seazn.club/overlay', 'stg.seazn.club'],
    ['intent://scan/#Intent;end', 'scan'],
    ['tel:+441234567890', null],
    ['about:blank', null],
  ])('refuses %s and logs host %s', (url, host) => {
    const { guard, onFailed, entries } = build();
    expect(guard({ url })).toBe(false);
    expect(onFailed).toHaveBeenCalledTimes(1);
    expect(entries()).toEqual([{ event: 'overlay.blocked', fields: { host } }]);
  });

  /**
   * Carry 10: a page's own off-origin iframe (an embed, an ad) is refused and
   * logged, but the scorebug is still drawing, so the overlay has not failed.
   * `isTopFrame === false` alone means a subframe. react-native-webview 13.16.1
   * on Android sends no `isTopFrame` on its usual path (RNCWebViewClient.java
   * `createWebViewEvent`), though the type says boolean: absent reads as the
   * top frame, so Android fails closed.
   */
  it('refuses an off-origin subframe and logs it, without failing the overlay', () => {
    const { guard, onFailed, entries } = build();
    expect(guard({ url: 'https://ads.example/frame?id=secret', isTopFrame: false })).toBe(false);
    expect(onFailed).not.toHaveBeenCalled();
    expect(entries()).toEqual([
      { event: 'overlay.blocked', fields: { host: 'ads.example', kind: 'subframe' } },
    ]);
  });

  it('lets a subframe on its own origin load, silently', () => {
    const { guard, onFailed, entries } = build();
    expect(guard({ url: OVERLAY, isTopFrame: false })).toBe(true);
    expect(onFailed).not.toHaveBeenCalled();
    expect(entries()).toEqual([]);
  });

  it.each([[true], [undefined]])(
    'fails the overlay for a refused top frame (isTopFrame %s)',
    (isTopFrame) => {
      const { guard, onFailed, entries } = build();
      expect(guard({ url: 'https://evil.example/', isTopFrame })).toBe(false);
      expect(onFailed).toHaveBeenCalledTimes(1);
      expect(entries()).toEqual([{ event: 'overlay.blocked', fields: { host: 'evil.example' } }]);
    },
  );

  it('reports each refusal, so a second one after a re-render is not lost', () => {
    const { guard, onFailed } = build();
    guard({ url: 'https://evil.example/' });
    guard({ url: 'tel:+441234567890' });
    expect(onFailed).toHaveBeenCalledTimes(2);
  });
});

/**
 * The vendor's own JS decides first (react-native-webview 13.16.1,
 * lib/WebViewShared.js `createOnShouldStartLoadWithRequest`): a URL outside
 * `originWhitelist` goes to `Linking.openURL` — another app over a live
 * broadcast — and our guard is never asked. So the whitelist must let every
 * URL through to the guard. This runs the installed vendor function, with a
 * stand-in for `react-native` so `Linking` can be watched.
 */
describe('through the installed vendor path: Linking is never called', () => {
  const linking = {
    canOpenURL: vi.fn(async () => true),
    openURL: vi.fn(async () => undefined),
  };
  const nodeRequire = createRequire(import.meta.url);
  const vendorDir = dirname(nodeRequire.resolve('react-native-webview'));
  const sharedPath = join(vendorDir, 'lib', 'WebViewShared.js');
  const vendorRequire = createRequire(sharedPath);
  const reactNativePath = vendorRequire.resolve('react-native');
  const stand = {
    Linking: linking,
    StyleSheet: { create: <T>(styles: T) => styles },
    Platform: { OS: 'android' },
    View: 'View',
    Text: 'Text',
    ActivityIndicator: 'ActivityIndicator',
  };
  nodeRequire.cache[reactNativePath] = {
    id: reactNativePath,
    filename: reactNativePath,
    loaded: true,
    exports: stand,
  } as unknown as NodeJS.Module;
  const { createOnShouldStartLoadWithRequest } = vendorRequire(sharedPath) as {
    createOnShouldStartLoadWithRequest: (
      loadRequest: (shouldStart: boolean, url: string, lock: number) => void,
      originWhitelist: readonly string[],
      onShouldStartLoadWithRequest: (event: { url: string; isTopFrame?: boolean }) => boolean,
    ) => (event: {
      nativeEvent: { url: string; lockIdentifier: number; isTopFrame?: boolean };
    }) => void;
  };

  afterAll(() => {
    delete nodeRequire.cache[reactNativePath];
    delete nodeRequire.cache[sharedPath];
  });

  /** What the vendor decides for `url`, and whether it reached for Linking. */
  function decide(whitelist: readonly string[], url: string) {
    linking.canOpenURL.mockClear();
    linking.openURL.mockClear();
    const { guard } = build();
    const loadRequest = vi.fn();
    createOnShouldStartLoadWithRequest(
      loadRequest,
      whitelist,
      guard,
    )({ nativeEvent: { url, lockIdentifier: 7 } });
    return {
      start: loadRequest.mock.calls[0]?.[0] as boolean | undefined,
      linking: linking.canOpenURL.mock.calls.length + linking.openURL.mock.calls.length,
    };
  }

  it.each([
    [OVERLAY, true],
    ['https://stg.seazn.club/overlay/fixtures/other', true],
    ['https://evil.example/overlay', false],
    ['http://stg.seazn.club/overlay', false],
    ['intent://scan/#Intent;scheme=zxing;end', false],
    ['tel:+441234567890', false],
    ['about:blank', false],
    ['whatsapp://send?text=hi', false],
  ])('%s: start %s, and no other app is opened', (url, start) => {
    expect(decide(OVERLAY_ORIGIN_WHITELIST, url)).toEqual({ start, linking: 0 });
  });

  it('passes isTopFrame through to the guard: a refused subframe opens nothing', () => {
    linking.canOpenURL.mockClear();
    linking.openURL.mockClear();
    const { guard, onFailed } = build();
    const loadRequest = vi.fn();
    createOnShouldStartLoadWithRequest(
      loadRequest,
      OVERLAY_ORIGIN_WHITELIST,
      guard,
    )({ nativeEvent: { url: 'https://ads.example/', lockIdentifier: 7, isTopFrame: false } });
    expect(loadRequest.mock.calls[0]?.[0]).toBe(false);
    expect(onFailed).not.toHaveBeenCalled();
    expect(linking.canOpenURL.mock.calls.length + linking.openURL.mock.calls.length).toBe(0);
  });

  // Controls: the same test sees the hand-off it guards against.
  it('would open another app under the plan’s whitelist (https only)', () => {
    expect(decide(['https://*'], 'intent://scan/#Intent;end')).toEqual({
      start: false,
      linking: 1,
    });
  });

  it('would open another app under a whitelist of the overlay origin alone', () => {
    expect(decide(['https://stg.seazn.club'], 'https://evil.example/')).toEqual({
      start: false,
      linking: 1,
    });
  });
});

/**
 * Android grants a page's getUserMedia whenever the app holds CAMERA and
 * RECORD_AUDIO (RNCWebChromeClient.onPermissionRequest), and 13.16.1 has no
 * prop to refuse it. The script removes the calls before the page's own run.
 */
describe('the media-capture script', () => {
  /** A fresh class per page: the script seals its prototype for good. */
  function mediaDevicesClass() {
    return class FakeMediaDevices {
      getUserMedia(): Promise<string> {
        return Promise.resolve('camera stream');
      }
      getDisplayMedia(): Promise<string> {
        return Promise.resolve('screen stream');
      }
    };
  }

  type Page = { readonly global: boolean; readonly mediaDevices: boolean };

  /** Runs the script against a stand-in page: with or without a `MediaDevices` global and instance. */
  function run(page: Page = { global: true, mediaDevices: true }) {
    const MediaDevices = mediaDevicesClass();
    const mediaDevices = new MediaDevices();
    const navigator: Record<string, unknown> = {
      getUserMedia: () => Promise.resolve('legacy stream'),
    };
    if (page.mediaDevices) navigator.mediaDevices = mediaDevices;
    // A direct eval inside the function: the script sees these two as its globals,
    // and its completion value (what the WebView reads) comes back.
    const evaluate = new Function('navigator', 'MediaDevices', 'script', 'return eval(script);');
    const result: unknown = evaluate(
      navigator,
      page.global ? MediaDevices : undefined,
      NO_MEDIA_CAPTURE,
    );
    const call = (name: string) => (navigator[name] as () => Promise<string>)();
    return { MediaDevices, mediaDevices, result, call };
  }

  const REFUSED = 'overlay preview';

  it('refuses both calls on the prototype, for an instance made after it ran', async () => {
    const { MediaDevices } = run();
    const later = new MediaDevices();
    await expect(later.getUserMedia()).rejects.toThrow(REFUSED);
    await expect(later.getDisplayMedia()).rejects.toThrow(REFUSED);
  });

  it('refuses both calls on the page’s own instance when there is no global to reach', async () => {
    const { mediaDevices } = run({ global: false, mediaDevices: true });
    await expect(mediaDevices.getUserMedia()).rejects.toThrow(REFUSED);
    await expect(mediaDevices.getDisplayMedia()).rejects.toThrow(REFUSED);
  });

  it('refuses the legacy and prefixed calls, with or without mediaDevices', async () => {
    for (const page of [
      { global: true, mediaDevices: true },
      { global: false, mediaDevices: false },
    ]) {
      const { call, result } = run(page);
      await expect(call('getUserMedia')).rejects.toThrow(REFUSED);
      await expect(call('webkitGetUserMedia')).rejects.toThrow(REFUSED);
      expect(result).toBe(true);
    }
  });

  it('cannot be undone by the page, on the instance or the prototype', () => {
    const { MediaDevices, mediaDevices } = run();
    const camera = { value: () => 'camera' };
    expect(() => Object.defineProperty(mediaDevices, 'getUserMedia', camera)).toThrow();
    expect(() => Object.defineProperty(MediaDevices.prototype, 'getUserMedia', camera)).toThrow();
  });
});
