import { memo } from 'react';
import { StyleSheet, View } from 'react-native';
import { Text } from '@/ui/components/Text';
import { colour, layout, plateInk, space } from '@/ui/theme/tokens';

/**
 * The call on the half's next point (`PadHalf.call`): the serving plate's lime and night ink, in the bottom row after the
 * boxes and before the hint, which gives way to it. Drawn, never over the score; the same words are in the half's name. It is
 * `ScoreHalf`'s bottom row's and the scoreboard row's (tennis) alike.
 */
export const CallPlate = memo(function CallPlate({ words }: { readonly words: string }) {
  return (
    <View testID="call" aria-hidden style={styles.callPlate}>
      <Text
        variant="state"
        numberOfLines={1}
        adjustsFontSizeToFit
        minimumFontScale={layout.padCallMinScale}
        style={styles.plateWord}
      >
        {words}
      </Text>
    </View>
  );
});

const styles = StyleSheet.create({
  // Beside the boxes, which are never cut, the call is the last thing to give way: the hint goes first (it is flex 1 from
  // nothing), then the doubles server's line (`subYields`), then the call's own word shrinks (a tenth of the line's weight).
  callPlate: {
    flexShrink: 0.1,
    minWidth: 0,
    paddingHorizontal: space.sm,
    backgroundColor: colour.lime,
  },
  plateWord: { color: plateInk },
});
