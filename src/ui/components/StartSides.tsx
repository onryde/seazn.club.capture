import { memo } from 'react';
import { StyleSheet, View } from 'react-native';
import type { PadStartSide } from '@/domain/scoring/padView';
import { usePadText } from '@/hooks/usePadText';
import type { MessageKey } from '@/i18n/messages';
import { NameText } from '@/ui/components/NameText';
import { SidePlate } from '@/ui/components/SidePlate';
import { colour, layout, radius, space } from '@/ui/theme/tokens';

/**
 * The two sides on the Start screen of a sport with no serve to pick, each name with the plate it will carry (chess: who
 * holds White), as read-only rows, first side on top (Batch A review). Nothing here takes a tap: there is nothing to pick.
 * Nothing at all when no side has a plate, so a sport without plates has no rows. A screen reader reads each row once, the
 * name and then its plate.
 */
export const StartSides = memo(function StartSides({
  sides,
}: {
  readonly sides: readonly [PadStartSide<MessageKey>, PadStartSide<MessageKey>];
}) {
  const words = usePadText();
  if (sides.every((side) => side.plate == null)) return null;
  return (
    <View testID="start-sides" style={styles.block}>
      {sides.map((side) => {
        const plate = side.plate == null ? null : words(side.plate);
        return (
          <View
            key={side.side}
            testID={`start-side-${side.side}`}
            accessible
            accessibilityLabel={plate === null ? side.label : `${side.label}, ${plate}`}
            style={styles.row}
          >
            <NameText variant="label" lines={layout.padNameLines} style={styles.name}>
              {side.label}
            </NameText>
            {plate === null ? null : <SidePlate words={plate} />}
          </View>
        );
      })}
    </View>
  );
});

const styles = StyleSheet.create({
  block: { gap: space.sm },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    minHeight: layout.padTossHeight,
    paddingHorizontal: space.sm,
    paddingVertical: space.sm,
    borderRadius: radius.card,
    backgroundColor: colour.surface,
  },
  name: { flex: 1 },
});
