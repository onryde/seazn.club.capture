import { useCallback } from 'react';
import { rowDetail, type Row } from '@/domain/matchday/matchDay';
import { useFormatTime } from '@/hooks/useFormatTime';
import { useT } from '@/hooks/useLanguage';

/** What one match row on Match Day's list says (S4 design §5). */
export type RowWords = { readonly names: string; readonly detail: string | null };

/**
 * A row's words: "Ng v Brown", a seat not decided yet said in words (never TBD), and at the right the planned time,
 * in the venue's zone `zone` (named when it is not the phone's), or the score as the server wrote it.
 */
export function useRowWords(zone: string): (row: Row) => RowWords {
  const { t } = useT();
  const time = useFormatTime();
  return useCallback(
    (row) => {
      const open = t('matchday.seat.tbd');
      const names = t('matchday.row.match', { home: row.home ?? open, away: row.away ?? open });
      const detail = rowDetail(row);
      if (detail === null) return { names, detail: null };
      return { names, detail: detail.kind === 'time' ? time(detail.at, zone) : detail.text };
    },
    [t, time, zone],
  );
}
