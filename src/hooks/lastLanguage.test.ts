import { afterEach, describe, expect, it } from 'vitest';
import { lastLanguage, noteLanguage, resetLastLanguage } from '@/hooks/lastLanguage';

/** P1 (2026-10-01): the crash screen's language, held where a crash cannot take it. */
describe('the last resolved language', () => {
  afterEach(() => resetLastLanguage());

  it('is null before any language resolved (a crash at launch)', () => {
    expect(lastLanguage()).toBeNull();
  });

  it('holds the language last noted, and a second note replaces it', () => {
    noteLanguage('fr');
    expect(lastLanguage()).toBe('fr');
    noteLanguage('nl');
    expect(lastLanguage()).toBe('nl');
  });

  it('forgets on reset', () => {
    noteLanguage('es');
    resetLastLanguage();
    expect(lastLanguage()).toBeNull();
  });
});
