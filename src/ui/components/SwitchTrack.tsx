import { memo } from 'react';
import { StyleSheet, View } from 'react-native';
import { colour, layout } from '@/ui/theme/tokens';

/**
 * The pill of a switch row: a picture of the state, never a control of its own, so it is hidden from the accessibility
 * tree (the row that holds it is the switch). On is the lime LED with a night knob at the right end; off is an outlined
 * track with a lilac knob at the left. The outline is drawn inside the 40 x 24 in both states (lime on lime when on),
 * so a press does not move the row; the knob's 3 dp from the track's edge is the outline plus this padding.
 */
export const SwitchTrack = memo(function SwitchTrack({ checked }: { checked: boolean }) {
  // aria-hidden: View reads it as importantForAccessibility "no-hide-descendants" on Android and as
  // accessibilityElementsHidden on iOS (0.86, Libraries/Components/View/View.js).
  return (
    <View testID="switch-track" aria-hidden style={checked ? trackOn : styles.track}>
      <View testID="switch-knob" style={checked ? knobOn : knobOff} />
    </View>
  );
});

const styles = StyleSheet.create({
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
