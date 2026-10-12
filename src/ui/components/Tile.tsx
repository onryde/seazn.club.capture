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
import { Glyph } from '@/ui/components/Glyph';
import { ModeIcon } from '@/ui/components/ModeIcon';
import { MODE_NAME } from '@/i18n/modeNames';
import { Text } from '@/ui/components/Text';
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
   * R2 of the D3 findings design, as the owner presented it (2026-10-12): a gear in the tile's top-right corner that
   * opens a settings screen (Stream settings, in the Live Stream tile). `label` is its name for a screen reader; it
   * draws no word. It is the tile's sibling, never inside its button, so each press is its own.
   */
  settings?: { readonly label: string; readonly onPress: () => void };
};

/**
 * One of Home's three tiles (layout A): equal widths in landscape; in portrait each grows from its own content (P7;
 * R11 of the D3 findings design). A lime left edge marks a mode you can open; an unbuilt one has none and cannot be
 * tapped (decision 10). With the gear, a frame wears the tile's edge and ground, and the tile's button wears all its
 * padding, so all of the tile but the gear is the button (M2 of the Batch 5 review). The gear's 48 dp target sits on
 * the frame's top-right corner; upright the head row ends where it begins, and sideways the button's top padding is
 * its height, so it never covers the icon or the title (homeFit.test.ts measures both).
 */
export const Tile = memo(function Tile({
  mode,
  available,
  onPress,
  layout = 'portrait',
  settings,
}: TileProps) {
  const { t } = useT();
  const press = useCallback(() => onPress(mode), [mode, onPress]);
  // N31: the title's row as laid out, which sets the title's size (`tileTitleRole`); null until it is measured.
  const [headWidth, setHeadWidth] = useState<number | null>(null);
  const measureHead = useCallback(
    (event: LayoutChangeEvent) => setHeadWidth(event.nativeEvent.layout.width),
    [],
  );
  const style = settings === undefined ? STYLES[layout][available ? 'on' : 'off'] : BODY[layout];
  const head = settings !== undefined && layout === 'portrait' ? headBesideGear : styles.head;
  const body = (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: !available }}
      disabled={!available}
      onPress={press}
      style={style}
    >
      <View style={head} onLayout={measureHead}>
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
  if (settings === undefined) return body;
  return (
    <View testID={`tile-${mode}`} style={FRAMES[layout][available ? 'on' : 'off']}>
      {body}
      <TileGear label={settings.label} onPress={settings.onPress} />
    </View>
  );
});

/**
 * The gear: the on-air icon row's Settings glyph, in its ink2, on a `touch` square at the frame's top-right corner. The
 * name is the label alone, so a screen reader reads "Stream settings" and a sighted operator reads the picture.
 */
const TileGear = memo(function TileGear({
  label,
  onPress,
}: {
  readonly label: string;
  readonly onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={gearStyle}
    >
      <Glyph name="settings" tone="ink2" />
    </Pressable>
  );
});

/** Module-level so render allocates no function; pressed dims the gear, as the icon row's buttons do. */
function gearStyle({ pressed }: PressableStateCallbackType) {
  return pressed ? pressedGear : styles.gear;
}

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
   * P7 and R11 of the D3 findings design: a portrait tile grows from its own content (an auto basis), so a short
   * column scrolls rather than squeezing a tile below its words (homeFit.test.ts: with a card above them, equal
   * thirds would on a 360 × 720 window).
   */
  portrait: { flexGrow: 1 },
  /** Equal thirds of the row's width; the row's height is the tallest tile's, so none is squeezed. */
  landscape: { flex: 1, padding: metrics.tileLandscapePad },
  off: { borderLeftColor: colour.surface },
  /** A framed tile: the edge and the ground; the button inside wears all the padding. */
  frame: {
    borderRadius: radius.card,
    borderLeftWidth: 4,
    borderLeftColor: colour.lime,
    backgroundColor: colour.surface,
  },
  framePortrait: { flexGrow: 1 },
  frameLandscape: { flex: 1 },
  /** Inside a frame: the tile's content rhythm and all its padding, so the rim is the button's. */
  body: { flex: 1, justifyContent: 'center', gap: space.xs },
  padPortrait: { padding: space.md },
  /** Sideways the gear's height is the top padding: the head sits under the gear, never beside it. */
  padLandscapeGear: {
    paddingTop: metrics.touch,
    paddingHorizontal: metrics.tileLandscapePad,
    paddingBottom: metrics.tileLandscapePad,
  },
  /** The gear: a `touch` square on the frame's top-right corner, its glyph centred in it. */
  gear: {
    position: 'absolute',
    top: 0,
    right: 0,
    width: metrics.touch,
    height: metrics.touch,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pressed: { opacity: 0.85 },
  head: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  /** Upright, the head row ends where the gear begins: the gear's width less the tile's padding at that side. */
  besideGear: { marginRight: metrics.touch - space.md },
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
  landscape: tileStyleFor([styles.body, styles.padLandscapeGear]),
};

const headBesideGear = [styles.head, styles.besideGear];
const pressedGear = [styles.gear, styles.pressed];

/** A framed tile, per layout and availability: the edge and the ground. */
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
