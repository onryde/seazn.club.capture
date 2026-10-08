import { render } from '@testing-library/react';
import { StyleSheet, Text, View } from 'react-native';

/**
 * The owner's Remote scoring board (Idea-scorer-code.dc.html, canvas v23), as the board writes its colours. They are
 * the board's, typed here on purpose and never read from the theme: a test that took them from the tokens would prove
 * the tokens equal themselves. Test-only, so the rule against colour literals in `src/ui` does not apply.
 */
export const BOARD = {
  /** The panel's ground. */
  cream: '#f5f0e8',
  /** The panel's ink: its text, its bar fill and its Hide outline. */
  ink: '#150b36',
  /** The pressed icon button's 2 dp outline. */
  lime: '#9ae600',
  /** The QR's own quiet zone: white, so a phone can read it on the cream. */
  white: '#ffffff',
} as const;

const PAINT = StyleSheet.create({
  ground: { backgroundColor: BOARD.cream },
  ink: { color: BOARD.ink },
  inkEdge: { borderWidth: 1, borderColor: BOARD.ink },
  limeEdge: { borderWidth: 1, borderColor: BOARD.lime },
});

/** What jsdom resolves a style to, so a board colour is compared as the cascade paints it (the layout test's reading). */
function resolved(read: (element: HTMLElement) => string, style: object): string {
  const reference = render(
    <View testID="board-reference" style={style}>
      <Text testID="board-reference-text" style={style}>
        x
      </Text>
    </View>,
  );
  const painted = read(reference.getByTestId('board-reference'));
  reference.unmount();
  return painted;
}

export const boardGround = (): string =>
  resolved((element) => getComputedStyle(element).backgroundColor, PAINT.ground);
export const boardInkText = (): string =>
  resolved(
    (element) =>
      getComputedStyle(element.querySelector('[data-testid="board-reference-text"]') as Element)
        .color,
    PAINT.ink,
  );
export const boardInkEdge = (): string =>
  resolved((element) => getComputedStyle(element).borderTopColor, PAINT.inkEdge);
export const boardLimeEdge = (): string =>
  resolved((element) => getComputedStyle(element).borderTopColor, PAINT.limeEdge);
