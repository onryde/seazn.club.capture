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

/**
 * Table tennis is held the same way (plan S2-2 Task 3): its modules are `tableTennis*` (domain, services) and
 * `*TableTennis*` (hooks, screens), both case spellings since the globs are case sensitive.
 */
const TT_VALUE =
  "import { foldTableTennis } from '@/domain/scoring/tableTennisFold';\nexport const f = foldTableTennis;\n";
const TT_TYPE =
  "import type { TableTennisDisplay } from '@/domain/scoring/tableTennisPad';\nexport type D = TableTennisDisplay;\n";

const TT_CAPITAL =
  "import { useTableTennisMatch } from '@/hooks/useTableTennisMatch';\nexport const h = useTableTennisMatch;\n";

const TT_OWN = [
  'src/domain/scoring/tableTennisFold.ts',
  'src/domain/scoring/tableTennisLedgerHistory.ts',
  'src/domain/scoring/tableTennisSanction.ts',
  'src/domain/scoring/tableTennisSport.ts',
  'src/hooks/useTableTennisMatch.ts',
  'src/hooks/useTableTennisSheets.ts',
  'src/ui/screens/TableTennisPadScreen.tsx',
  'src/services/fakeTableTennisPad.ts',
  // held by `usePad*` and exempt only by `*TableTennis*`
  'src/hooks/usePadTableTennisProbe.ts',
] as const;

describe('a generic scoring file names no table tennis module either', { timeout: 180_000 }, () => {
  it('refuses a table tennis import, by value and by type, from a path of every glob', async () => {
    const byValue = await Promise.all(
      GENERIC.map(async (file) => (await refusals(TT_VALUE, file)).length),
    );
    const byType = await Promise.all(
      GENERIC.map(async (file) => (await refusals(TT_TYPE, file)).length),
    );
    expect(byValue).toEqual(GENERIC.map(() => 1));
    expect(byType).toEqual(GENERIC.map(() => 1));
  });

  it('refuses the capitalised spelling too (a hook or a screen)', async () => {
    const counts = await Promise.all(
      GENERIC.map(async (file) => (await refusals(TT_CAPITAL, file)).length),
    );
    expect(counts).toEqual(GENERIC.map(() => 1));
  });

  // The sport module and the card steps (plan S2-2 Task 6): the lifted set-based file stands where a copy would have been.
  it.each([
    [
      'the sport',
      "import { tableTennisSport } from '@/domain/scoring/tableTennisSport';\nexport const s = tableTennisSport;\n",
    ],
    [
      'the card steps',
      "import { chooseCard } from '@/domain/scoring/tableTennisSanction';\nexport const c = chooseCard;\n",
    ],
    // The sheets hook (plan S2-2 Task 7): sport-owned, as `usePadSheets` is badminton's; the lifted parts are generic.
    [
      'the sheets hook',
      "import { useTableTennisSheets } from '@/hooks/useTableTennisSheets';\nexport const s = useTableTennisSheets;\n",
    ],
  ])(
    'refuses %s from a path of every glob, and from the shared card file itself',
    async (_name, source) => {
      const counts = await Promise.all(
        [...GENERIC, 'src/domain/scoring/setBasedSanction.ts'].map(
          async (file) => (await refusals(source, file)).length,
        ),
      );
      expect(counts).toEqual([...GENERIC, 'src/domain/scoring/setBasedSanction.ts'].map(() => 1));
    },
  );

  it('stays silent in table tennis’s own files, and in a test', async () => {
    const own = await Promise.all(
      TT_OWN.flatMap((file) =>
        [TT_VALUE, TT_CAPITAL].map(async (src) => (await refusals(src, file)).length),
      ),
    );
    expect(own).toEqual(TT_OWN.flatMap(() => [0, 0]));
    expect(await refusals(TT_VALUE, 'src/domain/scoring/tableTennisFold.test.ts')).toEqual([]);
  });
});

/**
 * Chess is held the same way (plan S2-3 Task 1): its modules are `chess*` (domain, services) and `*Chess*` (hooks, screens),
 * both case spellings since the globs are case sensitive. Its sport key is `boardgame`, so no file name carries it.
 */
const CHESS_VALUE =
  "import { foldChess } from '@/domain/scoring/chessFold';\nexport const f = foldChess;\n";
const CHESS_TYPE =
  "import type { ChessDisplay } from '@/domain/scoring/chessTypes';\nexport type D = ChessDisplay;\n";
const CHESS_CAPITAL =
  "import { useChessMatch } from '@/hooks/useChessMatch';\nexport const h = useChessMatch;\n";

const CHESS_OWN = [
  'src/domain/scoring/chessFold.ts',
  'src/domain/scoring/chessLedgerHistory.ts',
  'src/domain/scoring/chessPad.ts',
  'src/domain/scoring/chessSport.ts',
  'src/hooks/useChessMatch.ts',
  'src/hooks/useChessSheets.ts',
  'src/ui/screens/ChessPadScreen.tsx',
  'src/services/fakeChessPad.ts',
  // held by `usePad*` and exempt only by `*Chess*`
  'src/hooks/usePadChessProbe.ts',
] as const;

describe('a generic scoring file names no chess module either', { timeout: 180_000 }, () => {
  it('refuses a chess import, by value and by type, from a path of every glob', async () => {
    const byValue = await Promise.all(
      GENERIC.map(async (file) => (await refusals(CHESS_VALUE, file)).length),
    );
    const byType = await Promise.all(
      GENERIC.map(async (file) => (await refusals(CHESS_TYPE, file)).length),
    );
    expect(byValue).toEqual(GENERIC.map(() => 1));
    expect(byType).toEqual(GENERIC.map(() => 1));
  });

  it('refuses the capitalised spelling too (a hook or a screen)', async () => {
    const counts = await Promise.all(
      GENERIC.map(async (file) => (await refusals(CHESS_CAPITAL, file)).length),
    );
    expect(counts).toEqual(GENERIC.map(() => 1));
  });

  it('refuses the sport module from a path of every glob, and from the lifted set-based file', async () => {
    const source =
      "import { chessSport } from '@/domain/scoring/chessSport';\nexport const s = chessSport;\n";
    const paths = [...GENERIC, 'src/domain/scoring/setBasedSanction.ts'];
    const counts = await Promise.all(
      paths.map(async (file) => (await refusals(source, file)).length),
    );
    expect(counts).toEqual(paths.map(() => 1));
  });

  it('stays silent in chess’s own files, and in a test', async () => {
    const own = await Promise.all(
      CHESS_OWN.flatMap((file) =>
        [CHESS_VALUE, CHESS_CAPITAL].map(async (src) => (await refusals(src, file)).length),
      ),
    );
    expect(own).toEqual(CHESS_OWN.flatMap(() => [0, 0]));
    expect(await refusals(CHESS_VALUE, 'src/domain/scoring/chessFold.test.ts')).toEqual([]);
  });
});
