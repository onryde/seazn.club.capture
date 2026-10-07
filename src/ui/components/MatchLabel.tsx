import { StyleSheet, View, type StyleProp, type ViewProps, type ViewStyle } from 'react-native';
import { labelSize, SIDES, splitMatchLabel, type LabelPart } from '@/domain/session/matchLabel';
import { selectLabel } from '@/hooks/engineSelectors';
import { useEngineSelector } from '@/hooks/useCaptureEngine';
import { Text } from '@/ui/components/Text';
import type { TypeRole } from '@/ui/theme/type';
import { space } from '@/ui/theme/tokens';

/**
 * The match label, split on its sides (spec §2): side A on its own line(s),
 * then a small grey `v` and side B. Nothing at all until the label is known.
 */
export function MatchLabel() {
  const label = useEngineSelector(selectLabel);
  return label === null ? null : <SplitLabel label={label} />;
}

function SplitLabel({ label }: { label: string }) {
  const split = splitMatchLabel(label);
  const size = labelSize(split);
  const variant: TypeRole = size === 'long' ? 'labelLong' : 'label';
  return (
    <View {...marker({ size, kind: split.kind })}>
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
