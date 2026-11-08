import { useCallback, useState } from 'react';
import type { NativeSyntheticEvent, TextLayoutEventData, TextProps } from 'react-native';
import { breaksInsideWord, isOneWord, splitInTwo } from '@/ui/components/nameFit';
import { Text } from '@/ui/components/Text';
import type { TypeRole } from '@/ui/theme/type';
import { layout } from '@/ui/theme/tokens';

type NameTextProps = Omit<TextProps, 'children' | 'numberOfLines'> & {
  readonly variant: TypeRole;
  /** The most lines a name with gaps in it wraps to, then an ellipsis. Absent: it wraps with no cap and is never cut. */
  readonly lines?: number;
  /**
   * A name with gaps shrinks to fit its `lines`, down to this scale, before its ellipsis, and no word of it breaks at a
   * letter (a team's column; the controller's fix-round ruling a). Absent: it wraps at full size, as before.
   */
  readonly floor?: number;
  readonly children: string;
};

/**
 * A name as typed, in a place that has a width and no more (device finding, 2026-11-02: a long single-word name broke
 * mid-word on the serving pick, "TEest002ashokash" over "ok"). A name with a gap in it wraps at its gaps, to `lines`.
 * A name with none is one line, shrunk to fit down to `layout.nameFloor` and ended with an ellipsis beyond: a word is
 * never broken inside, which wrapping to two lines cannot promise on Android (`nameFit.ts`). A long word inside a name
 * with gaps still wraps at the letter there, unless the place gives a `floor` (`FittedName`).
 */
export function NameText({ lines, floor, children, ...rest }: NameTextProps) {
  if (isOneWord(children)) return <OneWordName {...rest}>{children}</OneWordName>;
  if (floor === undefined) {
    return (
      <Text {...rest} numberOfLines={lines}>
        {children}
      </Text>
    );
  }
  // A place with other lines is a new place: the split its name was given before is forgotten (fix-round 2, N1).
  return (
    <FittedName key={lines ?? 'uncapped'} {...rest} lines={lines} floor={floor}>
      {children}
    </FittedName>
  );
}

/** A name with no gap: one line, shrunk to fit down to `layout.nameFloor`, then an ellipsis. */
function OneWordName({ children, ...rest }: Omit<NameTextProps, 'lines' | 'floor'>) {
  return (
    <Text
      {...rest}
      numberOfLines={1}
      ellipsizeMode="tail"
      adjustsFontSizeToFit
      minimumFontScale={layout.nameFloor}
    >
      {children}
    </Text>
  );
}

type FittedNameProps = Omit<NameTextProps, 'floor'> & { readonly floor: number };

/**
 * A name with gaps, shrunk to fit its lines down to `floor`, then an ellipsis. Android shrinks only while the lines
 * exceed the cap (RN 0.86.3 `TextLayoutManager.adjustSpannableFontToFit`), so a word wider than the line breaks at a
 * letter on two lines and is never shrunk. The phone's own lines say when it did (`onTextLayout`); the name is then set
 * on two lines at a gap (`splitInTwo`), where that word would make a third line, and the shrink takes it. Only in a
 * place of two lines or more (the controller's fix-round 2 ruling, N1): in one line the hard break would be a second
 * line Android shrinks to its 4 dp floor.
 */
function FittedName({ lines, floor, children, ...rest }: FittedNameProps) {
  const [brokeIn, setBrokeIn] = useState<string | null>(null);
  const splits = lines !== undefined && lines >= 2;
  const laidOut = useCallback(
    (event: NativeSyntheticEvent<TextLayoutEventData>) => {
      if (splits && breaksInsideWord(linesOf(event))) setBrokeIn(children);
    },
    [children, splits],
  );
  return (
    <Text
      {...rest}
      numberOfLines={lines}
      ellipsizeMode="tail"
      adjustsFontSizeToFit
      minimumFontScale={floor}
      onTextLayout={laidOut}
    >
      {brokeIn === children ? splitInTwo(children) : children}
    </Text>
  );
}

const linesOf = (event: NativeSyntheticEvent<TextLayoutEventData>) =>
  event.nativeEvent.lines.map((line) => line.text);
