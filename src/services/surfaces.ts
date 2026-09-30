import type { FunctionComponent } from 'react';

export type PreviewProps = Record<string, never>;
export type OverlayProps = { readonly url: string; readonly onFailed: () => void };
export type VideoProps = { readonly url: string; readonly playing: boolean };

/**
 * The native views the viewfinder draws, as a port (D16). Screens never import
 * react-native-webview or expo-video, so they render on react-native-web in
 * tests with the fakes in test/fakeSurfaces.ts. Phase 4 swaps Preview for the
 * engine's native view; frames never cross the bridge (AGENTS §2).
 *
 * Function components, not `ComponentType`: a class has no call signature, and
 * the fakes' contract is tested by calling them.
 */
export interface Surfaces {
  readonly Preview: FunctionComponent<PreviewProps>;
  readonly Overlay: FunctionComponent<OverlayProps>;
  readonly Video: FunctionComponent<VideoProps>;
}
