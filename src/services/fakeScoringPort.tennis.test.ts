import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// S2-7 B3 fix round (review M2): the fake server judges a tennis match with the team sheet as the web builds it, i.e. through
// `tennisLineupOf`. Engine 7.0.0 does not refuse an off-sheet person, so no behaviour can pin that yet; this reads the fake's
// source (a module mock of an aliased import did not intercept it) and pins the wiring, so that Batch E's engine 8.0.0, which
// may refuse one, is judged by the fake with the same sheet the phone folds with.

const source = readFileSync(
  fileURLToPath(new URL('./fakeScoringPort.ts', import.meta.url)),
  'utf8',
);

/** The tennis entry of the fake's table of sports: from its key to the next sport's. */
const tennisEntry = (): string => {
  const from = source.indexOf('\n  tennis: {');
  const to = source.indexOf('\n  cricket: {');
  if (from < 0 || to < from)
    throw new Error('the fake has no tennis entry between football and cricket');
  return source.slice(from, to);
};

describe('the fake judges a tennis match with the team sheet through tennisLineupOf', () => {
  it('both sides’ lineups are built by it', () => {
    const entry = tennisEntry();
    expect(entry).toMatch(/home:\s*tennisLineupOf\(sides\.home\)/);
    expect(entry).toMatch(/away:\s*tennisLineupOf\(sides\.away\)/);
  });

  it('and it is the engine file’s own function', () => {
    expect(source).toMatch(
      /import \{[^}]*\btennisLineupOf\b[^}]*\} from '@\/domain\/scoring\/tennisEngine'/,
    );
  });
});
