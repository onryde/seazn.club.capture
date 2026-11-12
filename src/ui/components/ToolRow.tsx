import { memo, useCallback } from 'react';
import {
  type PressableStateCallbackType,
  Pressable,
  type StyleProp,
  StyleSheet,
  type TextStyle,
  View,
  type ViewStyle,
} from 'react-native';
import type { PadTool, PadToolKind } from '@/domain/scoring/padView';
import { useHold } from '@/hooks/useHold';
import { useT } from '@/hooks/useLanguage';
import { usePadText } from '@/hooks/usePadText';
import type { MessageKey } from '@/i18n/messages';
import { HoldFill } from '@/ui/components/HoldFill';
import { Text } from '@/ui/components/Text';
import { colour, layout, plateInk, pressedOpacity, radius, space } from '@/ui/theme/tokens';

type ToolRowProps = {
  readonly tools: readonly PadTool<MessageKey>[];
  readonly onTool: (id: string) => void;
  /** The pad's own row is `tool-row`; another row of the same buttons (the update banner's) names itself. */
  readonly testID?: string;
  /**
   * Standard tools' words in full cream (`ink`), as the football mockup draws them (owner ruling 152), not the shared
   * `ink2` of `actionSecondary`. Default no: other sports keep `ink2`.
   */
  readonly brightInk?: boolean;
  /**
   * The id of one tool that is held, not tapped: a 3 s hold under the progress fill, as Go live and Stop (football's
   * End of period, owner ruling 160). Default none: other sports' tools are taps.
   */
  readonly holdTool?: string;
  /**
   * How many cells the row is divided into, when a sport keeps them fixed (volleyball): the slots a tool is not offered in
   * are empty, after the tools, so the others keep their place and width. Default none: the tools share the row.
   */
  readonly slots?: number;
};

/**
 * The pad's tools, in one row under the last-tap line, sharing its width equally. A tool's weight is its kind: the
 * lime plate (primary), an outline (standard), or the caution outline (destructive: never red, AGENTS §5). A per-side
 * tool says its side on a second line, as typed; a screen reader hears both. The row draws the tools the pad offers
 * now: one the pad stops offering is not in the list and its cell goes (badminton's Set score, after a game's first
 * rally), while one offered but not usable now (`enabled` false) keeps its place, disabled.
 */
export const ToolRow = memo(function ToolRow({
  tools,
  onTool,
  testID = 'tool-row',
  brightInk = false,
  holdTool,
  slots,
}: ToolRowProps) {
  const empty = tools.length === 0 || slots === undefined ? 0 : Math.max(0, slots - tools.length);
  return (
    <View testID={testID} style={styles.row}>
      {tools.map((tool) =>
        tool.id === holdTool ? (
          <HeldToolButton key={tool.id} tool={tool} onTool={onTool} brightInk={brightInk} />
        ) : (
          <ToolButton key={tool.id} tool={tool} onTool={onTool} brightInk={brightInk} />
        ),
      )}
      {Array.from({ length: empty }, (_, i) => (
        <View key={`empty-${i}`} style={styles.slot} />
      ))}
    </View>
  );
});

const ToolButton = memo(function ToolButton({
  tool,
  onTool,
  brightInk,
}: {
  readonly tool: PadTool<MessageKey>;
  readonly onTool: (id: string) => void;
  readonly brightInk: boolean;
}) {
  const words = usePadText();
  const press = useCallback(() => onTool(tool.id), [onTool, tool.id]);
  const label = words(tool.label);
  // A label shortened to fit is not what a screen reader says: `said` is the full word.
  const spoken = tool.said === undefined ? label : words(tool.said);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={tool.detail === null ? spoken : `${spoken}, ${tool.detail}`}
      disabled={!tool.enabled}
      onPress={press}
      style={tool.enabled ? CELL[tool.kind] : OFF}
    >
      <Text
        variant="actionSecondary"
        numberOfLines={layout.padToolLines}
        style={tool.enabled ? labelOf(tool.kind, brightInk) : styles.labelOff}
      >
        {label}
      </Text>
      {tool.detail === null ? null : (
        <Text variant="metricUnit" numberOfLines={1}>
          {tool.detail}
        </Text>
      )}
    </Pressable>
  );
});

/**
 * A tool that must be held (ruling 160): the same cell, a 3 s hold under the fill, said in its screen-reader name ("Hold for ..."); no line of its own, so the cell keeps its height in every phase. Letting go
 * early, the app leaving the foreground or the tool going disabled abandons it with nothing sent (`useHold`).
 */
const HeldToolButton = memo(function HeldToolButton({
  tool,
  onTool,
  brightInk,
}: {
  readonly tool: PadTool<MessageKey>;
  readonly onTool: (id: string) => void;
  readonly brightInk: boolean;
}) {
  const words = usePadText();
  const { t } = useT();
  const press = useCallback(() => onTool(tool.id), [onTool, tool.id]);
  const hold = useHold(press, tool.enabled);
  const label = words(tool.label);
  const spoken = tool.said === undefined ? label : words(tool.said);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={t('scoring.football.hold.name', { label: spoken })}
      disabled={!tool.enabled}
      onPressIn={hold.pressIn}
      onPressOut={hold.pressOut}
      style={tool.enabled ? HELD[tool.kind] : HELD_OFF}
    >
      <HoldFill holding={hold.holding} tone="stop" />
      <Text
        variant="actionSecondary"
        numberOfLines={layout.padToolLines}
        style={tool.enabled ? labelOf(tool.kind, brightInk) : styles.labelOff}
      >
        {label}
      </Text>
    </Pressable>
  );
});

const styles = StyleSheet.create({
  held: { overflow: 'hidden' },
  row: { flexDirection: 'row', gap: space.sm },
  slot: { flex: 1, minWidth: 0 },
  cell: {
    flex: 1,
    minWidth: 0,
    minHeight: layout.touch,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: space.sm,
    paddingVertical: space.xs,
    borderRadius: radius.card,
    borderWidth: layout.iconBorder,
  },
  primary: { borderColor: colour.lime, backgroundColor: colour.lime },
  standard: { borderColor: colour.ink3 },
  destructive: { borderColor: colour.caution },
  off: { borderColor: colour.rule },
  pressedPlate: { opacity: pressedOpacity.plate },
  pressedOutline: { backgroundColor: colour.pressFill },
  labelPrimary: { color: plateInk },
  labelDestructive: { color: colour.caution },
  labelOff: { color: colour.ink3 },
  labelBright: { color: colour.ink },
});

/** Module-level so render allocates no function. Pressed: the plate dims, an outline fills, as Button and GhostButton. */
function pressable(rest: StyleProp<ViewStyle>, pressedStyle: StyleProp<ViewStyle>) {
  const down = [rest, pressedStyle];
  return ({ pressed }: PressableStateCallbackType) => (pressed ? down : rest);
}

const CELL: Readonly<
  Record<PadToolKind, (state: PressableStateCallbackType) => StyleProp<ViewStyle>>
> = {
  primary: pressable([styles.cell, styles.primary], styles.pressedPlate),
  standard: pressable([styles.cell, styles.standard], styles.pressedOutline),
  destructive: pressable([styles.cell, styles.destructive], styles.pressedOutline),
};

const OFF: StyleProp<ViewStyle> = [styles.cell, styles.off];

/** The held tool's cells: the same, clipping the fill to the rounded corners. */
const HELD: Readonly<
  Record<PadToolKind, (state: PressableStateCallbackType) => StyleProp<ViewStyle>>
> = {
  primary: pressable([styles.cell, styles.primary, styles.held], styles.pressedPlate),
  standard: pressable([styles.cell, styles.standard, styles.held], styles.pressedOutline),
  destructive: pressable([styles.cell, styles.destructive, styles.held], styles.pressedOutline),
};
const HELD_OFF: StyleProp<ViewStyle> = [styles.cell, styles.off, styles.held];

const LABEL: Readonly<Record<PadToolKind, StyleProp<TextStyle>>> = {
  primary: styles.labelPrimary,
  standard: undefined,
  destructive: styles.labelDestructive,
};

/** A standard tool's word is `ink2` by its role; bright, it is `ink`. The other kinds keep their own. */
const labelOf = (kind: PadToolKind, bright: boolean): StyleProp<TextStyle> =>
  bright && kind === 'standard' ? styles.labelBright : LABEL[kind];
