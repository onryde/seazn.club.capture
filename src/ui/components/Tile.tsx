import { memo, useCallback } from 'react';
import {
  type PressableStateCallbackType,
  Pressable,
  type StyleProp,
  StyleSheet,
  View,
  type ViewStyle,
} from 'react-native';
import type { ScreenLayout } from '@/domain/mode/homeLayout';
import type { Mode } from '@/domain/mode/Mode';
import { useT } from '@/hooks/useLanguage';
import { ModeIcon } from '@/ui/components/ModeIcon';
import { MODE_NAME } from '@/i18n/modeNames';
import { Text } from '@/ui/components/Text';
import { MODE_HINT, MODE_PURPOSE } from '@/ui/modeCopy';
import { colour, layout as metrics, radius, space } from '@/ui/theme/tokens';

type TileProps = {
  mode: Mode;
  available: boolean;
  onPress: (mode: Mode) => void;
  /** Landscape pads the tile tighter (`tileLandscapePad`); portrait, the default, is unchanged. */
  layout?: ScreenLayout;
};

/**
 * One of Home's three equal tiles (layout A). A lime left edge marks a mode
 * you can open; an unbuilt one has none and cannot be tapped (decision 10).
 */
export const Tile = memo(function Tile({
  mode,
  available,
  onPress,
  layout = 'portrait',
}: TileProps) {
  const { t } = useT();
  const press = useCallback(() => onPress(mode), [mode, onPress]);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: !available }}
      disabled={!available}
      onPress={press}
      style={STYLES[layout][available ? 'on' : 'off']}
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

/**
 * Module-level so render allocates no function; pressed dims the tile, as Button does. One pair per layout, built
 * once: the Pressable gets the same function every render of a given layout and availability.
 */
function tileStyleFor(rest: StyleProp<ViewStyle>) {
  const pressedStyle = [rest, styles.pressed];
  return ({ pressed }: PressableStateCallbackType) => (pressed ? pressedStyle : rest);
}

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
  landscape: { padding: metrics.tileLandscapePad },
  off: { borderLeftColor: colour.surface },
  pressed: { opacity: 0.85 },
  head: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  inert: { color: colour.ink3 },
});

const STYLES: Record<
  ScreenLayout,
  {
    on: (state: PressableStateCallbackType) => StyleProp<ViewStyle>;
    off: StyleProp<ViewStyle>;
  }
> = {
  portrait: { on: tileStyleFor([styles.tile]), off: [styles.tile, styles.off] },
  landscape: {
    on: tileStyleFor([styles.tile, styles.landscape]),
    off: [styles.tile, styles.landscape, styles.off],
  },
};
