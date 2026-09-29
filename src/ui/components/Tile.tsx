import { memo, useCallback } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import type { Mode } from '@/domain/mode/Mode';
import { useT } from '@/hooks/useLanguage';
import { ModeIcon } from '@/ui/components/ModeIcon';
import { MODE_NAME } from '@/i18n/modeNames';
import { Text } from '@/ui/components/Text';
import { MODE_HINT, MODE_PURPOSE } from '@/ui/modeCopy';
import { colour, radius, space } from '@/ui/theme/tokens';

/**
 * One of Home's three equal tiles (layout A). A lime left edge marks a mode
 * you can open; an unbuilt one has none and cannot be tapped (decision 10).
 */
export const Tile = memo(function Tile({
  mode,
  available,
  onPress,
}: {
  mode: Mode;
  available: boolean;
  onPress: (mode: Mode) => void;
}) {
  const { t } = useT();
  const press = useCallback(() => onPress(mode), [mode, onPress]);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: !available }}
      disabled={!available}
      onPress={press}
      style={available ? styles.tile : styles.tileOff}
    >
      <View style={styles.head}>
        <ModeIcon mode={mode} dim={!available} />
        <Text variant="title">{t(MODE_NAME[mode])}</Text>
      </View>
      <Text variant="body" style={available ? undefined : styles.inert}>
        {t(MODE_PURPOSE[mode])}
      </Text>
      <Text variant="metricUnit">{t(MODE_HINT[mode])}</Text>
    </Pressable>
  );
});

const styles = StyleSheet.create({
  tile: {
    flex: 1,
    justifyContent: 'center',
    gap: space.xs,
    padding: space.md,
    borderRadius: radius.card,
    borderLeftWidth: 4,
    borderLeftColor: colour.lime,
    backgroundColor: colour.surface,
  },
  tileOff: {
    flex: 1,
    justifyContent: 'center',
    gap: space.xs,
    padding: space.md,
    borderRadius: radius.card,
    borderLeftWidth: 4,
    borderLeftColor: colour.surface,
    backgroundColor: colour.surface,
  },
  head: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  inert: { color: colour.ink3 },
});
