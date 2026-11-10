import { memo, useCallback } from 'react';
import { Pressable, StyleSheet, View, type PressableStateCallbackType } from 'react-native';
import type { SetupBatter } from '@/domain/scoring/cricketSetup';
import { useT } from '@/hooks/useLanguage';
import { Glyph } from '@/ui/components/Glyph';
import { Text } from '@/ui/components/Text';
import { colour, layout, plateInk, radius, space } from '@/ui/theme/tokens';

/**
 * The batting side's order (S2-4 spec §4.1 step 3): each starter's place, name and, under it on the first two, the Opener
 * plate; then Move up and Move down (▲▼), each a 48 dp target with the lime border of a control that takes a tap (owner
 * rulings 82 and 85), greyed and pressless at either end. A screen reader names each with the batter ("Move up: C. Mendes"). The
 * row itself takes no tap, so it has no border. A name wider than its room ends in an ellipsis.
 */
export const CricketOrderList = memo(function CricketOrderList({
  order,
  onMove,
}: {
  readonly order: readonly SetupBatter[];
  readonly onMove: (from: number, to: number) => void;
}) {
  return (
    <View testID="batting-order" style={styles.list}>
      {order.map((batter, index) => (
        <OrderRow
          key={batter.id}
          batter={batter}
          index={index}
          last={index === order.length - 1}
          onMove={onMove}
        />
      ))}
    </View>
  );
});

const OrderRow = memo(function OrderRow({
  batter,
  index,
  last,
  onMove,
}: {
  readonly batter: SetupBatter;
  readonly index: number;
  readonly last: boolean;
  readonly onMove: (from: number, to: number) => void;
}) {
  const { t } = useT();
  const up = useCallback(() => onMove(index, index - 1), [onMove, index]);
  const down = useCallback(() => onMove(index, index + 1), [onMove, index]);
  return (
    <View testID={`order-${batter.id}`} style={styles.row}>
      <Text variant="metricValue" style={styles.place}>{`${index + 1}`}</Text>
      <BatterName batter={batter} />
      <MoveButton
        label={t('scoring.cricket.setup.up', { name: batter.name })}
        down={false}
        disabled={index === 0}
        onPress={up}
      />
      <MoveButton
        label={t('scoring.cricket.setup.down', { name: batter.name })}
        down
        disabled={last}
        onPress={down}
      />
    </View>
  );
});

function BatterName({ batter }: { readonly batter: SetupBatter }) {
  const { t } = useT();
  return (
    <View style={styles.name}>
      <Text variant="label" numberOfLines={1} style={styles.ink}>
        {batter.name}
      </Text>
      {batter.opener ? (
        <View testID="opener" style={styles.plate}>
          <Text variant="state" style={styles.plateInk}>
            {t('scoring.cricket.setup.opener')}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

/**
 * ▲ (or ▼, the same glyph turned over), with the lime border; at the end of the order, greyed and pressless. The Players
 * sheet's yet-to-bat rows move with it too (`CricketPlayersSheet`).
 */
export function MoveButton({
  label,
  down,
  disabled,
  onPress,
}: {
  readonly label: string;
  readonly down: boolean;
  readonly disabled: boolean;
  readonly onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={disabled}
      onPress={onPress}
      style={disabled ? styles.moveOff : moveStyle}
    >
      <View style={down ? styles.turned : undefined}>
        <Glyph name="up" tone={disabled ? 'ink2' : 'ink'} />
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  list: { gap: space.sm },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.sm, minHeight: layout.touch },
  place: { minWidth: space.lg, color: colour.ink2, fontVariant: ['tabular-nums'] },
  // The name over its plate, so a long name keeps the row's width less the place and the two buttons (cricketFit.test.ts).
  name: { flex: 1, gap: space.xs },
  ink: { color: colour.ink },
  // The pad's plate (`ScoreHalf`): lime with night ink (AGENTS §5).
  plate: {
    alignSelf: 'flex-start',
    paddingHorizontal: space.sm,
    paddingVertical: space.xs,
    backgroundColor: colour.lime,
  },
  plateInk: { color: plateInk },
  move: {
    width: layout.touch,
    height: layout.touch,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.card,
    borderWidth: layout.iconBorder,
    borderColor: colour.lime,
  },
  moveOff: {
    width: layout.touch,
    height: layout.touch,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.card,
    borderWidth: layout.iconBorder,
    borderColor: colour.ink3,
  },
  pressed: { backgroundColor: colour.pressFill },
  turned: { transform: [{ rotate: '180deg' }] },
});

/** Module-level so render allocates no function; pressed takes the press fill. */
const moveDown = [styles.move, styles.pressed];
const moveStyle = ({ pressed }: PressableStateCallbackType) => (pressed ? moveDown : styles.move);
