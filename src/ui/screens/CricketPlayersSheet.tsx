import { memo, useCallback, useMemo } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import type {
  CricketPlayersView,
  PlayersBatter,
  PlayersBowler,
  PlayersTab,
} from '@/domain/scoring/cricketPlayers';
import { useT } from '@/hooks/useLanguage';
import { usePadText } from '@/hooks/usePadText';
import { GhostButton } from '@/ui/components/GhostButton';
import { SheetFrame } from '@/ui/components/SheetFrame';
import { sheetRow, sheetRowLabel, sheetRowStyles } from '@/ui/components/sheetRow';
import { StepRow, type StepOption } from '@/ui/components/StepSheet';
import { Text } from '@/ui/components/Text';
import { MoveButton } from '@/ui/screens/CricketOrderList';
import { colour, layout, space } from '@/ui/theme/tokens';

type Props = {
  readonly tab: PlayersTab;
  readonly players: CricketPlayersView;
  readonly onTab: (tab: PlayersTab) => void;
  readonly onMove: (from: number, to: number) => void;
  readonly onBowler: (id: string) => void;
  readonly onClose: () => void;
};

/**
 * Players (S2-4 spec §4.8a; rulings 77 and 78; plan Task 14), from a tap on the board: two tabs over one list. Batting:
 * those who have batted, then those yet to bat, each with how they stand ("Out, bowled · 8 (3)", "Not out · 9 (3)", the
 * striker's ●), and ▲▼ (lime, 48 dp) on those yet to bat. Bowling: every fielder with O-M-R-W and overs left; between
 * overs those who may bowl the next are rows that take a tap (rulings 82 and 85), the rest greyed with why, and mid-over
 * the rows are read-only, with no border. Close, the dim and Back close it. Modal to a screen reader, as every sheet.
 */
export const CricketPlayersSheet = memo(function CricketPlayersSheet({
  tab,
  players,
  onTab,
  onMove,
  onBowler,
  onClose,
}: Props) {
  const { t } = useT();
  return (
    <SheetFrame testID="players-sheet" dimTestID="players-dim" onDim={onClose} style={styles.sheet}>
      <Text variant="title" accessibilityRole="header">
        {t('scoring.cricket.players.title')}
      </Text>
      <PlayersTabs tab={tab} onTab={onTab} />
      <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
        {tab === 'batting' ? (
          <BattingList rows={players.batting} onMove={onMove} />
        ) : (
          <BowlingList players={players} onBowler={onBowler} />
        )}
      </ScrollView>
      <GhostButton label={t('panel.close')} onPress={onClose} />
    </SheetFrame>
  );
});

const TABS: readonly PlayersTab[] = ['batting', 'bowling'];

function PlayersTabs({
  tab,
  onTab,
}: {
  readonly tab: PlayersTab;
  readonly onTab: (tab: PlayersTab) => void;
}) {
  return (
    <View accessibilityRole="tablist" style={styles.tabs}>
      {TABS.map((one) => (
        <TabCell key={one} tab={one} selected={one === tab} onTab={onTab} />
      ))}
    </View>
  );
}

/** A tab: the chosen one in the heavier lime border on surface, as a chosen row. */
const TabCell = memo(function TabCell({
  tab,
  selected,
  onTab,
}: {
  readonly tab: PlayersTab;
  readonly selected: boolean;
  readonly onTab: (tab: PlayersTab) => void;
}) {
  const { t } = useT();
  const press = useCallback(() => onTab(tab), [onTab, tab]);
  const tone = selected ? 'chosen' : 'standard';
  return (
    <Pressable accessibilityRole="tab" aria-selected={selected} onPress={press} style={TAB[tone]}>
      <Text variant="controlInk" numberOfLines={1} style={sheetRowLabel[tone]}>
        {t(`scoring.cricket.players.${tab}`)}
      </Text>
    </Pressable>
  );
});

function BattingList({
  rows,
  onMove,
}: {
  readonly rows: readonly PlayersBatter[];
  readonly onMove: (from: number, to: number) => void;
}) {
  return (
    <>
      {rows.map((row, index) => (
        <BatterRow key={row.id} row={row} index={index} onMove={onMove} />
      ))}
    </>
  );
}

/** A batter: place, the striker's ●, the name over how they stand; ▲▼ when yet to bat. */
const BatterRow = memo(function BatterRow({
  row,
  index,
  onMove,
}: {
  readonly row: PlayersBatter;
  readonly index: number;
  readonly onMove: (from: number, to: number) => void;
}) {
  const { t } = useT();
  const up = useCallback(() => onMove(index, index - 1), [onMove, index]);
  const down = useCallback(() => onMove(index, index + 1), [onMove, index]);
  return (
    <View testID={`players-${row.id}`} style={styles.row}>
      <Text variant="metricValue" style={styles.place}>{`${index + 1}`}</Text>
      <View style={styles.mark}>
        {row.striker ? (
          <Text
            variant="label"
            accessibilityLabel={t('scoring.cricket.board.onStrike')}
            style={styles.dot}
          >
            ●
          </Text>
        ) : null}
      </View>
      <NameAndNote name={row.name} note={row.note} />
      {row.state === 'yet' ? (
        <>
          <MoveButton
            label={t('scoring.cricket.setup.up', { name: row.name })}
            down={false}
            disabled={!row.up}
            onPress={up}
          />
          <MoveButton
            label={t('scoring.cricket.setup.down', { name: row.name })}
            down
            disabled={!row.down}
            onPress={down}
          />
        </>
      ) : null}
    </View>
  );
});

/** The name, one line (an ellipsis before it wraps); under it how they stand, two lines at most ("Eliminado, obstructing the field"). */
function NameAndNote({
  name,
  note,
}: {
  readonly name: string;
  readonly note: PlayersBatter['note'];
}) {
  const words = usePadText();
  return (
    <View style={styles.name}>
      <Text variant="label" numberOfLines={1} style={styles.ink}>
        {name}
      </Text>
      <Text variant="metricUnit" numberOfLines={2}>
        {words(note)}
      </Text>
    </View>
  );
}

/** Between overs, the next over's choice; mid-over (or in a super over, or with no innings under way) read-only. */
function BowlingList({
  players,
  onBowler,
}: {
  readonly players: CricketPlayersView;
  readonly onBowler: (id: string) => void;
}) {
  return (
    <>
      {players.bowling.map((row) =>
        players.betweenOvers ? (
          <BowlerChoice key={row.id} row={row} onBowler={onBowler} />
        ) : (
          <View key={row.id} testID={`players-${row.id}`} style={styles.line}>
            <NameAndNote name={row.name} note={row.note} />
          </View>
        ),
      )}
    </>
  );
}

/** A bowler between overs: the kit's step row, greyed and pressless for one who may not bowl the next over. */
const BowlerChoice = memo(function BowlerChoice({
  row,
  onBowler,
}: {
  readonly row: PlayersBowler;
  readonly onBowler: (id: string) => void;
}) {
  const words = usePadText();
  const option = useMemo<StepOption>(
    () => ({
      id: row.id,
      label: row.name,
      tone: 'standard',
      disabled: !row.tappable,
      chosen: row.chosen,
      note: words(row.note),
    }),
    [row, words],
  );
  return <StepRow option={option} onChoose={onBowler} />;
});

const styles = StyleSheet.create({
  sheet: { maxHeight: '90%' },
  scroll: { flexGrow: 0, flexShrink: 1 },
  content: { gap: space.sm },
  tabs: { flexDirection: 'row', gap: space.sm },
  tab: { flex: 1, minWidth: 0, alignItems: 'center', paddingHorizontal: space.sm },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.sm, minHeight: layout.touch },
  line: { justifyContent: 'center', minHeight: layout.touch, paddingHorizontal: space.md },
  place: { minWidth: space.lg, color: colour.ink2, fontVariant: ['tabular-nums'] },
  mark: { width: space.md, alignItems: 'center' },
  dot: { color: colour.lime },
  name: { flex: 1, minWidth: 0 },
  ink: { color: colour.ink },
});

const TAB = sheetRowStyles([sheetRow.row, styles.tab]);
