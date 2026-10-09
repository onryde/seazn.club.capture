import type { FunctionComponent } from 'react';

export type PreviewProps = Record<string, never>;
/** What the viewer player says of itself (spec §9): the native player's own word, in three. */
export type VideoStatus = 'loading' | 'ready' | 'failed';
export type VideoProps = {
  readonly url: string;
  readonly playing: boolean;
  /** Told on mount and on every change: the layer shows nothing it has not been told is a picture. */
  readonly onStatus?: (status: VideoStatus) => void;
};

/**
 * The native views the viewfinder draws, as a port (D16). Screens never import
 * expo-video, so they render on react-native-web in tests with the fakes in
 * test/fakeSurfaces.ts. Phase 4 swaps Preview for the engine's native view;
 * frames never cross the bridge (AGENTS §2).
 *
 * Function components, not `ComponentType`: a class has no call signature, and
 * the fakes' contract is tested by calling them.
 */
export interface Surfaces {
  readonly Preview: FunctionComponent<PreviewProps>;
  readonly Video: FunctionComponent<VideoProps>;
}
