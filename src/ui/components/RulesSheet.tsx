import { memo } from 'react';
import { Pressable, View } from 'react-native';
import { GhostButton } from '@/ui/components/GhostButton';
import { padSheet } from '@/ui/components/padSheet';
import { Text } from '@/ui/components/Text';

type RulesSheetProps = {
  readonly title: string;
  /** The rules, one fact a line, already in the operator's language (a sport's lines: `badmintonRuleLines`). */
  readonly lines: readonly string[];
  readonly closeLabel: string;
  readonly onClose: () => void;
};

/**
 * The match's rules in a bottom sheet over the pad (owner ruling 15, 2026-10-31: "a sheet over the pad with the match
 * rules and Close"), for any sport. A plain View, as every pad sheet (`padSheet.ts`). Close, the dim and Back (the
 * caller's `useBackCloses`) close it. Modal to a screen reader: native reads `accessibilityViewIsModal`,
 * react-native-web `aria-modal`. The dim is a touch target only; Close is its name.
 */
export const RulesSheet = memo(function RulesSheet({
  title,
  lines,
  closeLabel,
  onClose,
}: RulesSheetProps) {
  return (
    <View style={padSheet.overlay}>
      <Pressable aria-hidden onPress={onClose} style={padSheet.dim} />
      <View testID="rules-sheet" accessibilityViewIsModal aria-modal style={padSheet.sheet}>
        <Text variant="title">{title}</Text>
        {lines.map((line, at) => (
          <Text key={at} testID="rules-line" variant="body">
            {line}
          </Text>
        ))}
        <GhostButton label={closeLabel} onPress={onClose} />
      </View>
    </View>
  );
});
