import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import { usePorts } from '@/hooks/usePorts';
import type { StreamSettings } from '@/services/streamSettingsStore';

/**
 * The stream settings for the viewfinder and Settings. Loads once, on first
 * use; `saveFailed` says the last change held for this session only (D23).
 */
export function useStreamSettings(): {
  readonly settings: StreamSettings;
  readonly saveFailed: boolean;
  change(change: Partial<StreamSettings>): void;
} {
  const { streamSettings } = usePorts();
  const settings = useSyncExternalStore(streamSettings.subscribe, streamSettings.getSnapshot);
  const [saveFailed, setSaveFailed] = useState(false);
  useEffect(() => {
    void streamSettings.load();
  }, [streamSettings]);
  const change = useCallback(
    (next: Partial<StreamSettings>) => {
      // Saves settle in the order they were asked (serialSaves), so this ends on the last one.
      void streamSettings.set(next).then((result) => setSaveFailed(result === 'refused'));
    },
    [streamSettings],
  );
  return { settings, saveFailed, change };
}
