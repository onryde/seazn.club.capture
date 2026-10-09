import { act, render, screen, waitFor } from '@testing-library/react';
import { createElement } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { StyleSheet } from 'react-native';
import { createLogger } from '@/services/logger';
import { createNativeSurfaces, type SurfacePackages } from '@/services/native/nativeSurfaces';
import { createRingRecord, parseRecordLine } from '@/services/sessionRecord';
import type { VideoStatus } from '@/services/surfaces';
import { fakeVideo } from '../../../test/fakeExpoVideo';

// This "binary" lacks expo-video: importing it throws, as the native half does on
// a phone built without it (requireNativeModule). With a static import anywhere
// in nativeSurfaces, this whole file would fail to load.
vi.mock('expo-video', () => {
  throw new Error("Cannot find native module 'ExpoVideo'");
});

const PEEK = 'https://video.example/fake/manifest/video.m3u8?clientBandwidthHint=1.0';

type Props = Record<string, unknown>;

/** The engine module's native view (Task 39), recording the props it was given. */
function fakePreview() {
  const renders: Props[] = [];
  function View(props: Props) {
    renders.push(props);
    return createElement('div', { 'data-testid': 'native-preview' });
  }
  return {
    renders,
    View: View as unknown as NonNullable<Awaited<ReturnType<SurfacePackages['preview']>>>,
  };
}

const absent = () => Promise.reject(new Error('native module missing'));

function build(packages: Partial<SurfacePackages> = {}) {
  const record = createRingRecord();
  const video = fakeVideo();
  const preview = fakePreview();
  const loads = {
    video: vi.fn(async () => video.pkg),
    preview: vi.fn(async () => preview.View),
  };
  const surfaces = createNativeSurfaces({
    logger: createLogger({ record, now: () => 0 }),
    packages: { ...loads, ...packages },
  });
  const entries = () =>
    record.lines().map((line) => {
      const { event, fields } = parseRecordLine(line);
      return { event, fields };
    });
  return { surfaces, video, preview, loads, entries };
}

/** D2 §4.1 (R1): the phone draws no score, so the port has no overlay surface. */
describe('the native surfaces port', () => {
  it('has no overlay surface: the port is the preview and the viewers’ video', () => {
    const { surfaces } = build();
    expect(Object.keys(surfaces).sort()).toEqual(['Preview', 'Video']);
  });
});

describe('a native package missing from the binary (m3)', () => {
  it('loads nothing until a surface is drawn', () => {
    const { loads } = build();
    expect(loads.video).not.toHaveBeenCalled();
    expect(loads.preview).not.toHaveBeenCalled();
  });

  it('loads the video package once, however many videos are drawn', async () => {
    const video = vi.fn(async () => {
      throw new Error('ExpoVideo is not in this binary');
    });
    const built = build({ video });
    const { Video } = built.surfaces;
    render(createElement(Video, { url: 'https://video.example/a.m3u8', playing: true }));
    render(createElement(Video, { url: 'https://video.example/b.m3u8', playing: true }));
    await waitFor(() =>
      expect(built.entries()).toEqual([
        { event: 'surface.unavailable', fields: { kind: 'video' } },
      ]),
    );
    expect(video).toHaveBeenCalledTimes(1);
  });

  it('treats a loader that throws before it returns a promise as missing', async () => {
    const built = build({
      video: () => {
        throw new Error('native module missing');
      },
    });
    const view = render(createElement(built.surfaces.Video, { url: PEEK, playing: true }));
    await waitFor(() =>
      expect(built.entries()).toEqual([
        { event: 'surface.unavailable', fields: { kind: 'video' } },
      ]),
    );
    expect(view.queryByTestId('video-view')).toBeNull();
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

  it('degrades the same way through the real loaders, with the video package absent', async () => {
    const record = createRingRecord();
    const surfaces = createNativeSurfaces({ logger: createLogger({ record, now: () => 0 }) });
    render(createElement(surfaces.Video, { url: PEEK, playing: true }));
    await waitFor(() => expect(record.lines()).toHaveLength(1));
    const kinds = record.lines().map((line) => parseRecordLine(line).fields.kind);
    expect(kinds).toEqual(['video']);
  });
});

// Task 39: the engine module's own view, full-bleed, where the module is in the binary; an empty
// stage where it is not (iOS in S1, Expo Go, web), which is no failure, so nothing is said.
describe('the native preview', () => {
  it("draws the engine module's view, full-bleed, loading it once", async () => {
    const built = build();
    render(createElement(built.surfaces.Preview));
    render(createElement(built.surfaces.Preview));
    await waitFor(() => expect(screen.getAllByTestId('native-preview')).toHaveLength(2));
    expect(built.loads.preview).toHaveBeenCalledTimes(1);
    expect(StyleSheet.flatten(built.preview.renders.at(-1)?.style as never)).toEqual(
      StyleSheet.flatten(StyleSheet.absoluteFill),
    );
    expect(built.entries()).toEqual([]);
  });

  it('draws an empty stage when the module is absent, and says nothing', async () => {
    const loader = vi.fn(async () => null);
    const built = build({ preview: loader });
    const view = render(createElement(built.surfaces.Preview));
    await waitFor(() => expect(loader).toHaveBeenCalledTimes(1));
    await act(async () => undefined);
    expect(view.queryByTestId('native-preview')).toBeNull();
    expect(view.container.childElementCount).toBe(1);
    expect(built.entries()).toEqual([]);
  });

  it('draws an empty stage when the loader fails, and says why once', async () => {
    const built = build({ preview: absent });
    const view = render(createElement(built.surfaces.Preview));
    await waitFor(() =>
      expect(built.entries()).toEqual([
        { event: 'surface.unavailable', fields: { kind: 'preview' } },
      ]),
    );
    expect(view.queryByTestId('native-preview')).toBeNull();
  });
});

describe('the native viewer video', () => {
  it('plays the peek muted, without looping or caching, and follows `playing`', async () => {
    const built = build();
    const view = render(createElement(built.surfaces.Video, { url: PEEK, playing: true }));
    await screen.findByTestId('video-view');
    expect(built.video.useVideoPlayer.mock.calls[0]?.[0]).toEqual({ uri: PEEK, useCaching: false });
    expect(built.video.player).toMatchObject({ muted: true, loop: false });
    // play() is called from an effect. findBy can resolve on the commit before
    // React flushes it, once a render outlasts the Scheduler's 5 ms slice
    // (it flaked once under `pnpm check`), so wait for the call itself.
    await waitFor(() => expect(built.video.player.play).toHaveBeenCalledTimes(1));
    view.rerender(createElement(built.surfaces.Video, { url: PEEK, playing: false }));
    expect(built.video.player.pause).toHaveBeenCalledTimes(1);
  });

  it('hands the player one source object for one url, however often it re-renders', async () => {
    const built = build();
    const view = render(createElement(built.surfaces.Video, { url: PEEK, playing: true }));
    await screen.findByTestId('video-view');
    view.rerender(createElement(built.surfaces.Video, { url: PEEK, playing: false }));
    const sources = built.video.useVideoPlayer.mock.calls.map(([source]) => source);
    expect(sources.length).toBeGreaterThanOrEqual(2);
    for (const source of sources) expect(source).toBe(sources[0]);
  });
});

/** The player's own word, as expo-video's `statusChange` says it; our three words are VideoStatus (spec §9, D6). */
describe('the native viewer video reports its status', () => {
  const draw = async (
    built: ReturnType<typeof build>,
    props: { playing?: boolean; onStatus?: (status: VideoStatus) => void } = {},
  ) => {
    const { playing = true, onStatus = vi.fn() } = props;
    const element = (p: boolean, o: (status: VideoStatus) => void) =>
      createElement(built.surfaces.Video, { url: PEEK, playing: p, onStatus: o });
    const view = render(element(playing, onStatus));
    await screen.findByTestId('video-view');
    await waitFor(() => expect(built.video.player.addListener).toHaveBeenCalledTimes(1));
    return { view, again: (p: boolean, o = onStatus) => view.rerender(element(p, o)) };
  };

  it('maps the player’s word to ours: ready, loading, loading, failed', async () => {
    const table: readonly (readonly [string, VideoStatus])[] = [
      ['readyToPlay', 'ready'],
      ['loading', 'loading'],
      ['idle', 'loading'],
      ['error', 'failed'],
    ];
    let rows = 0;
    for (const [word, ours] of table) {
      const built = build();
      const heard: VideoStatus[] = [];
      const { view } = await draw(built, { onStatus: (status) => heard.push(status) });
      act(() => built.video.emit(word));
      expect({ word, ours: heard.at(-1) }).toEqual({ word, ours });
      view.unmount();
      rows += 1;
    }
    expect(rows).toBe(4);
  });

  it('reads an unknown word as loading, never as a picture, even one the table inherits from Object', async () => {
    const words = ['somethingNewInExpoVideo', 'constructor', 'toString', '__proto__'];
    let rows = 0;
    for (const word of words) {
      const built = build();
      const heard: VideoStatus[] = [];
      const { view } = await draw(built, { onStatus: (status) => heard.push(status) });
      act(() => built.video.emit(word));
      expect({ word, heard: heard.at(-1) }).toEqual({ word, heard: 'loading' });
      view.unmount();
      rows += 1;
    }
    expect(rows).toBe(4);
  });

  it('reports the status the player already has, once, when it mounts', async () => {
    const built = build();
    built.video.player.status = 'readyToPlay'; // ready before the listener was attached
    const heard: VideoStatus[] = [];
    await draw(built, { onStatus: (status) => heard.push(status) });
    expect(heard).toEqual(['ready']);
  });

  it('plays at once when the player turns ready while it is wanted, and not when it is not', async () => {
    const wanted = build();
    await draw(wanted, { playing: true });
    await waitFor(() => expect(wanted.video.player.play).toHaveBeenCalledTimes(1));
    act(() => wanted.video.emit('readyToPlay'));
    expect(wanted.video.player.play).toHaveBeenCalledTimes(2);

    const unwanted = build();
    await draw(unwanted, { playing: false });
    act(() => unwanted.video.emit('readyToPlay'));
    expect(unwanted.video.player.play).not.toHaveBeenCalled();
  });

  it('asks whether it is wanted now, not when it mounted', async () => {
    const built = build();
    const { again } = await draw(built, { playing: true });
    await waitFor(() => expect(built.video.player.play).toHaveBeenCalledTimes(1));
    again(false);
    act(() => built.video.emit('readyToPlay'));
    expect(built.video.player.play).toHaveBeenCalledTimes(1);
  });

  it('removes its listener on unmount, and moves to a new onStatus without keeping the old one', async () => {
    const built = build();
    const first = vi.fn();
    const second = vi.fn();
    const { view, again } = await draw(built, { onStatus: first });
    expect(built.video.listeners).toHaveLength(1);
    again(true, second);
    expect(built.video.listeners).toHaveLength(1);
    act(() => built.video.emit('error'));
    expect(second).toHaveBeenLastCalledWith('failed');
    expect(first).not.toHaveBeenCalledWith('failed');
    view.unmount();
    expect(built.video.listeners).toHaveLength(0);
  });
});
