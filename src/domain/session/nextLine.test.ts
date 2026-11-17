import { describe, expect, it } from 'vitest';
import { advanceOf, cutNextLabel, NEXT_LABEL_ROOM } from '@/domain/session/nextLine';
import en from '@/i18n/en.json';
import { createTranslator } from '@/i18n/translate';

// Court stream (spec 2026-11-14 §6.2, I4; P3 review m2): the Next line is "Next: " + the label + " · " + a time, and the
// label is cut by how wide it draws so the time is never the part an ellipsis eats. The advances are the font's, in
// thousandths of the body size (measured against the shipped file by stripTextFit.test.ts); here, the cut's own rules.
describe('the Next line’s match label (cutNextLabel)', () => {
  const { t } = createTranslator('en');

  it('keeps a label that fits whole, in capitals or not (24 characters of both)', () => {
    for (const label of [
      'Example Town v Sample CC',
      'MANCHESTER UNITED FC U12',
      'Centre Court, Show Arena',
    ]) {
      expect([...label]).toHaveLength(24);
      expect(cutNextLabel(label)).toBe(label);
    }
  });

  it('cuts 24 of the widest capital to what fits: 14 and an ellipsis, never 24', () => {
    expect(cutNextLabel('W'.repeat(24))).toBe(`${'W'.repeat(14)}…`);
  });

  it('cuts capitals sooner than lower case: the same 23 letters', () => {
    expect(cutNextLabel('WOLVERHAMPTON WANDERERS')).toBe('WOLVERHAMPTON WANDER…');
    expect(cutNextLabel('Wolverhampton Wanderers')).toBe('Wolverhampton Wanderers');
  });

  it('cuts a long label to its first words and an ellipsis, and the line still ends in the time', () => {
    const cut = cutNextLabel('Example Town v Sample Cricket Club');
    expect(cut).toBe('Example Town v Sample Crick…');
    const line = t('stream.status.courtNextAt', { label: cut, time: '14:32' });
    expect(line).toBe('Next: Example Town v Sample Crick… · 14:32');
    expect(line.endsWith('· 14:32')).toBe(true);
  });

  it('leaves no space before the ellipsis', () => {
    // 14 W and the ellipsis are 13801 of the 14700; the space after them (250) still fits, the next W does not.
    expect(cutNextLabel(`${'W'.repeat(14)} WWW`)).toBe(`${'W'.repeat(14)}…`);
  });

  it('keeps what fits, glyph by glyph, until the room is spent', () => {
    // 'a' is 551 and 'i' is 245; a label of the room's size, made of them, is whole; an 'i' more is cut.
    const fill = 'a'.repeat(26); // 26 × 551 = 14326, the room less 374
    expect(26 * advanceOf('a')).toBeLessThanOrEqual(NEXT_LABEL_ROOM);
    expect(cutNextLabel(fill)).toBe(fill);
    expect(cutNextLabel(`${fill}i`)).toBe(`${fill}i`); // 14571: still inside 14700
    expect(cutNextLabel(`${fill}ii`)).not.toBe(`${fill}ii`); // 14816: past it
  });

  // The edges, worked by hand from the advances (W 945, a 551, i 245) and the ellipsis (571) against the room, 14700.
  it('keeps a label of exactly the room whole, and cuts one more glyph', () => {
    const exact = `${'W'.repeat(7)}${'i'.repeat(33)}`; // 7 × 945 + 33 × 245 = 14700
    expect(cutNextLabel(exact)).toBe(exact);
    expect(cutNextLabel(`${exact}i`)).not.toBe(`${exact}i`);
  });

  it('keeps the last glyph that, with the ellipsis, is exactly the room', () => {
    const kept = `${'W'.repeat(4)}${'a'.repeat(9)}${'i'.repeat(22)}`; // 14129, and 571 for the ellipsis makes 14700
    expect(cutNextLabel(`${kept}WWW`)).toBe(`${kept}…`);
  });

  it('counts an accented Latin-1 letter as its base and a little, so a Spanish or French name is not cut early', () => {
    expect(advanceOf('é')).toBe(advanceOf('e') + 70);
    expect(cutNextLabel('Atlético Madrid v Málaga CF')).toBe('Atlético Madrid v Málaga CF');
  });

  it('counts a glyph it does not know as one wide letter (Œ, CJK, an emoji), and never splits a pair', () => {
    expect(advanceOf('Œ')).toBeGreaterThanOrEqual(1088);
    expect(advanceOf('🏏')).toBe(advanceOf('字'));
    const cut = cutNextLabel(`${'x'.repeat(10)}${'🏏'.repeat(12)}`);
    expect(cut.endsWith('…')).toBe(true);
    expect(cut.includes('�')).toBe(false);
    expect([...cut].every((letter) => letter === 'x' || letter === '🏏' || letter === '…')).toBe(
      true,
    );
  });

  // An empty input: the line is only built when a next match is named, but the cut must hold with nothing.
  it('leaves an empty label empty', () => {
    expect(cutNextLabel('')).toBe('');
  });

  it('says the key in the dictionary the line is built from', () => {
    expect(en['stream.status.courtNextAt']).toBe('Next: {label} · {time}');
  });
});
