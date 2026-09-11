import { Text as RNText } from 'react-native';
import type { TextProps } from 'react-native';
import { type TypeRole, typeScale } from '@/ui/theme/type';

/**
 * All text goes through the scale. A component setting its own `fontSize` or
 * `color` is a review blocker (AGENTS.md §5) — the point of a scale is that
 * nothing sits between its steps.
 *
 * The prop is `variant`, not `role`: React Native's `TextProps` already has a
 * `role` for ARIA, and taking that name both collapsed the type (the two unions
 * intersect only at `'status'`) and shadowed a real accessibility API.
 */
export function Text({ variant, style, ...rest }: TextProps & { variant: TypeRole }) {
  return <RNText {...rest} style={[typeScale[variant], style]} />;
}
