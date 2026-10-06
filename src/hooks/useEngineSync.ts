import { useEffect, useRef, useState } from 'react';
import { selectEngineStatus } from '@/hooks/engineSelectors';
import { useLanguage } from '@/hooks/useLanguage';
import { usePorts } from '@/hooks/usePorts';

/**
 * Keeps native's copy of two operator choices equal to JS's (amendment §2;
 * P3): the automatic switch (A4) and the notification's language. A
 * reconciler, not a relay: it compares the snapshot's `pairing.automatic`
 * with the store on every change of either, so a `pair` sent before the store
 * loaded, or a switch flipped while a snapshot was in flight, still converges.
 */
export function useEngineSync(): void {
  useAutomaticSync();
  useLanguageSync();
}

/**
 * Native ignores `setAutomatic` only in Ended, which `sync` skips, so an
 * unequal pair can never send on every snapshot: one intent per change.
 */
function useAutomaticSync(): void {
  const { engine, streamSettings, logger } = usePorts();
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    let alive = true;
    void streamSettings.load().then(() => alive && setLoaded(true));
    return () => {
      alive = false;
    };
  }, [streamSettings]);
  useEffect(() => {
    if (!loaded) return undefined;
    const sync = () => {
      const { pairing, state } = engine.getSnapshot();
      const wanted = streamSettings.getSnapshot().automatic;
      if (pairing === null || state.kind === 'ended' || pairing.automatic === wanted) return;
      logger.info('intent.setAutomatic', { action: wanted ? 'on' : 'off' });
      engine.send({ kind: 'setAutomatic', on: wanted });
    };
    const offEngine = engine.subscribe(sync);
    const offSettings = streamSettings.subscribe(sync);
    sync();
    return () => {
      offEngine();
      offSettings();
    };
  }, [loaded, engine, streamSettings, logger]);
}

/** P3, updated by the amendment: the notification follows the operator's pick while paired or live. */
function useLanguageSync(): void {
  const { engine, logger } = usePorts();
  const { lang } = useLanguage();
  // What native holds, or will hold: the next `pair` carries the current pick
  // (usePairing), so a pick made while idle is known too (review M11).
  const known = useRef<string | null>(null);
  useEffect(() => {
    const previous = known.current;
    known.current = lang;
    if (previous === null || previous === lang) return;
    const status = selectEngineStatus(engine.getSnapshot());
    if (status !== 'paired' && status !== 'live') return;
    logger.info('intent.setLanguage', { action: lang });
    engine.send({ kind: 'setLanguage', language: lang });
  }, [lang, engine, logger]);
}
