import { memo } from 'react';
import { StyleSheet, View } from 'react-native';
import { Text } from '@/ui/components/Text';
import { colour, layout, space } from '@/ui/theme/tokens';

/**
 * A sport's own word for a side, on a plate (chess: WHITE, BLACK; the Batch A review): a hairline on the raised surface
 * with ink words, so it can never be mistaken for the lime serving plate, which says who serves. A word, never a colour
 * alone. It never shrinks: the names beside it give way. Drawn in a half's head (`ScoreHalf`) and on the Start screen's
 * rows (`StartSides`).
 */
export const SidePlate = memo(function SidePlate({ words }: { readonly words: string }) {
  return (
    <View testID="plate" style={styles.plate}>
      <Text variant="state" style={styles.word}>
        {words}
      </Text>
    </View>
  );
});

const styles = StyleSheet.create({
  plate: {
    flexShrink: 0,
    paddingHorizontal: space.sm,
    paddingVertical: space.xs,
    borderWidth: layout.iconBorder,
    borderColor: colour.ink3,
    backgroundColor: colour.surface2,
  },
  word: { color: colour.ink },
});
