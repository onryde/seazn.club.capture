import { describe, expect, it, vi } from 'vitest';

/**
 * `footballOptions` reads an enum's words from the engine's schema through unknown-guards, never assuming its shape. The
 * pinned engine always has the shape (`footballEngine.test.ts` reads the real words), so the guards are proved here
 * against a stand-in engine whose schemas are of other shapes: each answers no words rather than throwing or passing
 * something that is not a word to the pad. A file of its own, so the stand-in replaces the module for these tests only.
 */
const schemas = vi.hoisted(() => ({ current: undefined as unknown }));

vi.mock('@seazn/engine/sports/football', () => ({
  football: {
    get eventSchemas() {
      return schemas.current;
    },
  },
}));

const { footballOptions } = await import('@/domain/scoring/footballEngine');

const shotWith = (outcome: unknown) => ({ 'football.shot': { shape: { outcome } } });

describe('footballOptions, over a schema of another shape', () => {
  it('reads the words of an enum shaped as the engine’s', () => {
    schemas.current = shotWith({ options: ['saved', 'wide'] });
    expect(footballOptions('football.shot', 'outcome')).toEqual(['saved', 'wide']);
  });

  it.each([
    ['no event schemas at all', undefined],
    ['no schema for the type', {}],
    ['a schema with no shape', { 'football.shot': {} }],
    ['a shape with no such field', { 'football.shot': { shape: {} } }],
    ['a field that is no enum', shotWith({})],
    ['options that are no list', shotWith({ options: 'saved' })],
    ['options with an item that is no word', shotWith({ options: ['saved', 3] })],
  ])('answers no words for %s', (_name, eventSchemas) => {
    schemas.current = eventSchemas;
    expect(footballOptions('football.shot', 'outcome')).toEqual([]);
  });
});
