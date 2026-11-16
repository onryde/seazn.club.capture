import { describe, expect, it } from 'vitest';
import { cutNextLabel, NEXT_LABEL_CAP } from '@/domain/session/nextLine';
import en from '@/i18n/en.json';
import { createTranslator } from '@/i18n/translate';

// Court stream (spec 2026-11-14 §6.2, I4): the Next line is "Next: " + the label + " · " + a time, and the label is
// cut so the whole line stays inside the status line's 48 characters, the time never being the part an ellipsis eats.
describe('the Next line’s match label (cutNextLabel)', () => {
  const { t } = createTranslator('en');

  it('cuts at 24 code points, as the status line’s destination is', () => {
    expect(NEXT_LABEL_CAP).toBe(24);
  });

  it('keeps a label of exactly 24 characters whole', () => {
    const label = 'Example Town v Sample CC';
    expect([...label]).toHaveLength(24);
    expect(cutNextLabel(label)).toBe(label);
  });

  it('cuts a 60-character label to its first 23 and an ellipsis, and the line still ends in the time', () => {
    const label = 'abcdefghijklmnopqrstuvwxyz'.repeat(3).slice(0, 60);
    const cut = cutNextLabel(label);
    expect(cut).toBe('abcdefghijklmnopqrstuvw…');
    expect([...cut]).toHaveLength(24);
    const line = t('stream.status.courtNextAt', { label: cut, time: '14:32' });
    expect(line).toBe('Next: abcdefghijklmnopqrstuvw… · 14:32');
    expect(line.endsWith('· 14:32')).toBe(true);
  });

  it('counts code points, so an emoji is one character and is never split', () => {
    const label = `${'x'.repeat(22)}🏏🏏🏏`;
    expect(cutNextLabel(label)).toBe(`${'x'.repeat(22)}🏏…`);
  });

  // An empty input: the line is only built when a next match is named, but the cut must hold with nothing.
  it('leaves an empty label empty', () => {
    expect(cutNextLabel('')).toBe('');
  });

  it('says the key in the dictionary the line is built from', () => {
    expect(en['stream.status.courtNextAt']).toBe('Next: {label} · {time}');
  });
});
