import { memo } from 'react';
import { StyleSheet, View } from 'react-native';
import { Text } from '@/ui/components/Text';
import { colour, space } from '@/ui/theme/tokens';

/**
 * A match's rules under a "Rules" subheading, one fact a line, for any sport (a sport's lines:
 * `badmintonRuleLines`), already in the operator's language. The one drawing of the rules: the Match details sheet and
 * the Not started card both use it (owner, 2026-11-01). The subheading is drawn as History's period headings are.
 */
export const RuleLines = memo(function RuleLines({
  heading,
  lines,
}: {
  readonly heading: string;
  readonly lines: readonly string[];
}) {
  return (
    <View testID="rule-lines" style={styles.block}>
      <Text variant="state" accessibilityRole="header" style={styles.heading}>
        {heading}
      </Text>
      {lines.map((line, at) => (
        <Text key={at} testID="rules-line" variant="body">
          {line}
        </Text>
      ))}
    </View>
  );
});

const styles = StyleSheet.create({
  block: { gap: space.xs },
  heading: { color: colour.ink2 },
});
