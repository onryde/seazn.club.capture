import { StyleSheet } from 'react-native';
import { Text } from '@/ui/components/Text';
import { layout } from '@/ui/theme/tokens';
import { typeScale, type TypeRole } from '@/ui/theme/type';

/** Home's three lines, which the `status` reservation below is made for (a token: homeFit.test.ts adds them up). */
const HOME_LINES = layout.homeStatusLines;

type StatusLineProps = {
  readonly children: string;
  /** Home's line is the `status` role; the viewfinder's strip sets its line in `body` (F20). */
  readonly variant?: Extract<TypeRole, 'status' | 'body'>;
  /** The lines it may take before it ellipsises: Home's three, or the strip's `messageLines` (one). */
  readonly numberOfLines?: number;
};

/**
 * One sentence that is always true (AGENTS.md §6).
 *
 * Never an unexplained spinner: "Uplink lost — holding, 38s left" tells an
 * operator what is happening and how long they have. A spinner tells them the
 * app might be broken.
 */
export function StatusLine({
  children,
  variant = 'status',
  numberOfLines = HOME_LINES,
}: StatusLineProps) {
  return (
    <Text variant={variant} numberOfLines={numberOfLines} style={STYLE[variant]}>
      {children}
    </Text>
  );
}

const styles = StyleSheet.create({
  // No rule of its own: grouping comes from zone boundaries and proximity, not
  // from giving every row the same divider. No inset either: the line sits on
  // the same edge as the title above it, and the screen pads both.
  //
  // Height is reserved for the most lines it may take, so the block does not
  // jump ~40px between "Live." and a longer sentence, which would move every
  // control below it, including the one being pressed. Home's is three lines of
  // the status role (3 × 19); the strip's is `messageLines` (one) line of body.
  status: {
    minHeight: HOME_LINES * typeScale.status.lineHeight,
  },
  body: {
    minHeight: layout.messageLines * typeScale.body.lineHeight,
  },
});

const STYLE = { status: styles.status, body: styles.body } as const;
