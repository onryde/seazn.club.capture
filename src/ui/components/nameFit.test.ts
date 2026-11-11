import { describe, expect, it } from 'vitest';
import { breaksInsideWord, isOneWord, splitInTwo } from '@/ui/components/nameFit';

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

// The controller's fix-round ruling (a): a team's name shrinks to fit before its two-line ellipsis, so no word breaks at
// a letter. Android shrinks only past the line cap, so a word wider than the line breaks inside it on two lines; the
// phone's own lines (`onTextLayout`) say when it did, and the name is then set on two lines at a gap, where the shrink
// sees the word. Each case is the line texts Android hands back, written out by hand.
describe('breaksInsideWord', () => {
  it.each([
    ['one line', ['Riverside FC']],
    ['a break at a space, which the line keeps', ['Northgate ', 'United']],
    ['a break at a line feed', ['Wolverhampton\n', 'Wanderers']],
    ['a break after a hyphen', ['Saint-', 'Étienne']],
    ['no lines at all', []],
    ['the last line cut by its ellipsis, which is no break', ['Wanderers ', 'United Acad…']],
  ])('no: %s', (_why, lines) => {
    expect(breaksInsideWord(lines)).toBe(false);
  });

  it.each([
    ['a word wider than the line, broken at a letter', ['Wolverhampto', 'n Wanderers']],
    ['a break inside the second of three lines', ['Real ', 'Mönchengladba', 'ch']],
  ])('yes: %s', (_why, lines) => {
    expect(breaksInsideWord(lines)).toBe(true);
  });
});

describe('splitInTwo', () => {
  it.each([
    ['two words, at the gap', 'Wolverhampton Wanderers', 'Wolverhampton\nWanderers'],
    [
      'three words, at the gap that leaves the longer line shortest',
      'AFC Wolverhampton Wanderers',
      'AFC Wolverhampton\nWanderers',
    ],
    ['a short word first', 'AFC Bournemouth', 'AFC\nBournemouth'],
    [
      'spaces around it are dropped, and a run of gaps is one',
      '  Borussia   Mönchengladbach ',
      'Borussia\nMönchengladbach',
    ],
    ['a no-break space is no gap: two words, not three', 'FC St.\u00a0Pauli', 'FC\nSt.\u00a0Pauli'],
    ['one word stays as it is', 'Wolverhampton', 'Wolverhampton'],
  ])('%s', (_why, name, split) => {
    expect(splitInTwo(name)).toBe(split);
  });
});
