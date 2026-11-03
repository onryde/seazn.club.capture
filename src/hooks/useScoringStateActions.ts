import { useCallback, useMemo, useRef, useState } from 'react';
import { browserTarget } from '@/hooks/browserTarget';
import { dismissMatch } from '@/hooks/scoringOpen';
import { useBackCloses } from '@/hooks/useBackCloses';
import { usePorts } from '@/hooks/usePorts';
import { atStake, type AtStake } from '@/hooks/useScoringHome';
import { STORE_URL } from '@/hooks/useScoringMatch';
import { useBackToHome } from '@/hooks/useStreamLinks';
import type { MessageKey } from '@/i18n/messages';
import { readScoringLink } from '@/services/scoringLinkStore';

/**
 * What a scoring state's buttons do (plan S2-1 Task 11), for any sport: the same three ways out the pad's update banner
 * and Home's cards have, for a match that is not a pad. Update opens the store; the browser opens this match's scoring
 * page, read from the link as it is kept (the state has no runner to ask); Dismiss lets the match go, asking first when
 * taps would be thrown away (owner ruling B, 2026-11-02), and then goes Home. A page that would not open, or a delete
 * the disk refused, says so on the card; it never stays silent (R19).
 */
export type StateActions = {
  readonly update: () => void;
  readonly browser: () => void;
  readonly dismiss: () => void;
  /** What a button said when it could not do its job; null otherwise. */
  readonly note: MessageKey | null;
  /** The question before a Dismiss that discards taps: null when none is asked. */
  readonly asking: AtStake | null;
  /** The question's Keep, and what the dim and Back mean. */
  readonly keep: () => void;
  /** The question's Dismiss. */
  readonly confirm: () => void;
};

export function useScoringStateActions(fixtureId: string): StateActions {
  const [note, setNote] = useState<MessageKey | null>(null);
  const [asking, setAsking] = useState<AtStake | null>(null);
  const open = useOpen(setNote);
  const update = useCallback(() => open(STORE_URL), [open]);
  const browser = useBrowser(fixtureId, open, setNote);
  const home = useBackToHome();
  const { dismiss, confirm } = useDismiss(fixtureId, home, setNote, setAsking);
  const keep = useCallback(() => setAsking(null), []);
  useBackCloses(asking !== null, keep);
  return useMemo(
    () => ({ update, browser, dismiss, note, asking, keep, confirm }),
    [update, browser, dismiss, note, asking, keep, confirm],
  );
}

/** A page opened through the link port: its note is cleared by a success, set by a refusal. */
function useOpen(setNote: (note: MessageKey | null) => void) {
  const { link } = usePorts();
  return useCallback(
    (url: string) => {
      link.openUrl(url).then(
        () => setNote(null),
        () => setNote('scoring.card.cantOpen'),
      );
    },
    [link, setNote],
  );
}

/** The browser: the match's own scoring page on the build's host, or a note when the link is not there to open. */
function useBrowser(
  fixtureId: string,
  open: (url: string) => void,
  setNote: (note: MessageKey | null) => void,
) {
  const { kv, hosts } = usePorts();
  const host = hosts[0] ?? '';
  return useCallback(() => {
    void readScoringLink(kv, fixtureId, host).then((stored) => {
      const target = stored.kind === 'link' ? browserTarget(host, stored.link) : null;
      if (target === null) setNote('scoring.card.cantOpen');
      else open(target);
    });
  }, [kv, fixtureId, host, open, setNote]);
}

/**
 * Dismiss: reads what is at stake as it is pressed, asks when taps would go, else lets the match go at once. One read
 * and one delete are in flight at a time, so a second press reads, asks and deletes nothing again. A refused delete
 * frees the buttons.
 */
function useDismiss(
  fixtureId: string,
  home: () => void,
  setNote: (note: MessageKey | null) => void,
  setAsking: (stake: AtStake | null) => void,
) {
  const ports = usePorts();
  const busy = useRef(false);
  const letting = useRef(false);
  const letGo = useCallback(() => {
    if (letting.current) return;
    letting.current = true;
    setAsking(null);
    dismissMatch(ports, fixtureId).then(home, () => {
      letting.current = false;
      setNote('scoring.state.exitFailed');
    });
  }, [ports, fixtureId, home, setNote, setAsking]);
  const dismiss = useCallback(() => {
    if (busy.current) return;
    busy.current = true;
    void atStake(ports, fixtureId).then((stake) => {
      busy.current = false;
      if (stake === null) letGo();
      else setAsking(stake);
    });
  }, [ports, fixtureId, letGo, setAsking]);
  return { dismiss, confirm: letGo };
}
