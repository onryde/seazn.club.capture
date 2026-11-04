import { memo, useMemo } from 'react';
import type {
  PadHistoryGroup,
  PadHistoryRow,
  PadMatchDetails,
  PadText,
  PadVar,
} from '@/domain/scoring/padView';
import { useT } from '@/hooks/useLanguage';
import { usePadText } from '@/hooks/usePadText';
import type { MessageKey } from '@/i18n/messages';
import { DetailsCard } from '@/ui/components/DetailsCard';
import { DismissSheet } from '@/ui/components/DismissSheet';
import { HistoryCover, type HistoryGroupWords } from '@/ui/components/HistoryCover';
import { MatchDetailsSheet } from '@/ui/components/MatchDetailsSheet';
import { ScoreEntrySheet } from '@/ui/components/ScoreEntrySheet';
import { StepSheet, type StepOption } from '@/ui/components/StepSheet';

/**
 * The sheets the set-based sports' screens draw alike (plan S2-2 Task 8, lifted from badminton's screen so table tennis's
 * does not copy them): a step sheet in the operator's language, Set score, Match details, History and Discard's confirm.
 * Each sport's screen keeps its own switch over its sheets, and which sheets it has.
 */

/** A step of choices: its words are the sport's, translated here; the choices' ids go back to the caller as they are. */
export type StepSheetFacts = {
  readonly title: PadText<MessageKey>;
  /** What is already chosen ("A. Sharma", "Warning"), or what the step means; none when the step needs no line. */
  readonly body: PadVar<MessageKey> | null;
  readonly options: readonly {
    readonly id: string;
    readonly label: PadVar<MessageKey>;
    readonly tone: StepOption['tone'];
  }[];
};

export const StepSheetView = memo(function StepSheetView({
  sheet,
  onChoose,
  onCancel,
}: {
  readonly sheet: StepSheetFacts;
  readonly onChoose: (id: string) => void;
  readonly onCancel: () => void;
}) {
  const { t } = useT();
  const words = usePadText();
  const options = useMemo<readonly StepOption[]>(
    () => sheet.options.map((option) => ({ ...option, label: words(option.label) })),
    [sheet.options, words],
  );
  return (
    <StepSheet
      title={words(sheet.title)}
      body={sheet.body === null ? null : words(sheet.body)}
      options={options}
      cancelLabel={t('scoring.sheet.cancel')}
      onChoose={onChoose}
      onCancel={onCancel}
    />
  );
});

/**
 * Set score, its title naming the game it sets: "Set score · Game 2" (the controller's call, 2026-10-31). `bound` is the
 * most either field may hold, when the sport's rules say; a sport that names none takes the sheet's own limit.
 */
export const SetScoreSheet = memo(function SetScoreSheet({
  game,
  names,
  points,
  bound,
  onSave,
  onCancel,
}: {
  readonly game: number;
  readonly names: readonly [string, string];
  readonly points: readonly [number, number];
  readonly bound?: number;
  readonly onSave: (first: string, second: string) => void;
  readonly onCancel: () => void;
}) {
  const { t } = useT();
  const labels = useMemo(
    () =>
      [
        t('scoring.setScore.field', { side: names[0] }),
        t('scoring.setScore.field', { side: names[1] }),
      ] as const,
    [names, t],
  );
  return (
    <ScoreEntrySheet
      title={t('scoring.setScore.title', { game })}
      labels={labels}
      initial={points}
      bound={bound}
      confirmLabel={t('scoring.setScore.confirm')}
      cancelLabel={t('scoring.sheet.cancel')}
      onSave={onSave}
      onCancel={onCancel}
    />
  );
});

/** Discard's confirm over the reconnect question (owner ruling 43): Keep, the plate and the way back, or Discard. */
export const DiscardAsk = memo(function DiscardAsk({
  queued,
  onKeep,
  onDiscard,
}: {
  readonly queued: number;
  readonly onKeep: () => void;
  readonly onDiscard: () => void;
}) {
  const { t, tp } = useT();
  return (
    <DismissSheet
      title={tp('scoring.ask.confirm.title', queued)}
      body={tp('scoring.ask.confirm.body', queued)}
      keepLabel={t('scoring.ask.confirm.keep')}
      dismissLabel={t('scoring.ask.confirm.discard')}
      onKeep={onKeep}
      onDismiss={onDiscard}
    />
  );
});

/** History (owner ruling 21) in the operator's language: each row's sentence, score, recorder and "Undone". */
export const MatchHistory = memo(function MatchHistory({
  groups,
  onClose,
}: {
  readonly groups: readonly PadHistoryGroup<MessageKey>[];
  readonly onClose: () => void;
}) {
  const { t } = useT();
  const words = usePadText();
  const said = useMemo<readonly HistoryGroupWords[]>(
    () =>
      groups.map((group) => ({
        heading: words(group.heading),
        rows: group.rows.map((row) => ({
          said: words(row.said),
          score: row.score,
          by: t(BY[row.by]),
          undone: row.undone ? t('scoring.history.undone') : null,
          sending: row.sending ? t('scoring.history.sending') : null,
        })),
      })),
    [groups, words, t],
  );
  return (
    <HistoryCover
      title={t('scoring.history.title')}
      closeLabel={t('panel.close')}
      empty={t('scoring.history.empty')}
      groups={said}
      onClose={onClose}
    />
  );
});

const BY = {
  thisPhone: 'scoring.history.thisPhone',
  otherScorer: 'scoring.history.otherScorer',
} as const satisfies Record<PadHistoryRow<MessageKey>['by'], MessageKey>;

/**
 * Match details (owner ruling 15, then 2026-11-01) in the kit's sheet: the match card and Close (option A), Close the
 * sheets' close.
 */
export const MatchDetailsView = memo(function MatchDetailsView({
  details,
  onClose,
}: {
  readonly details: PadMatchDetails<MessageKey>;
  readonly onClose: () => void;
}) {
  const { t } = useT();
  return (
    <MatchDetailsSheet closeLabel={t('panel.close')} onClose={onClose}>
      <DetailsCard details={details} />
    </MatchDetailsSheet>
  );
});
