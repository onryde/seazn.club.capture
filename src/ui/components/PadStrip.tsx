import { memo } from 'react';
import { StyleSheet, View } from 'react-native';
import type { PadStripItem } from '@/domain/scoring/padView';
import { usePadText } from '@/hooks/usePadText';
import type { MessageKey } from '@/i18n/messages';
import { Text } from '@/ui/components/Text';
import { layout, space } from '@/ui/theme/tokens';
import { typeScale } from '@/ui/theme/type';

/**
 * The facts above the halves, one slot each, in the sport's order. Every slot takes an equal share of the row whether
 * or not it holds a fact, and the row reserves its lines, so a fact coming or going never moves the halves under a
 * thumb. A fact the pad does not know is an empty slot, never a dash.
 */
export const PadStrip = memo(function PadStrip({
  items,
}: {
  readonly items: readonly PadStripItem<MessageKey>[];
}) {
  const words = usePadText();
  return (
    <View testID="pad-strip" style={styles.strip}>
      {items.map((item) => (
        <View key={item.slot} testID={`strip-${item.slot}`} style={styles.slot}>
          {item.text === null ? null : (
            <Text variant="metricUnit" numberOfLines={layout.padStripLines}>
              {words(item.text)}
            </Text>
          )}
        </View>
      ))}
    </View>
  );
});

const styles = StyleSheet.create({
  strip: {
    flexDirection: 'row',
    gap: space.sm,
    minHeight: layout.padStripLines * typeScale.metricUnit.lineHeight,
  },
  slot: { flex: 1, minWidth: 0 },
});
