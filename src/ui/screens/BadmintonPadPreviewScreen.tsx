import { memo, useMemo } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import type { BadmintonPadKey } from '@/domain/scoring/badmintonPad';
import type { SanctionSheet } from '@/domain/scoring/badmintonSanction';
import {
  cardPlacement,
  matchKnown,
  type PadHistoryGroup,
  type PadHistoryRow,
  type PadMatchDetails,
  type PadSide,
  type PadStart,
  type PadSync,
  type PadTally,
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
import { Button } from '@/ui/components/Button';
import { EndingPrompt } from '@/ui/components/EndingPrompt';
import { HistoryCover, type HistoryGroupWords } from '@/ui/components/HistoryCover';
import { IconButton } from '@/ui/components/IconButton';
import { LastTapLine } from '@/ui/components/LastTapLine';
import { MatchCard } from '@/ui/components/MatchCard';
import { MatchDetailsSheet } from '@/ui/components/MatchDetailsSheet';
import { PadPreviewRow } from '@/ui/components/PadPreviewRow';
import { PadStateCard } from '@/ui/components/PadStateCard';
import { PadStrip } from '@/ui/components/PadStrip';
import { ScoreEntrySheet } from '@/ui/components/ScoreEntrySheet';
import { ScoreHalf } from '@/ui/components/ScoreHalf';
import { StepSheet, type StepOption } from '@/ui/components/StepSheet';
import { SyncDot } from '@/ui/components/SyncDot';
import { Text } from '@/ui/components/Text';
import { ToolRow } from '@/ui/components/ToolRow';
import { TossPicker } from '@/ui/components/TossPicker';
import { UpdateBanner } from '@/ui/components/UpdateBanner';
import { colour, layout, space } from '@/ui/theme/tokens';

/**
 * The badminton pad, previewed on a fake (S2's first slice; owner rulings, 2026-10-31). Portrait, layout A: the top bar
 * (Home, the games tally, then Rules, History and the sync status at the right end), the strip (the game of how many at
 * the left, the interval at the right), the first side's half on top and the second's below (a tap on a half gives that side the rally, and a
 * tap that counted flashes the half; each shows its finished games' boxes, and the server's plate its service court),
 * the last-tap line with the one Undo, and the tools. A card that replaces the score stands where the halves were; one that goes with it (a recorded
 * result, view only) stands above them; the update banner stands where the last-tap line and the tools were
 * (`cardPlacement`). Sheets and History cover the pad, which is hidden from a screen reader while they show. Under it
 * all, the preview's own row of states. Until the match starts, the Start screen stands where the halves are, with no
 * last-tap line and no tools (owner, 2026-11-01, option A).
 */
export function BadmintonPadPreviewScreen() {
  const { view, sheet, line, cardNote, flash, toss, chosen, actions } = useBadmintonPadPreview();
  const covered = sheet !== null;
  const picked = useMemo(() => [chosen.card, chosen.sample], [chosen.card, chosen.sample]);
  const known = matchKnown(view.card);
  return (
    <View style={styles.screen}>
      <View
        testID="pad-content"
        aria-hidden={covered}
        importantForAccessibility={covered ? 'no-hide-descendants' : 'auto'}
        style={styles.pad}
      >
        <PadHeader sync={view.sync} tally={view.tally} known={known} actions={actions} />
        <PadStrip items={view.strip} />
        {view.start === null ? (
          <PadBody view={view} flash={flash} onTap={actions.tapHalf} />
        ) : (
          <StartPanel start={view.start} details={view.details} toss={toss} actions={actions} />
        )}
        <PadControls view={view} line={line} cardNote={cardNote} actions={actions} />
        <PadPreviewRow chosen={picked} onPick={actions.pick} />
      </View>
      <PadSheet sheet={sheet} actions={actions} />
    </View>
  );
}

/**
 * Owner ruling 20 (2026-10-31): Home, then at the right end Rules and History, round icon buttons as Home's gear, and
 * the sync status in its fixed box. Between them, where the Preview tag was, the games tally in lime (owner,
 * 2026-11-01); the preview row at the bottom marks the preview. The tally, Rules and History need a match
 * (`matchKnown`): none on a dead link's card. One 48 dp row at 320 and 360 dp in four languages (padFit.test.ts).
 */
const PadHeader = memo(function PadHeader({
  sync,
  tally,
  known,
  actions,
}: {
  readonly sync: PadSync;
  readonly tally: PadTally<BadmintonPadKey>;
  readonly known: boolean;
  readonly actions: PadPreviewActions;
}) {
  const { t } = useT();
  return (
    <View style={styles.header}>
      <IconButton glyph="back" label={t('stream.home')} onPress={actions.home} />
      {known ? <GamesTally tally={tally} /> : null}
      <HeaderEnd sync={sync} known={known} actions={actions} />
    </View>
  );
});

/** The top bar's right end: Match details and History while the match is known, then the sync status in its box. */
const HeaderEnd = memo(function HeaderEnd({
  sync,
  known,
  actions,
}: {
  readonly sync: PadSync;
  readonly known: boolean;
  readonly actions: PadPreviewActions;
}) {
  return (
    <View testID="pad-header-end" style={styles.end}>
      {known ? <MatchIcons actions={actions} /> : null}
      <View testID="sync-box" style={styles.sync}>
        <SyncDot sync={sync} />
      </View>
    </View>
  );
});

/** "1:0", top side first, said "Games: A. Sharma 1, L. Chen 0" (owner, 2026-11-01). Never cut: it never shrinks. */
const GamesTally = memo(function GamesTally({
  tally,
}: {
  readonly tally: PadTally<BadmintonPadKey>;
}) {
  const words = usePadText();
  return (
    <Text
      testID="tally"
      variant="tally"
      accessibilityLabel={words(tally.said)}
      style={styles.tally}
    >
      {tally.shown}
    </Text>
  );
});

/** Match details (owner ruling 15, then 2026-11-01) and History (ruling 21), named so (ruling 20). */
const MatchIcons = memo(function MatchIcons({ actions }: { readonly actions: PadPreviewActions }) {
  const { t } = useT();
  return (
    <>
      <IconButton glyph="info" label={t('scoring.details.title')} onPress={actions.details} />
      <IconButton glyph="history" label={t('scoring.history.title')} onPress={actions.history} />
    </>
  );
});

/**
 * The halves, under a card that goes with them; or a card in their place, scrolling when it is taller than the room.
 * Not started's card carries the match card between its title and its sentence (owner, 2026-11-01, option A).
 */
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
      <ScrollView testID="pad-card-scroll" style={styles.body}>
        <PadStateCard card={card}>
          {card.kind === 'notStarted' ? <DetailsCard details={view.details} /> : null}
        </PadStateCard>
      </ScrollView>
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
 * The Start screen (owner, 2026-11-01, option A), in the halves' place until the match starts: the match card, who
 * serves first, then Start match, a tap and no hold (it is not destructive: Undo takes it back). It scrolls when it is
 * taller than the room. Start match is disabled, and says so, until a side is picked.
 */
const StartPanel = memo(function StartPanel({
  start,
  details,
  toss,
  actions,
}: {
  readonly start: PadStart<BadmintonPadKey>;
  readonly details: PadMatchDetails<BadmintonPadKey>;
  readonly toss: PadSide | null;
  readonly actions: PadPreviewActions;
}) {
  const { t } = useT();
  const words = usePadText();
  return (
    <ScrollView testID="start-screen" style={styles.body} contentContainerStyle={styles.start}>
      <DetailsCard details={details} />
      <TossPicker
        ask={words(start.ask)}
        sides={start.sides}
        picked={toss}
        onPick={actions.pickServer}
      />
      <Button label={t('scoring.start.confirm')} onPress={actions.start} disabled={toss === null} />
    </ScrollView>
  );
});

/**
 * Under the halves: the last-tap line and the tools, or, when an update is needed, the banner in their place
 * (`cardPlacement`'s `forControls`, the one card there; `PadBody` draws the others). Nothing under the Start screen.
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
  if (view.start !== null) return null;
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
    case 'details':
      return <MatchDetailsView details={sheet.details} onClose={actions.dismiss} />;
    case 'history':
      return <MatchHistory groups={sheet.groups} onClose={actions.cancel} />;
  }
});

/** History (owner ruling 21) in the operator's language: each row's sentence, score, recorder and "Undone". */
const MatchHistory = memo(function MatchHistory({
  groups,
  onClose,
}: {
  readonly groups: readonly PadHistoryGroup<BadmintonPadKey>[];
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
} as const satisfies Record<PadHistoryRow<BadmintonPadKey>['by'], MessageKey>;

/**
 * Match details (owner ruling 15, then 2026-11-01) in the kit's sheet: the match card and Close (option A), Close the
 * sheets' close.
 */
const MatchDetailsView = memo(function MatchDetailsView({
  details,
  onClose,
}: {
  readonly details: PadMatchDetails<BadmintonPadKey>;
  readonly onClose: () => void;
}) {
  const { t } = useT();
  return (
    <MatchDetailsSheet closeLabel={t('panel.close')} onClose={onClose}>
      <DetailsCard details={details} />
    </MatchDetailsSheet>
  );
});

/**
 * The match card (owner, 2026-11-01, option A) with the sport's rule rows in the operator's language: the one drawing
 * of Match details, on the Start screen, the Not started card and the sheet alike.
 */
const DetailsCard = memo(function DetailsCard({
  details,
}: {
  readonly details: PadMatchDetails<BadmintonPadKey>;
}) {
  const words = usePadText();
  const rows = useMemo(
    () => details.rules.map((row) => ({ label: words(row.label), value: words(row.value) })),
    [details.rules, words],
  );
  return <MatchCard context={details.context} rows={rows} />;
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
  // `space.xs` apart: Back, the tally, Rules, History and the sync box share the row (padFit.test.ts).
  header: { flexDirection: 'row', alignItems: 'center', gap: space.xs, minHeight: layout.touch },
  tally: { flexShrink: 0 },
  // Pushed to the right end by its auto margin: the row's spare room stands between the tally and Rules.
  end: { flexDirection: 'row', alignItems: 'center', gap: space.xs, marginLeft: 'auto' },
  sync: { width: layout.padSyncBox, alignItems: 'flex-end' },
  body: { flex: 1, gap: space.sm },
  start: { gap: space.md, paddingBottom: space.md },
});
