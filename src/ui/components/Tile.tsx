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
import { TextLink } from '@/ui/components/TextLink';
import { MODE_HINT, MODE_PURPOSE } from '@/ui/modeCopy';
import { colour, layout as metrics, radius, space } from '@/ui/theme/tokens';

type TileProps = {
  mode: Mode;
  available: boolean;
  onPress: (mode: Mode) => void;
  /** Landscape pads the tile tighter (`tileLandscapePad`); portrait, the default, is unchanged. */
  layout?: ScreenLayout;
  /**
   * R2: a small secondary link under the hint (Stream settings, in the Live Stream tile). It is the tile's sibling,
   * never inside its button, so each press is its own.
   */
  link?: { readonly label: string; readonly onPress: () => void };
};

/**
 * One of Home's three equal tiles (layout A). A lime left edge marks a mode
 * you can open; an unbuilt one has none and cannot be tapped (decision 10).
 * With a link, a frame wears the tile's edge, padding and ground, and holds the tile's button over the link.
 */
export const Tile = memo(function Tile({
  mode,
  available,
  onPress,
  layout = 'portrait',
  link,
}: TileProps) {
  const { t } = useT();
  const press = useCallback(() => onPress(mode), [mode, onPress]);
  const style = link === undefined ? STYLES[layout][available ? 'on' : 'off'] : bodyStyle;
  const body = (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: !available }}
      disabled={!available}
      onPress={press}
      style={style}
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
  if (link === undefined) return body;
  return (
    <View testID={`tile-${mode}`} style={FRAMES[layout][available ? 'on' : 'off']}>
      {body}
      <TextLink label={link.label} onPress={link.onPress} />
    </View>
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
    justifyContent: 'center',
    gap: space.xs,
    padding: space.md,
    borderRadius: radius.card,
    borderLeftWidth: 4,
    borderLeftColor: colour.lime,
    backgroundColor: colour.surface,
  },
  /**
   * P7: a portrait tile grows from its own content (an auto basis), so a short column scrolls rather than squeezing
   * the Live Stream tile and its link below their words (homeFit.test.ts: an equal third does under 748 dp).
   */
  portrait: { flexGrow: 1 },
  /** Equal thirds of the row's width; the row's height is the tallest tile's, so none is squeezed. */
  landscape: { flex: 1, padding: metrics.tileLandscapePad },
  off: { borderLeftColor: colour.surface },
  /** Inside a frame: the tile's content rhythm only; the frame wears the edge, padding and ground. */
  body: { flex: 1, justifyContent: 'center', gap: space.xs },
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
  portrait: {
    on: tileStyleFor([styles.tile, styles.portrait]),
    off: [styles.tile, styles.portrait, styles.off],
  },
  landscape: {
    on: tileStyleFor([styles.tile, styles.landscape]),
    off: [styles.tile, styles.landscape, styles.off],
  },
};

/** The body inside a frame dims when pressed, as the tile does; one function, built once. */
const bodyStyle = tileStyleFor([styles.body]);

/** A framed tile: what the tile's button wears alone, per layout and availability. */
const FRAMES: Record<ScreenLayout, Record<'on' | 'off', StyleProp<ViewStyle>>> = {
  portrait: { on: [styles.tile, styles.portrait], off: [styles.tile, styles.portrait, styles.off] },
  landscape: {
    on: [styles.tile, styles.landscape],
    off: [styles.tile, styles.landscape, styles.off],
  },
};
