import { describe, expect, it } from 'vitest';
import { isOneWord } from '@/ui/components/nameFit';

// Whether a name has anywhere to break but inside a word (device finding, 2026-11-02: a long single-word name broke
// mid-word on the serving pick, "TEest002ashokash" over "ok"). Android breaks a word that is wider than its line at the
// letter, whatever `numberOfLines` says, so such a name is shrunk to fit one line instead of wrapped. Every case is
// written out by hand from where a line may end: at a space, and nowhere else.

describe('isOneWord', () => {
  it.each([
    ['a plain name', 'Ashok'],
    ['a long run of letters and digits, as the device showed', 'TEest002ashokash'],
    ['a hyphenated name, which shrinks rather than breaks after its hyphen', 'Smith-Jones'],
    ['a name with a space around it and nowhere inside', ' Ashok '],
    ['a no-break space between initial and surname', 'A. Sharma'],
    ['a narrow no-break space', 'A. Sharma'],
    ['a figure space', 'A. Sharma'],
    ['a name written with no spaces at all', '山田太郎'],
    ['nothing', ''],
    ['only spaces', '   \t '],
  ])('is one word: %s', (_why, name) => {
    expect(isOneWord(name)).toBe(true);
  });

  it.each([
    ['an initial and a surname', 'A. Sharma'],
    ['a doubles side, partners joined', 'A. Sharma / R. Iyer'],
    ['a tab', 'Ana\tLopez'],
    ['a line feed', 'Ana\nLopez'],
    ['an ideographic space', 'Ana　Lopez'],
    ['a thin space', 'Ana Lopez'],
    ['a long first name and a short one', 'Konstantinopolitanisch Li'],
  ])('is not one word: %s', (_why, name) => {
    expect(isOneWord(name)).toBe(false);
  });
});
