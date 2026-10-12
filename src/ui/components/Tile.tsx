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
import { TextLink } from '@/ui/components/TextLink';
import { MODE_HINT, MODE_PURPOSE } from '@/ui/modeCopy';
import { tileTitleRole } from '@/ui/theme/tileTitle';
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
 * One of Home's three tiles (layout A): equal widths in landscape; in portrait each grows from its own content (P7;
 * R11 of the D3 findings design). A lime left edge marks a mode you can open; an unbuilt one has none and cannot be
 * tapped (decision 10). With a link, a frame wears the tile's edge, ground and bottom padding; the tile's button wears
 * the top and side padding, so all of the tile above the link's row is the button (M2 of the Batch 5 review).
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
  // N31: the title's row as laid out, which sets the title's size (`tileTitleRole`); null until it is measured.
  const [headWidth, setHeadWidth] = useState<number | null>(null);
  const measureHead = useCallback(
    (event: LayoutChangeEvent) => setHeadWidth(event.nativeEvent.layout.width),
    [],
  );
  const style = link === undefined ? STYLES[layout][available ? 'on' : 'off'] : BODY[layout];
  const body = (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: !available }}
      disabled={!available}
      onPress={press}
      style={style}
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
      <Text variant="metricUnit">{t(MODE_HINT[mode])}</Text>
    </Pressable>
  );
  if (link === undefined) return body;
  return (
    <View testID={`tile-${mode}`} style={FRAMES[layout][available ? 'on' : 'off']}>
      {body}
      <View style={LINK_ROW[layout]}>
        <TextLink label={link.label} onPress={link.onPress} />
      </View>
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
  /** A framed tile: the edge, the ground and the gap over the link; its padding is split per layout below. */
  frame: {
    gap: space.xs,
    borderRadius: radius.card,
    borderLeftWidth: 4,
    borderLeftColor: colour.lime,
    backgroundColor: colour.surface,
  },
  framePortrait: { flexGrow: 1, paddingBottom: space.md },
  frameLandscape: { flex: 1, paddingBottom: metrics.tileLandscapePad },
  /** Inside a frame: the tile's content rhythm, and the top and side padding, so the rim is the button's. */
  body: { flex: 1, justifyContent: 'center', gap: space.xs },
  padPortrait: { paddingTop: space.md, paddingHorizontal: space.md },
  padLandscape: {
    paddingTop: metrics.tileLandscapePad,
    paddingHorizontal: metrics.tileLandscapePad,
  },
  linkPortrait: { paddingHorizontal: space.md },
  linkLandscape: { paddingHorizontal: metrics.tileLandscapePad },
  pressed: { opacity: 0.85 },
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

/** The body inside a frame dims when pressed, as the tile does; one function per layout, built once. */
const BODY: Record<ScreenLayout, ReturnType<typeof tileStyleFor>> = {
  portrait: tileStyleFor([styles.body, styles.padPortrait]),
  landscape: tileStyleFor([styles.body, styles.padLandscape]),
};

/** A framed tile, per layout and availability: the edge, the ground and the bottom padding. */
const FRAMES: Record<ScreenLayout, Record<'on' | 'off', StyleProp<ViewStyle>>> = {
  portrait: {
    on: [styles.frame, styles.framePortrait],
    off: [styles.frame, styles.framePortrait, styles.off],
  },
  landscape: {
    on: [styles.frame, styles.frameLandscape],
    off: [styles.frame, styles.frameLandscape, styles.off],
  },
};

/** The link's row, padded as the button is at its sides: the only part of a framed tile outside the button. */
const LINK_ROW: Record<ScreenLayout, StyleProp<ViewStyle>> = {
  portrait: styles.linkPortrait,
  landscape: styles.linkLandscape,
};
