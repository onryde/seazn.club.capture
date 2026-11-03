import { fileURLToPath } from 'node:url';
import { ESLint } from 'eslint';
import { beforeAll, describe, expect, it } from 'vitest';

/**
 * Pad per sport (owner, 2026-11-02): a generic scoring file names no sport's module, and the rule that keeps it so is
 * the lint config's globs (`SPORT_GENERIC_FILES`, `SPORT_OWN_FILES` in `eslint.config.mjs`), not a convention. A glob
 * that misses a file lets a sport leak into the match runtime without a red anywhere, so this lints a probe at a path
 * from each glob family through the repo's own config. Mutate a glob and a family goes silent here.
 */
const root = fileURLToPath(new URL('..', import.meta.url));

let eslint: ESLint;
beforeAll(() => {
  eslint = new ESLint({ cwd: root });
});

const VALUE =
  "import { badmintonSport } from '@/domain/scoring/badmintonSport';\nexport const s = badmintonSport;\n";
const TYPE =
  "import type { BadmintonRules } from '@/domain/scoring/badmintonRules';\nexport type R = BadmintonRules;\n";

async function refusals(source: string, file: string): Promise<string[]> {
  const [result] = await eslint.lintText(source, { filePath: `${root}${file}` });
  return result.messages
    .filter((message) => message.ruleId === 'no-restricted-imports')
    .map((message) => message.message);
}

/** One path per glob (and per extension a glob names): where the rule must fire. */
const GENERIC = [
  // src/domain/scoring/**/*.{ts,tsx}
  'src/domain/scoring/probe.ts',
  'src/domain/scoring/deep/probe.tsx',
  // src/domain/mode/scoringHome.ts
  'src/domain/mode/scoringHome.ts',
  // src/hooks/*coring*.{ts,tsx}
  'src/hooks/useScoringProbe.ts',
  'src/hooks/useScoringProbe.tsx',
  'src/hooks/scoringProbe.ts',
  // src/hooks/usePad*.{ts,tsx}
  'src/hooks/usePadProbe.ts',
  'src/hooks/usePadProbe.tsx',
  // src/hooks/padScreenModel.ts
  'src/hooks/padScreenModel.ts',
  // the ports and stores, listed
  'src/services/scoringPort.ts',
  'src/services/fetchScoringPort.ts',
  'src/services/tapQueueStore.ts',
  'src/services/scoringLinkStore.ts',
  'src/services/scoringLinkPort.ts',
  // the pad's shared words
  'src/i18n/padText.ts',
  // app/scoring/**/*.{ts,tsx}
  'app/scoring/probe.ts',
  'app/scoring/index.tsx',
  // the kit and the screens every sport shares (their own block, with the ui rule)
  'src/ui/components/Probe.tsx',
  'src/ui/screens/ScoringProbe.tsx',
  'src/ui/screens/ScoringProbe.ts',
] as const;

/** A sport's own files, and the table that lists the sports: free to name a sport's module. */
const OWN = [
  'src/hooks/useBadmintonMatch.ts',
  'src/hooks/usePadSheets.ts',
  'src/domain/scoring/sports.ts',
  'src/domain/scoring/badmintonFold.ts',
  'src/ui/screens/BadmintonPadScreen.tsx',
  'src/ui/screens/scoringScreens.ts',
  'src/services/fakeBadmintonPad.ts',
  // held by `usePad*` and exempt only by `*Badminton*` (globs are case sensitive)
  'src/hooks/usePadBadmintonProbe.ts',
] as const;

describe('a generic scoring file names no sport', { timeout: 180_000 }, () => {
  it('lists the paths it probes (anti-vacuity)', () => {
    expect([GENERIC.length, OWN.length]).toEqual([20, 8]);
  });

  it('refuses a badminton import by value, once, from a path of every glob', async () => {
    const counts = await Promise.all(
      GENERIC.map(async (file) => (await refusals(VALUE, file)).length),
    );
    expect(Object.fromEntries(GENERIC.map((file, at) => [file, counts[at]]))).toEqual(
      Object.fromEntries(GENERIC.map((file) => [file, 1])),
    );
  });

  it('refuses it by type as well', async () => {
    const counts = await Promise.all(
      GENERIC.map(async (file) => (await refusals(TYPE, file)).length),
    );
    expect(counts).toEqual(GENERIC.map(() => 1));
  });

  it('stays silent in the sport’s own files, and in a test', async () => {
    const own = await Promise.all(OWN.map(async (file) => (await refusals(VALUE, file)).length));
    expect(Object.fromEntries(OWN.map((file, at) => [file, own[at]]))).toEqual(
      Object.fromEntries(OWN.map((file) => [file, 0])),
    );
    expect(await refusals(VALUE, 'src/hooks/scoringRunner.test.ts')).toEqual([]);
  });
});
