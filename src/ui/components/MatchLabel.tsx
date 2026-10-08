import { useCallback, useEffect, useRef } from 'react';
import {
  StyleSheet,
  View,
  type LayoutChangeEvent,
  type StyleProp,
  type ViewProps,
  type ViewStyle,
} from 'react-native';
import { labelSize, SIDES, splitMatchLabel, type LabelPart } from '@/domain/session/matchLabel';
import { selectLabel } from '@/hooks/engineSelectors';
import { useEngineSelector } from '@/hooks/useCaptureEngine';
import { Text } from '@/ui/components/Text';
import type { TypeRole } from '@/ui/theme/type';
import { space } from '@/ui/theme/tokens';

/**
 * The match label, split on its sides (spec §2): side A on its own line(s),
 * then a small grey `v` and side B. Nothing at all until the label is known.
 *
 * `onLayoutHeight` (R-F5) tells the stage how tall the label came out, which is how the picture is sized from
 * this match (`stripReserve`): the height after each layout, and 0 when the label goes or changes,
 * so a label that is not there yet is unmeasured, never the last one's height. The newest callback is the
 * one called, so one made anew on every render is fine.
 */
export function MatchLabel({ onLayoutHeight }: { onLayoutHeight?: (height: number) => void }) {
  const label = useEngineSelector(selectLabel);
  // Keyed on its text: a label that changes in place is a new label, so the old one's height goes with it.
  return label === null ? null : (
    <SplitLabel key={label} label={label} onLayoutHeight={onLayoutHeight} />
  );
}

function SplitLabel({
  label,
  onLayoutHeight,
}: {
  label: string;
  onLayoutHeight?: (height: number) => void;
}) {
  // The newest callback, held in a ref, so the layout handler is stable and the reset below runs only when the
  // label goes: a callback made anew each render would otherwise read as a label that went, and no layout comes
  // after it to say the height again.
  const latest = useRef(onLayoutHeight);
  useEffect(() => {
    latest.current = onLayoutHeight;
  });
  const onLayout = useCallback(
    (event: LayoutChangeEvent) => latest.current?.(event.nativeEvent.layout.height),
    [],
  );
  useEffect(() => () => latest.current?.(0), []);
  const split = splitMatchLabel(label);
  const size = labelSize(split);
  const variant: TypeRole = size === 'long' ? 'labelLong' : 'label';
  return (
    // One accessible stop that reads the whole label as typed, not each line and the v
    // (review M4). `accessible` groups the children on native; react-native-web drops it.
    <View
      {...marker({ size, kind: split.kind })}
      accessible
      accessibilityLabel={label}
      onLayout={onLayout}
    >
      {split.kind === 'block' ? (
        <Lines part={split.block} variant={variant} />
      ) : (
        <>
          <Lines part={split.a} variant={variant} />
          <View style={styles.sideB}>
            {/* The label's own separator, shown small and grey: the server's word, not app copy. */}
            <Text variant="metricUnit" testID="match-label-v">
              {SIDES.trim()}
            </Text>
            <Lines part={split.b} variant={variant} style={styles.fill} />
          </View>
        </>
      )}
    </View>
  );
}

/** One `Text` per line: a partner line ends in an ellipsis, a side or block wraps to two. */
function Lines({
  part,
  variant,
  style,
}: {
  part: LabelPart;
  variant: TypeRole;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <View style={style}>
      {part.lines.map((line, at) => (
        <Text key={at} variant={variant} numberOfLines={part.wrap} testID="match-label-line">
          {line}
        </Text>
      ))}
    </View>
  );
}

/**
 * The root's test marker. react-native-web renders `dataSet` as `data-*`
 * attributes, which tests read; native ignores it. React Native's own types
 * leave `dataSet` out, hence the cast.
 */
const marker = (dataSet: { size: string; kind: string }) =>
  ({ testID: 'match-label', dataSet }) as ViewProps;

const styles = StyleSheet.create({
  // Baseline, so the small v sits on the line of side B's first name.
  sideB: { flexDirection: 'row', alignItems: 'baseline', gap: space.xs },
  fill: { flex: 1 },
});
