import { useMemo, useSyncExternalStore } from 'react';
import type { Mode } from '@/domain/mode/Mode';
import { scoringOrigin, type ScoringOrigin } from '@/domain/mode/scoringOrigin';
import { useT } from '@/hooks/useLanguage';
import { usePorts } from '@/hooks/usePorts';
import type { OpenMatch } from '@/services/matchDayStore';
import type { ModeStore } from '@/services/modeStore';

const activeMode = (store: ModeStore): Mode | null => {
  const snapshot = store.getSnapshot();
  return snapshot.status === 'ready' ? snapshot.saved.active : null;
};

/** The match Match Day has open, or null; "not read yet" is none here, as it is for Back. */
export function useOpenMatch(): OpenMatch | null {
  const { matchDayStore } = usePorts();
  return useSyncExternalStore(matchDayStore.subscribeOpen, () => matchDayStore.openMatch() ?? null);
}

/**
 * Where Remote Scoring's Back goes and what it is called (S4 design §6): the Match Day list, "‹ {court}", when the mode
 * is Match Day and a match is open; Home otherwise. Read in render, so the label follows the store.
 */
export function useScoringOrigin(): ScoringOrigin {
  const { modeStore } = usePorts();
  const active = useSyncExternalStore(modeStore.subscribe, () => activeMode(modeStore));
  const open = useOpenMatch();
  return useMemo(() => scoringOrigin(active, open), [active, open]);
}

/** What the pad's Back is called: "‹ Court 1" from Match Day's list, "Home" otherwise (a screen reader's name for it). */
export function useBackLabel(): string {
  const { t } = useT();
  const origin = useScoringOrigin();
  return origin.back === 'matchday' ? origin.label : t('stream.home');
}
