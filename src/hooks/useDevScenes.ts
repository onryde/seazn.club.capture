import { useCallback, useMemo } from 'react';
import { FAKE_SCENES, type FakeScene } from '@/engine/FakeCaptureEngine';
import { usePorts } from '@/hooks/usePorts';

/** A fake engine scene, named for the screens that list them. */
export type DevScene = FakeScene;

export type DevSceneControls = {
  readonly scenes: readonly DevScene[];
  play(scene: DevScene): void;
};

/**
 * Development builds only (D25): every state of spec §6, one tap away on a
 * laptop or a phone. Null in a release build, and wherever the fake engine
 * is not the one wired (`devEngine` is null).
 */
export function useDevScenes(): DevSceneControls | null {
  const { devEngine, devTools } = usePorts();
  const play = useCallback((scene: DevScene) => devEngine?.scene(scene), [devEngine]);
  return useMemo(
    () => (devTools && devEngine !== null ? { scenes: FAKE_SCENES, play } : null),
    [devTools, devEngine, play],
  );
}
