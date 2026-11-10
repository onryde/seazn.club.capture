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
 * thumb. A fact the pad does not know is an empty slot, never a dash. The first fact reads from the left edge and the
 * last ends at the right one (owner, 2026-11-01: "move interval at 11 to far right"). A sport with no slots (cricket, since
 * T20 fix 12) has no fact that could come and go, so nothing moves under a thumb: the row draws nothing and reserves nothing.
 */
export const PadStrip = memo(function PadStrip({
  items,
}: {
  readonly items: readonly PadStripItem<MessageKey>[];
}) {
  const words = usePadText();
  if (items.length === 0) return null;
  return (
    <View testID="pad-strip" style={styles.strip}>
      {items.map((item, at) => (
        <View key={item.slot} testID={`strip-${item.slot}`} style={styles.slot}>
          {item.text === null ? null : (
            <Text
              variant="metricUnit"
              numberOfLines={item.lines ?? layout.padStripLines}
              style={at > 0 && at === items.length - 1 ? styles.last : undefined}
            >
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
  last: { textAlign: 'right' },
});
