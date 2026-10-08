import { memo } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Text } from '@/ui/components/Text';
import { colour, layout, radius, space } from '@/ui/theme/tokens';

type ChoiceRowProps = {
  readonly label: string;
  readonly checked: boolean;
  readonly onPress: () => void;
};

/**
 * A switch as one large row (the owner's Settings board): a filled card, the label on the left and a pill switch on
 * the right. The whole row is the control, easy to hit on a tripod, and its state is said to a screen reader, not
 * only shown; the pill is a picture of that state, so it is hidden from the accessibility tree and is never a
 * second control. On is the lime LED with a night knob at the right end; off is an outlined track with a lilac
 * knob at the left.
 */
export const ChoiceRow = memo(function ChoiceRow({ label, checked, onPress }: ChoiceRowProps) {
  return (
    <Pressable
      accessibilityRole="switch"
      accessibilityLabel={label}
      // Not accessibilityState: react-native-web drops it, and React Native's
      // Pressable reads aria-checked into the same checked state (0.86,
      // Libraries/Components/Pressable/Pressable.js).
      aria-checked={checked}
      onPress={onPress}
      style={styles.row}
    >
      <Text variant="controlInk" style={styles.label}>
        {label}
      </Text>
      {/* aria-hidden: View reads it as importantForAccessibility "no-hide-descendants" on Android and as
          accessibilityElementsHidden on iOS (0.86, Libraries/Components/View/View.js). */}
      <View testID="switch-track" aria-hidden style={checked ? trackOn : styles.track}>
        <View testID="switch-knob" style={checked ? knobOn : knobOff} />
      </View>
    </Pressable>
  );
});

const styles = StyleSheet.create({
  row: {
    minHeight: layout.touch,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    paddingHorizontal: layout.switchRowPadX,
    paddingVertical: space.sm,
    backgroundColor: colour.surface,
    borderRadius: radius.card,
  },
  // The label takes the line, so the switch is pushed to the right and a long label wraps beside it.
  label: { flex: 1 },
  // The outline is drawn inside the 40 x 24 in both states (lime on lime when on), so a press does not move the row;
  // the knob's 3 dp from the track's edge is the outline plus this padding.
  track: {
    width: layout.switchTrackW,
    height: layout.switchTrackH,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-start',
    padding: layout.switchInset - layout.switchBorder,
    borderWidth: layout.switchBorder,
    borderColor: colour.ink3,
    borderRadius: layout.switchTrackH / 2,
    backgroundColor: colour.surface2,
  },
  trackOn: { justifyContent: 'flex-end', borderColor: colour.lime, backgroundColor: colour.lime },
  knob: {
    width: layout.switchKnob,
    height: layout.switchKnob,
    borderRadius: layout.switchKnob / 2,
  },
  knobOff: { backgroundColor: colour.ink3 },
  knobOn: { backgroundColor: colour.ground },
});

const trackOn = [styles.track, styles.trackOn];
const knobOff = [styles.knob, styles.knobOff];
const knobOn = [styles.knob, styles.knobOn];
