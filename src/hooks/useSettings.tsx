import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { DEFAULT_SETTINGS, type Settings, parseSettings } from '@/domain/settings/Settings';

const STORAGE_KEY = 'seazn.capture.settings.v1';

type SettingsApi = {
  readonly settings: Settings;
  readonly update: (patch: Partial<Settings>) => void;
  /** False when preferences will not survive a restart. Surfaced, not hidden. */
  readonly persistent: boolean;
};

const SettingsContext = createContext<SettingsApi | null>(null);

/**
 * Preferences in Context is correct, and not a violation of AGENTS.md §8.
 *
 * That rule bans putting *engine telemetry* in Context — a 1 Hz tick over three
 * hours would re-render every consumer roughly ten thousand times. Settings
 * change when a human taps a switch, a handful of times ever. Context is
 * exactly the right tool for that.
 *
 * Storage loads lazily and failure is non-fatal: if AsyncStorage is missing or
 * unreadable, settings work for the session and the screen says they will not
 * be remembered. An operator must never be blocked from the viewfinder by a
 * preference store.
 */
export function SettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [persistent, setPersistent] = useState(false);

  useEffect(() => {
    let cancelled = false;
    import('@react-native-async-storage/async-storage')
      .then(async (module) => {
        const stored = await module.default.getItem(STORAGE_KEY);
        if (cancelled) return;
        setPersistent(true);
        if (stored !== null) setSettings(parseSettings(safeParseJson(stored)));
      })
      .catch(() => {
        if (!cancelled) setPersistent(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const update = useCallback((patch: Partial<Settings>) => {
    setSettings((current) => {
      const next = { ...current, ...patch };
      // Fire and forget: a write that fails must not undo the operator's tap.
      void import('@react-native-async-storage/async-storage')
        .then((module) => module.default.setItem(STORAGE_KEY, JSON.stringify(next)))
        .catch(() => undefined);
      return next;
    });
  }, []);

  const value = useMemo(() => ({ settings, update, persistent }), [settings, update, persistent]);

  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>;
}

export function useSettings(): SettingsApi {
  const api = useContext(SettingsContext);
  if (api === null) {
    throw new Error('useSettings must be used inside a SettingsProvider');
  }
  return api;
}

function safeParseJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}
