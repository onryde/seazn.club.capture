import { memo, useCallback } from 'react';
import { Pressable, StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import {
  seated,
  type CourtCard as CourtCardModel,
  type CourtState,
  type Row,
  type Stake,
} from '@/domain/matchday/matchDay';
import { useT } from '@/hooks/useLanguage';
import { useRowWords, type RowWords } from '@/hooks/useRowWords';
import type { MessageKey } from '@/i18n/messages';
import { GhostButton } from '@/ui/components/GhostButton';
import { MatchRow } from '@/ui/components/MatchRow';
import { StakeLine } from '@/ui/components/StakeLine';
import { Text } from '@/ui/components/Text';
import { colour, layout, plateInk, radius, space } from '@/ui/theme/tokens';

/** The copy's word for each court state (the dispatch's ruling 3): the chip draws it and a screen reader says it. */
const STATE_WORD: Readonly<Record<CourtState, MessageKey>> = {
  playing: 'matchday.court.playing',
  called: 'matchday.court.called',
  free: 'matchday.court.free',
  inUseElsewhere: 'matchday.court.inUseElsewhere',
};

type CourtCardProps = {
  readonly card: CourtCardModel;
  /** The unsent taps of the matches on this court opened from Match Day (`StakeLine`). */
  readonly stake: Stake;
  /** The venue's zone, for the planned times. */
  readonly zone: string;
  /** A tap on one of the court's rows (Task 5): the match opens. Without it the rows are read-only. */
  readonly onOpen?: (row: Row, courtName: string) => void;
  /** Where the card sits in its column, once laid out: the list scrolls to the court it came back from. */
  readonly onSlot?: (courtName: string, y: number) => void;
  /** The matches whose link this phone holds: only these finished rows open (the finished answer carries no link). */
  readonly opened?: ReadonlySet<string>;
  /** Whether this court shows every finished match, not only the latest (the screen holds it, per court). */
  readonly expanded?: boolean;
  /** A tap on "+N more finished" or "Show less": the screen flips this court's flag. */
  readonly onToggle?: (courtId: string) => void;
  /**
   * A code minted with "Call matches to courts" (S4 design §7a): a free court offers "Call a match" and a called one
   * with its match not started "Undo call". Without `canCall` the card has neither, whatever the handlers.
   */
  readonly canCall?: boolean;
  readonly onCall?: (courtId: string, courtName: string) => void;
  readonly onUndo?: (row: Row, courtName: string) => void;
};

/**
 * One court on Match Day's list (S4 design §5, layout B): its name and its state in words, "Sending N" while taps of
 * its matches wait (or at risk, when a queue cannot be read), then Now, Next and Then, and its finished matches dimmed under
 * their heading. A row opens its match when `onOpen` is given (Task 5; S4 design §6).
 */
export const CourtCard = memo(function CourtCard({
  card,
  stake,
  zone,
  onOpen,
  onSlot,
  opened,
  expanded = false,
  onToggle,
  canCall = false,
  onCall,
  onUndo,
}: CourtCardProps) {
  const { t } = useT();
  const words = useRowWords(zone);
  const state = t(STATE_WORD[card.state]);
  const placed = useCallback(
    (event: LayoutChangeEvent) => onSlot?.(card.name, event.nativeEvent.layout.y),
    [onSlot, card.name],
  );
  return (
    <View testID="court-card" style={styles.card} onLayout={placed}>
      <View style={styles.head}>
        <View accessible accessibilityLabel={`${card.name}, ${state}`} style={styles.headInfo}>
          <Text testID="court-name" variant="diagTitle" numberOfLines={1} style={styles.name}>
            {card.name}
          </Text>
          <StateChip state={card.state} word={state} />
        </View>
        <HeadAction card={card} canCall={canCall} onCall={onCall} onUndo={onUndo} />
      </View>
      <StakeLine stake={stake} />
      <QueueRows card={card} words={words} onOpen={onOpen} />
      <FinishedRows
        court={card.name}
        courtId={card.courtId}
        rows={card.finished}
        words={words}
        onOpen={onOpen}
        opened={opened}
        expanded={expanded}
        onToggle={onToggle}
      />
    </View>
  );
});

type Open = ((row: Row, courtName: string) => void) | undefined;

/**
 * One row of a court, opening its match on a tap when the card was given a way to. `divided`: a hairline above it, for
 * every match but the first of its section (owner, 2026-11-13: "why don't have divide line in match day screen?").
 */
const CourtRow = memo(function CourtRow({
  row,
  court,
  words,
  onOpen,
  label,
  spoken,
  dim,
  divided,
}: {
  readonly divided: boolean;
  readonly row: Row;
  readonly court: string;
  readonly words: (row: Row) => RowWords;
  readonly onOpen: Open;
  readonly label?: string;
  readonly spoken?: string;
  readonly dim?: boolean;
}) {
  const press = useCallback(() => onOpen?.(row, court), [onOpen, row, court]);
  // A match with an empty seat has no sides to score: its row is not a control (task 8d-B; the web does not refuse it).
  const opens = onOpen !== undefined && seated(row);
  return (
    <View testID="court-row" style={divided ? styles.divider : null}>
      <MatchRow
        {...(label === undefined ? {} : { label })}
        {...(spoken === undefined ? {} : { spoken })}
        {...(dim === true ? { dim } : {})}
        {...words(row)}
        {...(opens ? { onPress: press } : {})}
      />
    </View>
  );
});

/**
 * The court's one action, beside its state chip (owner, 2026-11-13: "instead of showing a big button, create a small
 * button beside Free"): Call on a free court, Undo on a called one whose match has not started, and only for a code
 * with `canCall`. A compact ghost: a small box, still a 48 dp target, named in full for a screen reader.
 */
const HeadAction = memo(function HeadAction({
  card,
  canCall,
  onCall,
  onUndo,
}: {
  readonly card: CourtCardModel;
  readonly canCall: boolean;
  readonly onCall: ((courtId: string, courtName: string) => void) | undefined;
  readonly onUndo: ((row: Row, courtName: string) => void) | undefined;
}) {
  if (!canCall) return null;
  if (onCall !== undefined && card.state === 'free')
    return <CallAction courtId={card.courtId} court={card.name} onCall={onCall} />;
  const now = card.now;
  if (onUndo !== undefined && card.state === 'called' && now !== null && now.status === 'upcoming')
    return <UndoAction row={now} court={card.name} onUndo={onUndo} />;
  return null;
});

/** Call, on a free court: opens the sheet "Call to Court 2". */
const CallAction = memo(function CallAction({
  courtId,
  court,
  onCall,
}: {
  readonly courtId: string;
  readonly court: string;
  readonly onCall: (courtId: string, courtName: string) => void;
}) {
  const { t } = useT();
  const press = useCallback(() => onCall(courtId, court), [onCall, courtId, court]);
  return (
    <GhostButton
      label={t('matchday.call.short')}
      accessibilityLabel={t('matchday.call.actionNamed', { court })}
      compact
      onPress={press}
    />
  );
});

/** Undo, on a called court while its match has not started: asks first (UndoCallSheet). */
const UndoAction = memo(function UndoAction({
  row,
  court,
  onUndo,
}: {
  readonly row: Row;
  readonly court: string;
  readonly onUndo: (row: Row, courtName: string) => void;
}) {
  const { t } = useT();
  const press = useCallback(() => onUndo(row, court), [onUndo, row, court]);
  return (
    <GhostButton
      label={t('matchday.call.undoShort')}
      accessibilityLabel={t('matchday.call.undoNamed', { court })}
      compact
      onPress={press}
    />
  );
});

const QueueRows = memo(function QueueRows({
  card,
  words,
  onOpen,
}: {
  readonly card: CourtCardModel;
  readonly words: (row: Row) => RowWords;
  readonly onOpen: Open;
}) {
  const { t } = useT();
  const queue = [
    [card.now, t('matchday.row.now')],
    [card.next, t('matchday.row.next')],
    [card.then, t('matchday.row.then')],
  ] as const;
  const first = queue.find(([row]) => row !== null)?.[0];
  return queue.map(([row, label]) =>
    row === null ? null : (
      <CourtRow
        key={row.fixtureId}
        row={row}
        court={card.name}
        label={label}
        words={words}
        onOpen={onOpen}
        divided={row !== first}
      />
    ),
  );
});

const FinishedRows = memo(function FinishedRows({
  court,
  courtId,
  rows,
  words,
  onOpen,
  opened,
  expanded,
  onToggle,
}: {
  readonly opened: ReadonlySet<string> | undefined;
  readonly court: string;
  readonly courtId: string;
  readonly rows: readonly Row[];
  readonly words: (row: Row) => RowWords;
  readonly onOpen: Open;
  readonly expanded: boolean;
  readonly onToggle: ((courtId: string) => void) | undefined;
}) {
  const { t } = useT();
  if (rows.length === 0) return null;
  const heading = t('matchday.row.finished');
  // Newest first: the latest alone, until the operator asks for the rest.
  const more = rows.length - 1;
  const shown = expanded ? rows : rows.slice(0, 1);
  return (
    <>
      <Text variant="diagSection" style={styles.finished}>
        {heading}
      </Text>
      {shown.map((row, at) => (
        <CourtRow
          key={row.fixtureId}
          divided={at > 0}
          row={row}
          court={court}
          spoken={heading}
          dim
          words={words}
          onOpen={opened?.has(row.fixtureId) === true ? onOpen : undefined}
        />
      ))}
      {more > 0 ? (
        <MoreRow courtId={courtId} more={more} open={expanded} onToggle={onToggle} />
      ) : null}
    </>
  );
});

/** "+N more finished" (or "Show less" once they show): a dimmed button naming itself, with its state. */
const MoreRow = memo(function MoreRow({
  courtId,
  more,
  open,
  onToggle,
}: {
  readonly courtId: string;
  readonly more: number;
  readonly open: boolean;
  readonly onToggle: ((courtId: string) => void) | undefined;
}) {
  const { t, tp } = useT();
  const press = useCallback(() => onToggle?.(courtId), [onToggle, courtId]);
  const word = open ? t('matchday.finished.less') : tp('matchday.finished.more', more);
  return (
    <Pressable
      testID="finished-more"
      accessibilityRole="button"
      accessibilityLabel={word}
      aria-expanded={open}
      accessibilityState={{ expanded: open }}
      onPress={press}
      style={styles.more}
    >
      <Text variant="control" numberOfLines={1} style={styles.moreWord}>
        {word}
      </Text>
    </Pressable>
  );
});

/**
 * The state as a chip: Playing a lime plate in night ink, Called a lime outline, Free a lilac hairline, In use (by a
 * match outside this code) a quiet plate in the inert ink. Never red: red means ON AIR (AGENTS §5). Every word's colour
 * is set, since Fabric's default is black.
 */
const StateChip = memo(function StateChip({
  state,
  word,
}: {
  readonly state: CourtState;
  readonly word: string;
}) {
  return (
    <View style={[styles.chip, CHIP[state].box]}>
      <Text variant="state" numberOfLines={1} style={CHIP[state].word}>
        {word}
      </Text>
    </View>
  );
});

/** The light line between matches, as the call sheet draws it between candidates. */
const hairline = { borderTopWidth: layout.cardBorder, borderTopColor: colour.rule } as const;

const styles = StyleSheet.create({
  card: {
    paddingHorizontal: layout.matchDayCardPad,
    paddingVertical: space.sm,
    borderRadius: radius.card,
    borderWidth: layout.cardBorder,
    borderColor: colour.rule,
    backgroundColor: colour.surface,
  },
  head: { minHeight: layout.touch, flexDirection: 'row', alignItems: 'center', gap: space.sm },
  headInfo: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: space.sm },
  name: { flex: 1, minWidth: 0 },
  finished: { paddingTop: space.sm, color: colour.ink3, ...hairline },
  divider: hairline,
  more: { minHeight: layout.touch, justifyContent: 'center' },
  moreWord: { color: colour.ink3 },
  chip: {
    flexShrink: 0,
    paddingHorizontal: space.sm,
    paddingVertical: space.xs,
    borderWidth: layout.cardBorder,
  },
});

const chips = StyleSheet.create({
  playingBox: { backgroundColor: colour.lime, borderColor: colour.lime },
  playingWord: { color: plateInk },
  calledBox: { borderColor: colour.lime },
  calledWord: { color: colour.lime },
  freeBox: { borderColor: colour.ink3 },
  freeWord: { color: colour.ink2 },
  inUseBox: { backgroundColor: colour.surface2, borderColor: colour.surface2 },
  inUseWord: { color: colour.ink3 },
});

const CHIP = {
  playing: { box: chips.playingBox, word: chips.playingWord },
  called: { box: chips.calledBox, word: chips.calledWord },
  free: { box: chips.freeBox, word: chips.freeWord },
  inUseElsewhere: { box: chips.inUseBox, word: chips.inUseWord },
} as const satisfies Record<CourtState, object>;
