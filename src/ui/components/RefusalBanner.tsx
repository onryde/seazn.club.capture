import { memo } from 'react';
import { StyleSheet, View } from 'react-native';
import { Text } from '@/ui/components/Text';
import { colour, layout, space } from '@/ui/theme/tokens';

/**
 * A tap the pad did not record, said where the last tap's sentence goes, in the caution orange (never red: red means
 * ON AIR, AGENTS §5). An alert: a screen reader says it at once (`role` alert on iOS and the web, the assertive live
 * region on Android, where TalkBack reads no role aloud by itself).
 */
export const RefusalBanner = memo(function RefusalBanner({ text }: { readonly text: string }) {
  return (
    <View
      testID="refusal"
      accessibilityRole="alert"
      accessibilityLiveRegion="assertive"
      style={styles.banner}
    >
      <Text variant="control" numberOfLines={layout.padLineLines} style={styles.text}>
        {text}
      </Text>
    </View>
  );
});

const styles = StyleSheet.create({
  banner: {
    borderLeftWidth: layout.padSideBar,
    borderLeftColor: colour.caution,
    paddingLeft: space.sm,
  },
  text: { color: colour.caution },
});
