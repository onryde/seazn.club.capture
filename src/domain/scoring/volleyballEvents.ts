import { standing, type VoidableEvent } from '@/domain/scoring/setBasedEvents';

const RALLY = 'volleyball.rally';
const SUMMARY = 'volleyball.set.summary';

/**
 * The score events standing in `events`, the ledger's or the fold's stream: the rallies and the set scores no void takes
 * back. The one count the display (`VolleyballDisplay.scoreEvents`) and a send's check share, so a tap's `base` and the
 * ledger's count are always the same measure.
 */
export const scoreEventsIn = (events: readonly VoidableEvent[]): number =>
  standing(events, RALLY, SUMMARY).length;
