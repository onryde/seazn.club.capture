import { useCallback } from 'react';
import { roundChipOf, rowDetail, type NamePart, type Row } from '@/domain/matchday/matchDay';
import { useFormatTime } from '@/hooks/useFormatTime';
import { useT } from '@/hooks/useLanguage';

/** What one match row on Match Day's list says (S4 design §5). */
export type RowWords = {
  /** The round chip: the desk's tag, else the round label, else none (task 8d-B). */
  readonly chip: string | null;
  readonly names: string;
  /** The names in pieces when a seat shows what it waits for, so those words can be dimmed; else null. */
  readonly parts: readonly NamePart[] | null;
  readonly detail: string | null;
};

/** Stand-ins for the two seats while the row's template is split around them; no dictionary holds either. */
const HOME = '\u0001';
const AWAY = '\u0002';

/**
 * A row's words: "Ng v Brown". A seat with no entrant says what the web desk says it waits for ("Winner of SF·2"),
 * dimmed, and "To be decided" only when the web has no words for it either (never TBD); at the right the planned time,
 * in the venue's zone `zone` (named when it is not the phone's), or the score as the server wrote it.
 */
export function useRowWords(zone: string): (row: Row) => RowWords {
  const { t } = useT();
  const time = useFormatTime();
  return useCallback(
    (row) => {
      const open = t('matchday.seat.tbd');
      const homeSlot = wordsOf(row.homeSlot);
      const awaySlot = wordsOf(row.awaySlot);
      const home = row.home ?? homeSlot ?? open;
      const away = row.away ?? awaySlot ?? open;
      const names = t('matchday.row.match', { home, away });
      const slotted =
        (row.home === null && homeSlot !== null) || (row.away === null && awaySlot !== null);
      const parts = slotted
        ? partsOf(
            t('matchday.row.match', { home: HOME, away: AWAY }),
            row,
            [home, homeSlot],
            [away, awaySlot],
          )
        : null;
      const chip = roundChipOf(row);
      const detail = rowDetail(row);
      if (detail === null) return { chip, names, parts, detail: null };
      return {
        chip,
        names,
        parts,
        detail: detail.kind === 'time' ? time(detail.at, zone) : detail.text,
      };
    },
    [t, time, zone],
  );
}

/** The template cut at its two seats: a seat is dim when it has no entrant and shows the web's words for it. */
function partsOf(
  template: string,
  row: Row,
  [home, homeSlot]: readonly [string, string | null],
  [away, awaySlot]: readonly [string, string | null],
): readonly NamePart[] {
  return template
    .split(/([\u0001\u0002])/)
    .filter((piece) => piece !== '')
    .map((piece) => {
      if (piece === HOME) return { text: home, dim: row.home === null && homeSlot !== null };
      if (piece === AWAY) return { text: away, dim: row.away === null && awaySlot !== null };
      return { text: piece, dim: false };
    });
}

/** A seat's words from the web, or null when it sent none: "" is none, so a seat is never drawn blank. */
const wordsOf = (slot: string | null): string | null =>
  slot === null || slot === '' ? null : slot;
