import { StyleSheet } from 'react-native';
import { colour, radius, space } from '@/ui/theme/tokens';

/**
 * The scoring pad's sheets (StepSheet, ScoreEntrySheet, EndingPrompt) share one shape: a dim over the pad and a panel
 * on the bottom edge. A plain View, never SlideUpSheet: a Reanimated entering animation keeps a view's old frame on
 * Fabric when it changes size mid-animation (the controller's brief, 2026-10-31), and a step sheet changes size at
 * every step.
 */
export const padSheet = StyleSheet.create({
  overlay: { ...StyleSheet.absoluteFill, justifyContent: 'flex-end' },
  dim: { ...StyleSheet.absoluteFill, backgroundColor: colour.ground, opacity: 0.7 },
  sheet: {
    gap: space.sm,
    padding: space.md,
    borderTopLeftRadius: radius.card,
    borderTopRightRadius: radius.card,
    backgroundColor: colour.surface2,
  },
});
