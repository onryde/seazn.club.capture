import type { TurnCardKind } from '@/domain/orientation/orientation';

/**
 * How far the turn card's phone outline is rotated, in degrees. The outline is
 * drawn tall, so 0 reads as a phone held upright and ±90 as one held sideways.
 *
 * The card renders under a lock that follows the hands (`orientationGate`,
 * ruling R24), so the outline starts in the pose the operator is holding and
 * ends in the pose asked for (ruling R17). On air the lock stays put and the
 * outline is drawn in that frame instead, which R24 accepts. Progress 1 is
 * that target pose, where reduced motion holds it.
 *
 * A worklet, because the glyph's animated style calls it on the UI thread.
 */
export function turnDegrees(card: TurnCardKind, progress: number): number {
  'worklet';
  const from = card === 'turnSideways' ? 0 : 90;
  const to = card === 'turnSideways' ? -90 : 0;
  return from + (to - from) * progress;
}
