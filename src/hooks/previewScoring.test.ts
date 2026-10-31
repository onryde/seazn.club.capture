import { describe, expect, it } from 'vitest';
import { previewScoringOf } from '@/hooks/previewScoring';

/** The Remote scoring preview's gate: only a build that says it is the dev twin shows it. Fails closed. */
describe('previewScoringOf', () => {
  it('shows the preview in the dev twin', () => {
    expect(previewScoringOf({ extra: { appVariant: 'dev' } })).toBe(true);
  });

  it('hides it in the store build', () => {
    expect(previewScoringOf({ extra: { appVariant: 'store' } })).toBe(false);
  });

  it.each([
    ['no config', null],
    ['an undefined config', undefined],
    ['no extra', {}],
    ['no word', { extra: {} }],
    ['another word', { extra: { appVariant: 'Dev' } }],
    ['a number', { extra: { appVariant: 1 } }],
  ])('hides it with %s, rather than show it in a build it cannot place', (_name, config) => {
    expect(previewScoringOf(config)).toBe(false);
  });
});
