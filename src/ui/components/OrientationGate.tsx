import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import type { GateView } from '@/domain/orientation/orientation';
import { FadeOut } from '@/ui/components/FadeOut';
import { TurnCard } from '@/ui/components/TurnCard';

type Props = { card: GateView['card']; children: ReactNode };

/**
 * Covers everything while the phone is held the wrong way for the current
 * mode. Behind the card, the app is hidden from screen readers and the card is
 * modal and spoken when it appears (ruling R25): an opaque card blocks touches,
 * not VoiceOver or TalkBack. `aria-hidden` plus the explicit Android prop, as
 * HomeScreen does behind its code panel.
 */
export function OrientationGate({ card, children }: Props) {
  const covered = card !== 'none';
  return (
    <>
      <View
        style={styles.stage}
        aria-hidden={covered}
        importantForAccessibility={covered ? 'no-hide-descendants' : 'auto'}
      >
        {children}
      </View>
      {card === 'none' ? null : (
        <FadeOut accessibilityViewIsModal aria-modal accessibilityLiveRegion="polite">
          <TurnCard card={card} />
        </FadeOut>
      )}
    </>
  );
}

const styles = StyleSheet.create({
  stage: { flex: 1 },
});
