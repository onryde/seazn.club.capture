import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import type { GateView, TurnCardKind } from '@/domain/orientation/orientation';
import { useT } from '@/hooks/useLanguage';
import type { MessageKey } from '@/i18n/messages';
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
      {/* R27: never flattened, so showing the card never reparents the ScreenStack. */}
      <View
        collapsable={false}
        style={styles.stage}
        aria-hidden={covered}
        importantForAccessibility={covered ? 'no-hide-descendants' : 'auto'}
      >
        {children}
      </View>
      {card === 'none' ? null : <TurnCover card={card} />}
    </>
  );
}

const TITLE: Readonly<Record<TurnCardKind, MessageKey>> = {
  turnSideways: 'turn.sideways.title',
  turnUpright: 'turn.upright.title',
};

/**
 * The card has no visible words (R28), so its root speaks them: one accessible
 * element whose label is the title. The label sits on the same node as the live
 * region, because TalkBack announces a live region's own text and skips
 * focusable children; on iOS the modal root is where VoiceOver lands.
 */
function TurnCover({ card }: { card: TurnCardKind }) {
  const { t } = useT();
  return (
    <FadeOut
      accessible
      accessibilityLabel={t(TITLE[card])}
      accessibilityViewIsModal
      aria-modal
      accessibilityLiveRegion="polite"
    >
      <TurnCard card={card} />
    </FadeOut>
  );
}

const styles = StyleSheet.create({
  stage: { flex: 1 },
});
