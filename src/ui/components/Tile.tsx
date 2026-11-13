import { memo, useCallback, useState } from 'react';
import {
  type LayoutChangeEvent,
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
import { tileTitleRole } from '@/ui/theme/tileTitle';
import { colour, layout as metrics, pressedOpacity, radius, space } from '@/ui/theme/tokens';

type TileProps = {
  mode: Mode;
  available: boolean;
  onPress: (mode: Mode) => void;
  /** Landscape pads the tile tighter (`tileLandscapePad`); portrait, the default, is unchanged. */
  layout?: ScreenLayout;
  /** The second line, already in words, when the mode has something to say about its saved code (Match Day, owner 2026-11-12). */
  hint?: string | null;
};

/**
 * One of Home's three tiles (layout A): equal widths in landscape; in portrait each grows from its own content (P7;
 * R11 of the D3 findings design). A lime left edge marks a mode you can open; an unbuilt one has none and cannot be
 * tapped (decision 10). The whole tile is the button. It carries no gear: Settings is the gear in Home's corner (owner,
 * 2026-11-02), which replaced R2's gear on this tile.
 */
export const Tile = memo(function Tile({
  mode,
  available,
  onPress,
  layout = 'portrait',
  hint = null,
}: TileProps) {
  const { t } = useT();
  const press = useCallback(() => onPress(mode), [mode, onPress]);
  // N31: the title's row as laid out, which sets the title's size (`tileTitleRole`); null until it is measured.
  const [headWidth, setHeadWidth] = useState<number | null>(null);
  const measureHead = useCallback(
    (event: LayoutChangeEvent) => setHeadWidth(event.nativeEvent.layout.width),
    [],
  );
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: !available }}
      disabled={!available}
      onPress={press}
      style={STYLES[layout][available ? 'on' : 'off']}
    >
      <View style={styles.head} onLayout={measureHead}>
        <ModeIcon mode={mode} dim={!available} />
        <Text
          variant={tileTitleRole(headWidth)}
          numberOfLines={metrics.tileTitleLines}
          style={styles.title}
        >
          {t(MODE_NAME[mode])}
        </Text>
      </View>
      <Text variant="body" style={available ? undefined : styles.inert}>
        {t(MODE_PURPOSE[mode])}
      </Text>
      <Text variant="metricUnit">{hint ?? t(MODE_HINT[mode])}</Text>
    </Pressable>
  );
});

/**
 * Module-level so render allocates no function; pressed dims the tile to `pressedOpacity.plate`, as Button does (the
 * controller's ruling, Batch 17). One pair per layout, built once: the Pressable gets the same function every render of
 * a given layout and availability. A tile that cannot be opened has a style with no pressed state.
 */
function tileStyleFor(rest: StyleProp<ViewStyle>) {
  const pressedStyle = [rest, styles.pressed];
  return ({ pressed }: PressableStateCallbackType) => (pressed ? pressedStyle : rest);
}

const styles = StyleSheet.create({
  tile: {
    justifyContent: 'center',
    gap: space.xs,
    padding: space.md,
    borderRadius: radius.card,
    borderLeftWidth: 4,
    borderLeftColor: colour.lime,
    backgroundColor: colour.surface,
  },
  /**
   * P7 and R11 of the D3 findings design: a portrait tile grows from its own content (an auto basis), so a short
   * column scrolls rather than squeezing a tile below its words (homeFit.test.ts: with a card above them, equal
   * thirds would on a 360 × 720 window).
   */
  portrait: { flexGrow: 1 },
  /** Equal thirds of the row's width; the row's height is the tallest tile's, so none is squeezed. */
  landscape: { flex: 1, padding: metrics.tileLandscapePad },
  off: { borderLeftColor: colour.surface },
  pressed: { opacity: pressedOpacity.plate },
  head: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  /**
   * N31: the title gives way and wraps (`tileTitleLines`) rather than run past the tile; Yoga's default of 0 ran a
   * French title past its tile on the owner's phone sideways (Home 728 dp wide behind its insets). The icon beside it
   * keeps that default, and its size.
   */
  title: { flexShrink: 1 },
  inert: { color: colour.ink3 },
});

const STYLES: Record<
  ScreenLayout,
  {
    on: (state: PressableStateCallbackType) => StyleProp<ViewStyle>;
    off: StyleProp<ViewStyle>;
  }
> = {
  portrait: {
    on: tileStyleFor([styles.tile, styles.portrait]),
    off: [styles.tile, styles.portrait, styles.off],
  },
  landscape: {
    on: tileStyleFor([styles.tile, styles.landscape]),
    off: [styles.tile, styles.landscape, styles.off],
  },
};
