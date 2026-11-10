import { memo, useMemo, type ReactNode } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import {
  cardPlacement,
  hasUndoCell,
  matchKnown,
  type PadMatchDetails,
  type PadSide,
  type PadStart,
  type PadStartSide,
  type PadSync,
  type PadTally,
  type PadView,
} from '@/domain/scoring/padView';
import { flashCue, type HalfFlash } from '@/domain/scoring/tapFlash';
import type { PadActions, PadLineWords } from '@/hooks/padScreenModel';
import { useT } from '@/hooks/useLanguage';
import { usePadText } from '@/hooks/usePadText';
import type { MessageKey } from '@/i18n/messages';
import { Button } from '@/ui/components/Button';
import { DetailsCard } from '@/ui/components/DetailsCard';
import { IconButton } from '@/ui/components/IconButton';
import { LastTapLine } from '@/ui/components/LastTapLine';
import { PadStateCard, type TitledCard } from '@/ui/components/PadStateCard';
import { PadStrip } from '@/ui/components/PadStrip';
import { RefusalBanner } from '@/ui/components/RefusalBanner';
import { ScoreHalf } from '@/ui/components/ScoreHalf';
import { StartSides } from '@/ui/components/StartSides';
import { SyncBadge } from '@/ui/components/SyncBadge';
import { Text } from '@/ui/components/Text';
import { ToolRow } from '@/ui/components/ToolRow';
import { TossPicker, type TossOption } from '@/ui/components/TossPicker';
import { UpdateBanner } from '@/ui/components/UpdateBanner';
import { layout, space } from '@/ui/theme/tokens';

/**
 * The buttons a set-based pad's content sends (plan S2-2 Task 8, lifted from badminton's screen): every pad's
 * (`PadActions`) and the Start screen's, where the scorer says who serves first and starts the match. A sport's model has
 * more (its sheets' choices); they are its screen's.
 */
export type PadContentActions = PadActions & {
  readonly pickServer: (side: PadSide) => void;
  readonly start: () => void;
};

/** What the pad's content is drawn from: the part of a sport's model that is the same for every set-based sport. */
export type PadContentModel = {
  readonly view: PadView<MessageKey>;
  readonly line: PadLineWords;
  readonly cardNote: MessageKey | null;
  readonly flash: HalfFlash;
  /** The Start screen's pick of who serves first; none until the scorer picks, and none once the match starts. */
  readonly toss: PadSide | null;
  readonly actions: PadContentActions;
};

type PadContentProps = {
  readonly model: PadContentModel;
  readonly covered: boolean;
  /** A sport's own score area, in the halves' place (the controller's ruling 4, the interface cricket shares). */
  readonly body?: ReactNode;
  /**
   * Whether the last-tap line carries the pad's Undo (default yes). A sport whose body has its own Undo key (cricket's
   * Out, Undo, More row, ruling 79) says no, so the pad has one Undo, never two.
   */
  readonly lineUndo?: boolean;
  /**
   * Whether the card and the body scroll together when taller than the room (default no: the body is the flex region the
   * sport's keys leave). A sport says yes only for a body with no keys under it and no flex height of its own (cricket's
   * decided board), so nothing scrolls under a key and the header and the last-tap line stay fixed.
   */
  readonly scrolls?: boolean;
};

/**
 * The set-based sports' pad, portrait, layout A: the top bar (Home, the games tally, then Rules, History and the sync
 * status at the right end), the strip (the game of how many at the left, a sport's note at the right), the first side's
 * half on top and the second's below (a tap on a half gives that side the rally, and a tap that counted flashes the
 * half; each shows its finished games' boxes, and the server's plate its service), the last-tap line with the one
 * Undo, and the tools. A card that replaces the score stands where the halves were; one that goes with it (a recorded
 * result, view only) stands above them; the update banner stands where the last-tap line and the tools were
 * (`cardPlacement`). Until the match starts, the Start screen stands where the halves are, with no last-tap line and no
 * tools (owner, 2026-11-01, option A). `covered` hides the pad from a screen reader while a sheet shows. A sport that
 * draws its own board (cricket; football's the same interface) hands it in as `body`: drawn in the halves' place, under a
 * card that goes with the score, and never over a card that stands instead of it or over the Start screen. Lifted from
 * badminton's screen for table tennis's (plan S2-2 Task 8, design §6); the screen of each sport keeps its own frame (what
 * holds the screen on) and its own sheets.
 */
export const PadContent = memo(function PadContent({
  model,
  covered,
  body,
  lineUndo = true,
  scrolls = false,
}: PadContentProps) {
  const { view, line, cardNote, flash, toss, actions } = model;
  const known = matchKnown(view.card);
  return (
    <View
      testID="pad-content"
      aria-hidden={covered}
      importantForAccessibility={covered ? 'no-hide-descendants' : 'auto'}
      style={styles.pad}
    >
      <PadHeader sync={view.sync} tally={view.tally} known={known} actions={actions} />
      <PadStrip items={view.strip} />
      {view.start === null ? (
        <PadBody view={view} flash={flash} onTap={actions.tapHalf} body={body} scrolls={scrolls} />
      ) : (
        <StartPanel
          start={view.start}
          details={view.details}
          toss={toss}
          line={line}
          actions={actions}
        />
      )}
      <PadControls
        view={view}
        line={line}
        cardNote={cardNote}
        actions={actions}
        lineUndo={lineUndo}
      />
    </View>
  );
});

/**
 * Owner ruling 20 (2026-10-31): Home, then at the right end the sync status in its fixed box, then Rules and History,
 * round icon buttons as Home's gear, last (owner, 2026-11-03). Between Home and the end, where the Preview tag was, the games tally in lime (owner,
 * 2026-11-01). The tally, Rules and History need a match
 * (`matchKnown`): none on a dead link's card. One 48 dp row at 320 and 360 dp in four languages (padFit.test.ts).
 */
const PadHeader = memo(function PadHeader({
  sync,
  tally,
  known,
  actions,
}: {
  readonly sync: PadSync;
  readonly tally: PadTally<MessageKey>;
  readonly known: boolean;
  readonly actions: PadContentActions;
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

/**
 * The top bar's right end: the send badge in its slot (a tap on it opens History), then Match details and History,
 * last, while the match is known (owner, 2026-11-03: "have sync icon first then info, history").
 */
const HeaderEnd = memo(function HeaderEnd({
  sync,
  known,
  actions,
}: {
  readonly sync: PadSync;
  readonly known: boolean;
  readonly actions: PadContentActions;
}) {
  return (
    <View testID="pad-header-end" style={styles.end}>
      <View testID="sync-box" style={styles.sync}>
        <SyncBadge sync={sync} onPress={known ? actions.history : null} />
      </View>
      {known ? <MatchIcons actions={actions} /> : null}
    </View>
  );
});

/** "1:0", top side first, said "Games: A. Sharma 1, L. Chen 0" (owner, 2026-11-01). Never cut: it never shrinks. */
const GamesTally = memo(function GamesTally({ tally }: { readonly tally: PadTally<MessageKey> }) {
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
const MatchIcons = memo(function MatchIcons({ actions }: { readonly actions: PadContentActions }) {
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
type PadBodyProps = {
  readonly view: PadView<MessageKey>;
  readonly flash: HalfFlash;
  readonly onTap: (side: PadSide) => void;
  readonly body: ReactNode | undefined;
  readonly scrolls: boolean;
};

const PadBody = memo(function PadBody({ view, flash, onTap, body, scrolls }: PadBodyProps) {
  const card = view.card?.kind === 'updateNeeded' ? null : view.card;
  if (card !== null && cardPlacement(card) === 'instead') {
    return <CardInstead card={card} details={view.details} />;
  }
  const content = (
    <>
      {card === null ? null : <PadStateCard card={card} />}
      {body === undefined ? <Halves view={view} flash={flash} onTap={onTap} /> : body}
    </>
  );
  if (scrolls)
    return (
      <ScrollView
        testID="pad-body-scroll"
        style={styles.body}
        contentContainerStyle={styles.scrolled}
      >
        {content}
      </ScrollView>
    );
  return <View style={styles.body}>{content}</View>;
});

/** The two halves, the first side's on top: a tap on one gives that side the rally, and a tap that counted flashes it. */
function Halves({
  view,
  flash,
  onTap,
}: {
  readonly view: PadView<MessageKey>;
  readonly flash: HalfFlash;
  readonly onTap: (side: PadSide) => void;
}) {
  return (
    <>
      <ScoreHalf half={view.halves[0]} flash={flashCue(flash, 'first')} onTap={onTap} />
      <ScoreHalf half={view.halves[1]} flash={flashCue(flash, 'second')} onTap={onTap} />
    </>
  );
}

/** A card in the halves' place, scrolling when it is taller than the room; Not started's carries the match card. */
function CardInstead({
  card,
  details,
}: {
  readonly card: TitledCard;
  readonly details: PadMatchDetails<MessageKey>;
}) {
  return (
    <ScrollView testID="pad-card-scroll" style={styles.body}>
      <PadStateCard card={card}>
        {card.kind === 'notStarted' ? <DetailsCard details={details} /> : null}
      </PadStateCard>
    </ScrollView>
  );
}

/**
 * The Start screen (owner, 2026-11-01, option A), in the halves' place until the match starts: the match card, who
 * serves first, then Start match, a tap and no hold (it is not destructive: Undo takes it back). It scrolls when it is
 * taller than the room. Start match is disabled, and says so, until a side is picked; a sport with no serve to pick
 * (`needsToss` false) has no question and no picker, and Start match is ready (plan S2-3 Task 2). Such a sport whose sides
 * carry plates shows the names with their plates as read-only rows (`StartSides`). A refusal on the pad's line (the
 * serve pick the disk refused twice: S2-4 Batch 2 re-review N1) is said under Start match, since the pad's own line is
 * not drawn before the start; a note is not news there.
 */
const StartPanel = memo(function StartPanel({
  start,
  details,
  toss,
  line,
  actions,
}: {
  readonly start: PadStart<MessageKey>;
  readonly details: PadMatchDetails<MessageKey>;
  readonly toss: PadSide | null;
  readonly line: PadLineWords;
  readonly actions: PadContentActions;
}) {
  const { t } = useT();
  const words = usePadText();
  const options = useMemo(() => tossOptionsOf(start.sides), [start.sides]);
  return (
    <ScrollView testID="start-screen" style={styles.body} contentContainerStyle={styles.start}>
      <DetailsCard details={details} />
      {start.needsToss ? (
        <TossPicker
          ask={words(start.ask)}
          options={options}
          picked={toss}
          onPick={actions.pickServer}
        />
      ) : (
        <StartSides sides={start.sides} />
      )}
      <Button
        label={t('scoring.start.confirm')}
        onPress={actions.start}
        disabled={start.needsToss && toss === null}
      />
      {line?.kind === 'refusal' ? <RefusalBanner text={t(line.key)} /> : null}
    </ScrollView>
  );
});

/** The Start screen's sides as the picker's choices: each side's seat is its id, its name as typed. */
function tossOptionsOf(
  sides: readonly [PadStartSide, PadStartSide],
): readonly [TossOption<PadSide>, TossOption<PadSide>] {
  const [top, bottom] = sides;
  return [
    { id: top.side, label: top.label },
    { id: bottom.side, label: bottom.label },
  ];
}

/**
 * Under the halves: the last-tap line and the tools, or, when an update is needed, the banner in their place
 * (`cardPlacement`'s `forControls`, the one card there; `PadBody` draws the others). Nothing under the Start screen.
 */
const PadControls = memo(function PadControls({
  view,
  line,
  cardNote,
  actions,
  lineUndo,
}: {
  readonly view: PadView<MessageKey>;
  readonly line: PadLineWords;
  readonly cardNote: MessageKey | null;
  readonly actions: PadContentActions;
  readonly lineUndo: boolean;
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
      <PadLine view={view} line={line} undo={lineUndo} onUndo={actions.undo} />
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
  undo,
  onUndo,
}: {
  readonly view: PadView<MessageKey>;
  readonly line: PadLineWords;
  readonly undo: boolean;
  readonly onUndo: () => void;
}) {
  const { t } = useT();
  const words = line === null ? null : t(line.key);
  return (
    <LastTapLine
      lastTap={view.lastTap}
      refusal={line?.kind === 'refusal' ? words : null}
      note={line?.kind === 'note' ? words : null}
      undoCell={undo && hasUndoCell(view.card)}
      onUndo={onUndo}
    />
  );
});

const styles = StyleSheet.create({
  pad: { flex: 1, gap: space.sm, padding: space.md },
  // `space.xs` apart: Back, the tally, the sync box, Rules and History share the row (padFit.test.ts).
  header: { flexDirection: 'row', alignItems: 'center', gap: space.xs, minHeight: layout.touch },
  tally: { flexShrink: 0 },
  // Pushed to the right end by its auto margin: the row's spare room stands between the tally and the sync box.
  end: { flexDirection: 'row', alignItems: 'center', gap: space.xs, marginLeft: 'auto' },
  sync: { width: layout.padSyncBox, alignItems: 'flex-end' },
  body: { flex: 1, gap: space.sm },
  start: { gap: space.md, paddingBottom: space.md },
  scrolled: { gap: space.sm, paddingBottom: space.md },
});
