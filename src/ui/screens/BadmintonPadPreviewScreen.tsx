import { memo, useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import type { BadmintonPadKey } from '@/domain/scoring/badmintonPad';
import type { SanctionSheet } from '@/domain/scoring/badmintonSanction';
import {
  cardPlacement,
  rulesKnown,
  type PadSide,
  type PadSync,
  type PadText,
  type PadView,
} from '@/domain/scoring/padView';
import { flashCue, type HalfFlash } from '@/domain/scoring/tapFlash';
import {
  useBadmintonPadPreview,
  type PadLineWords,
  type PadPreviewActions,
  type PadSheetView,
} from '@/hooks/useBadmintonPadPreview';
import { useT } from '@/hooks/useLanguage';
import { usePadText } from '@/hooks/usePadText';
import type { MessageKey } from '@/i18n/messages';
import { EndingPrompt } from '@/ui/components/EndingPrompt';
import { IconButton } from '@/ui/components/IconButton';
import { LastTapLine } from '@/ui/components/LastTapLine';
import { PadPreviewRow } from '@/ui/components/PadPreviewRow';
import { PadStateCard } from '@/ui/components/PadStateCard';
import { PadStrip } from '@/ui/components/PadStrip';
import { RulesButton } from '@/ui/components/RulesButton';
import { RulesSheet } from '@/ui/components/RulesSheet';
import { ScoreEntrySheet } from '@/ui/components/ScoreEntrySheet';
import { ScoreHalf } from '@/ui/components/ScoreHalf';
import { StepSheet, type StepOption } from '@/ui/components/StepSheet';
import { SyncDot } from '@/ui/components/SyncDot';
import { Text } from '@/ui/components/Text';
import { ToolRow } from '@/ui/components/ToolRow';
import { UpdateBanner } from '@/ui/components/UpdateBanner';
import { colour, layout, space } from '@/ui/theme/tokens';

/**
 * The badminton pad, previewed on a fake (S2's first slice; owner rulings, 2026-10-31). Portrait, layout A: the top bar
 * (Home, the Preview tag, Rules and the sync status), the strip (the game of how many, the interval), the first side's
 * half on top and the second's below (a tap on a half gives that side the rally, and a tap that counted flashes the
 * half; each shows its finished games' boxes, and the server's plate its service court), the last-tap line with the one
 * Undo, and the tools. A card that replaces the score stands where the halves were; one that goes with it (a recorded
 * result, view only) stands above them; the update banner stands where the last-tap line and the tools were
 * (`cardPlacement`). Sheets cover the pad, which is hidden from a screen reader while they show. Under it all, the
 * preview's own row of states.
 */
export function BadmintonPadPreviewScreen() {
  const { view, sheet, line, cardNote, flash, chosen, actions } = useBadmintonPadPreview();
  const covered = sheet !== null;
  const picked = useMemo(() => [chosen.card, chosen.sample], [chosen.card, chosen.sample]);
  const onRules = rulesKnown(view.card) ? actions.rules : null;
  return (
    <View style={styles.screen}>
      <View
        testID="pad-content"
        aria-hidden={covered}
        importantForAccessibility={covered ? 'no-hide-descendants' : 'auto'}
        style={styles.pad}
      >
        <PadHeader sync={view.sync} onHome={actions.home} onRules={onRules} />
        <PadStrip items={view.strip} />
        <PadBody view={view} flash={flash} onTap={actions.tapHalf} />
        <PadControls view={view} line={line} cardNote={cardNote} actions={actions} />
        <PadPreviewRow chosen={picked} onPick={actions.pick} />
      </View>
      <PadSheet sheet={sheet} actions={actions} />
    </View>
  );
}

/**
 * Home, the Preview tag, Rules (owner ruling 15; none when the match's rules are not known, `rulesKnown`), and the sync
 * status at the right: the way out, the match's rules and the transport's word, on one row at 320 dp (padFit.test.ts).
 */
const PadHeader = memo(function PadHeader({
  sync,
  onHome,
  onRules,
}: {
  readonly sync: PadSync;
  readonly onHome: () => void;
  readonly onRules: (() => void) | null;
}) {
  const { t } = useT();
  return (
    <View style={styles.header}>
      <IconButton glyph="back" label={t('stream.home')} onPress={onHome} />
      <Text variant="controlSmall" style={styles.tag}>
        {t('scoring.preview.tag')}
      </Text>
      {onRules === null ? null : <RulesButton label={t('scoring.rules.open')} onPress={onRules} />}
      <View style={styles.sync}>
        <SyncDot sync={sync} />
      </View>
    </View>
  );
});

const PadBody = memo(function PadBody({
  view,
  flash,
  onTap,
}: {
  readonly view: PadView<BadmintonPadKey>;
  readonly flash: HalfFlash;
  readonly onTap: (side: PadSide) => void;
}) {
  const card = view.card?.kind === 'updateNeeded' ? null : view.card;
  if (card !== null && cardPlacement(card) === 'instead') {
    return (
      <View style={styles.body}>
        <PadStateCard card={card} />
      </View>
    );
  }
  return (
    <View style={styles.body}>
      {card === null ? null : <PadStateCard card={card} />}
      <ScoreHalf half={view.halves[0]} flash={flashCue(flash, 'first')} onTap={onTap} />
      <ScoreHalf half={view.halves[1]} flash={flashCue(flash, 'second')} onTap={onTap} />
    </View>
  );
});

/**
 * Under the halves: the last-tap line and the tools, or, when an update is needed, the banner in their place
 * (`cardPlacement`'s `forControls`, the one card there; `PadBody` draws the others).
 */
const PadControls = memo(function PadControls({
  view,
  line,
  cardNote,
  actions,
}: {
  readonly view: PadView<BadmintonPadKey>;
  readonly line: PadLineWords;
  readonly cardNote: MessageKey | null;
  readonly actions: PadPreviewActions;
}) {
  const { t } = useT();
  const { card } = view;
  if (card?.kind === 'updateNeeded') {
    return (
      <UpdateBanner
        unsent={card.unsent}
        note={cardNote === null ? null : t(cardNote)}
        onUpdate={actions.update}
        onBrowser={actions.browser}
      />
    );
  }
  return (
    <>
      <PadLine view={view} line={line} onUndo={actions.undo} />
      <ToolRow tools={view.tools} onTool={actions.tool} />
    </>
  );
});

/**
 * The last tap's sentence and Undo. A refusal takes the sentence's place (the tap did not count); a note goes under
 * it, which stays (a repeat that counted once: the rally the scorer gave is still on screen).
 */
const PadLine = memo(function PadLine({
  view,
  line,
  onUndo,
}: {
  readonly view: PadView<BadmintonPadKey>;
  readonly line: PadLineWords;
  readonly onUndo: () => void;
}) {
  const { t } = useT();
  const words = line === null ? null : t(line.key);
  return (
    <LastTapLine
      lastTap={view.lastTap}
      refusal={line?.kind === 'refusal' ? words : null}
      note={line?.kind === 'note' ? words : null}
      onUndo={onUndo}
    />
  );
});

const PadSheet = memo(function PadSheet({
  sheet,
  actions,
}: {
  readonly sheet: PadSheetView | null;
  readonly actions: PadPreviewActions;
}) {
  if (sheet === null) return null;
  switch (sheet.kind) {
    case 'sanction':
      return <SanctionSteps sheet={sheet.sheet} actions={actions} />;
    case 'setScore':
      return (
        <SetScore game={sheet.game} names={sheet.names} points={sheet.points} actions={actions} />
      );
    case 'ending':
      return (
        <EndingPrompt
          person={sheet.person}
          onRecord={actions.recordEnding}
          onVoid={actions.voidSanction}
        />
      );
    case 'rules':
      return <MatchRules lines={sheet.lines} onClose={actions.cancel} />;
  }
});

/** The match's rules (owner ruling 15), in the operator's language, in the kit's sheet; Close is the sheets' close. */
const MatchRules = memo(function MatchRules({
  lines,
  onClose,
}: {
  readonly lines: readonly PadText<BadmintonPadKey>[];
  readonly onClose: () => void;
}) {
  const { t } = useT();
  const words = usePadText();
  const said = useMemo(() => lines.map((line) => words(line)), [lines, words]);
  return (
    <RulesSheet
      title={t('scoring.rules.title')}
      lines={said}
      closeLabel={t('panel.close')}
      onClose={onClose}
    />
  );
});

const SanctionSteps = memo(function SanctionSteps({
  sheet,
  actions,
}: {
  readonly sheet: SanctionSheet;
  readonly actions: PadPreviewActions;
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
      body={words(sheet.body)}
      options={options}
      cancelLabel={t('scoring.sheet.cancel')}
      onChoose={actions.choose}
      onCancel={actions.cancel}
    />
  );
});

/** Set score, its title naming the game it sets: "Set score · Game 2" (the controller's call, 2026-10-31). */
const SetScore = memo(function SetScore({
  game,
  names,
  points,
  actions,
}: {
  readonly game: number;
  readonly names: readonly [string, string];
  readonly points: readonly [number, number];
  readonly actions: PadPreviewActions;
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
      confirmLabel={t('scoring.setScore.confirm')}
      cancelLabel={t('scoring.sheet.cancel')}
      onSave={actions.saveScore}
      onCancel={actions.cancel}
    />
  );
});

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colour.ground },
  pad: { flex: 1, gap: space.sm, padding: space.md },
  // `space.xs` apart: at 320 dp Back, the tag, Rules and the sync words share the row (padFit.test.ts).
  header: { flexDirection: 'row', alignItems: 'center', gap: space.xs, minHeight: layout.touch },
  tag: {
    paddingHorizontal: space.xs,
    borderWidth: layout.iconBorder,
    borderColor: colour.ink3,
    borderRadius: space.xs,
  },
  sync: { flex: 1, minWidth: 0, alignItems: 'flex-end' },
  body: { flex: 1, gap: space.sm },
});
