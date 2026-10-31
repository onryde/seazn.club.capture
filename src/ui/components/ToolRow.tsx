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
import { usePadText } from '@/hooks/usePadText';
import type { MessageKey } from '@/i18n/messages';
import { Text } from '@/ui/components/Text';
import { colour, layout, plateInk, pressedOpacity, radius, space } from '@/ui/theme/tokens';

type ToolRowProps = {
  readonly tools: readonly PadTool<MessageKey>[];
  readonly onTool: (id: string) => void;
};

/**
 * The pad's tools, in one row under the last-tap line, sharing its width equally. A tool's weight is its kind: the
 * lime plate (primary), an outline (standard), or the caution outline (destructive: never red, AGENTS §5). A per-side
 * tool says its side on a second line, as typed; a screen reader hears both. A disabled tool keeps its place.
 */
export const ToolRow = memo(function ToolRow({ tools, onTool }: ToolRowProps) {
  return (
    <View testID="tool-row" style={styles.row}>
      {tools.map((tool) => (
        <ToolButton key={tool.id} tool={tool} onTool={onTool} />
      ))}
    </View>
  );
});

const ToolButton = memo(function ToolButton({
  tool,
  onTool,
}: {
  readonly tool: PadTool<MessageKey>;
  readonly onTool: (id: string) => void;
}) {
  const words = usePadText();
  const press = useCallback(() => onTool(tool.id), [onTool, tool.id]);
  const label = words(tool.label);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={tool.detail === null ? label : `${label}, ${tool.detail}`}
      disabled={!tool.enabled}
      onPress={press}
      style={tool.enabled ? CELL[tool.kind] : OFF}
    >
      <Text
        variant="actionSecondary"
        numberOfLines={layout.padToolLines}
        style={tool.enabled ? LABEL[tool.kind] : styles.labelOff}
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

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: space.sm },
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

const LABEL: Readonly<Record<PadToolKind, StyleProp<TextStyle>>> = {
  primary: styles.labelPrimary,
  standard: undefined,
  destructive: styles.labelDestructive,
};
