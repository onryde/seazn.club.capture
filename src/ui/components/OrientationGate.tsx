import type { Target } from '@/domain/orientation/orientation';
import { useOrientationGate } from '@/hooks/useOrientationGate';
import { FadeOut } from '@/ui/components/FadeOut';
import { TurnCard } from '@/ui/components/TurnCard';

/** Covers everything while the phone is held the wrong way for the current mode. */
export function OrientationGate({ target }: { target: Target }) {
  const { card } = useOrientationGate(target);
  if (card === 'none') return null;
  return (
    <FadeOut>
      <TurnCard card={card} />
    </FadeOut>
  );
}
