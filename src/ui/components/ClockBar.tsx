import { memo } from 'react';
import {
  type PressableStateCallbackType,
  Pressable,
  type StyleProp,
  StyleSheet,
  View,
  type ViewStyle,
} from 'react-native';
import type { ClockBarAction, ClockBarView } from '@/domain/scoring/clockBarView';
import { usePadText } from '@/hooks/usePadText';
import type { MessageKey } from '@/i18n/messages';
import { Text } from '@/ui/components/Text';
import { type BoardTier, faceHeight, PERIOD_HEIGHT, TIER_FACES } from '@/ui/theme/columnBoard';
import { colour, layout, plateInk, pressedOpacity, radius, space } from '@/ui/theme/tokens';

type ClockBarProps = {
  readonly view: ClockBarView<MessageKey>;
  /** The one plate's press: Start, Pause or Resume, as the view names it. */
  readonly onAction: () => void;
  /** A compact board's bar (fix-round 2 ruling R1, `columnBoard.ts`): the time a step down. */
  readonly compact?: boolean;
};

/**
 * A pad's match clock across the top (S2-5 design §6.1; owner ruling 130, "Clock hero"): the time as the biggest thing
 * on the pad, in the LED lime with tabular figures, the period in lilac caps under it, and one full-width lime plate
 * under both: Start before the period's first start, Pause (a pause glyph) while it runs, Resume (a play glyph) while
 * it is stopped. A stopped clock dims its digits to `ink3` and carries an orange PAUSED tag beside the period (orange,
 * never red: AGENTS §5). A kit part with no sport named: the sport fills the view (`ClockBarView`) and the bar decides
 * nothing. The face is no button (the controller's ruling 134): Correct opens from More alone, since a stray touch near
 * the top edge opened it (device-run-1 F3). The time never wraps: it shrinks to fit its one line, down to
 * `layout.clockFloor`. A screen reader hears the face as one ("Match clock 34:12, 1st half, Paused").
 */
export const ClockBar = memo(function ClockBar({ view, onAction, compact }: ClockBarProps) {
  const words = usePadText();
  const tier: BoardTier = compact === true ? 'compact' : 'full';
  return (
    <View testID="clock-bar" style={styles.bar}>
      <ClockFace
        time={view.time}
        said={words(view.said)}
        tier={tier}
        period={view.period === null ? null : words(view.period)}
        paused={view.paused === null ? null : words(view.paused)}
      />
      {view.action === null ? null : (
        <ClockPlate action={view.action} onPress={onAction} tier={tier} />
      )}
    </View>
  );
});

const styles = StyleSheet.create({
  bar: { alignSelf: 'stretch' },
  face: { alignItems: 'center', justifyContent: 'center' },
  faceFull: { minHeight: faceHeight('full') },
  faceCompact: { minHeight: faceHeight('compact') },
  time: { alignSelf: 'stretch', textAlign: 'center' },
  timePaused: { alignSelf: 'stretch', textAlign: 'center', color: colour.ink3 },
  periodRow: {
    height: PERIOD_HEIGHT,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.sm,
  },
  period: { flexShrink: 1, color: colour.ink3 },
  pausedTag: {
    flexShrink: 0,
    paddingHorizontal: space.xs,
    borderWidth: layout.iconBorder,
    borderColor: colour.caution,
    borderRadius: radius.card,
  },
  pausedWord: { color: colour.caution },
  plate: {
    minHeight: layout.touch,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.sm,
    paddingHorizontal: space.sm,
    borderRadius: radius.card,
    backgroundColor: colour.lime,
  },
  plateFullGap: { marginTop: space.sm },
  plateCompactGap: { marginTop: space.xs },
  platePressed: { opacity: pressedOpacity.plate },
  plateLabel: { color: plateInk },
  glyph: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: layout.padGlyphGap,
  },
  glyphBar: {
    width: layout.padGlyphBar,
    height: layout.padGlyphHeight,
    backgroundColor: plateInk,
  },
  // A play triangle: a box with no width whose left border is the point's body and whose top and bottom are clear.
  triangle: {
    width: 0,
    height: 0,
    borderTopWidth: layout.padGlyphHalf,
    borderBottomWidth: layout.padGlyphHalf,
    borderLeftWidth: layout.padGlyphLength,
    borderTopColor: colour.clear,
    borderBottomColor: colour.clear,
    borderLeftColor: plateInk,
  },
});

const faceFull = [styles.face, styles.faceFull];
const faceCompact = [styles.face, styles.faceCompact];

type ClockFaceProps = {
  readonly time: string;
  readonly said: string;
  readonly tier: BoardTier;
  readonly period: string | null;
  readonly paused: string | null;
};

/** The time over the period's line and the PAUSED tag, heard as one. */
const ClockFace = memo(function ClockFace({ time, said, tier, period, paused }: ClockFaceProps) {
  const label = [said, period, paused].filter((part) => part !== null).join(', ');
  return (
    <View accessible accessibilityLabel={label} style={tier === 'compact' ? faceCompact : faceFull}>
      <Text
        variant={TIER_FACES[tier].time}
        numberOfLines={1}
        adjustsFontSizeToFit
        minimumFontScale={layout.clockFloor}
        aria-hidden
        style={paused === null ? styles.time : styles.timePaused}
      >
        {time}
      </Text>
      <PeriodRow period={period} paused={paused} />
    </View>
  );
});

/** The period's one line, and beside it the PAUSED tag while the clock is stopped. */
function PeriodRow({
  period,
  paused,
}: {
  readonly period: string | null;
  readonly paused: string | null;
}) {
  return (
    <View aria-hidden style={styles.periodRow}>
      {period === null ? null : (
        <Text variant="diagSection" numberOfLines={1} style={styles.period}>
          {period}
        </Text>
      )}
      {paused === null ? null : (
        <View testID="clock-paused" style={styles.pausedTag}>
          <Text variant="diagSection" numberOfLines={1} style={styles.pausedWord}>
            {paused}
          </Text>
        </View>
      )}
    </View>
  );
}

type ClockPlateProps = {
  readonly action: ClockBarAction<MessageKey>;
  readonly onPress: () => void;
  readonly tier: BoardTier;
};

/** The one plate: lime with night ink (AGENTS §5's primary), a glyph before Pause and Resume, a touch target tall. */
const ClockPlate = memo(function ClockPlate({ action, onPress, tier }: ClockPlateProps) {
  const words = usePadText();
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={tier === 'full' ? plateFull : plateCompact}
    >
      {action.kind === 'start' ? null : <PlateGlyph kind={action.kind} />}
      <Text variant="actionSecondary" numberOfLines={1} style={styles.plateLabel}>
        {words(action.label)}
      </Text>
    </Pressable>
  );
});

/** Pause's two bars, or Resume's triangle, in night ink on the plate. Drawn, so not read by a screen reader. */
function PlateGlyph({ kind }: { readonly kind: 'pause' | 'resume' }) {
  return (
    <View aria-hidden testID={`glyph-${kind}`} style={styles.glyph}>
      {kind === 'pause' ? (
        <>
          <View style={styles.glyphBar} />
          <View style={styles.glyphBar} />
        </>
      ) : (
        <View style={styles.triangle} />
      )}
    </View>
  );
}

/** Module-level so render allocates no function. */
function pressable(rest: StyleProp<ViewStyle>, pressedStyle: StyleProp<ViewStyle>) {
  const down = [rest, pressedStyle];
  return ({ pressed }: PressableStateCallbackType) => (pressed ? down : rest);
}

const plateFull = pressable([styles.plate, styles.plateFullGap], styles.platePressed);
const plateCompact = pressable([styles.plate, styles.plateCompactGap], styles.platePressed);
