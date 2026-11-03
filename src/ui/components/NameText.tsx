import type { TextProps } from 'react-native';
import { isOneWord } from '@/ui/components/nameFit';
import { Text } from '@/ui/components/Text';
import type { TypeRole } from '@/ui/theme/type';
import { layout } from '@/ui/theme/tokens';

type NameTextProps = Omit<TextProps, 'children' | 'numberOfLines'> & {
  readonly variant: TypeRole;
  /** The most lines a name with gaps in it wraps to, then an ellipsis. Absent: it wraps with no cap and is never cut. */
  readonly lines?: number;
  readonly children: string;
};

/**
 * A name as typed, in a place that has a width and no more (device finding, 2026-11-02: a long single-word name broke
 * mid-word on the serving pick, "TEest002ashokash" over "ok"). A name with a gap in it wraps at its gaps, to `lines`.
 * A name with none is one line, shrunk to fit down to `layout.nameFloor` and ended with an ellipsis beyond: a word is
 * never broken inside, which wrapping to two lines cannot promise on Android (`nameFit.ts`). A long word inside a name
 * with gaps still wraps at the letter there.
 */
export function NameText({ lines, children, ...rest }: NameTextProps) {
  if (!isOneWord(children)) {
    return (
      <Text {...rest} numberOfLines={lines}>
        {children}
      </Text>
    );
  }
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
