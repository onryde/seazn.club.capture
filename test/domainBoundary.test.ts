import { fileURLToPath } from 'node:url';
import { ESLint } from 'eslint';
import { beforeAll, describe, expect, it } from 'vitest';

/**
 * AGENTS §3: `src/domain` stays pure, and the rule that keeps it so is the lint config's, not a convention. Plan S2-1
 * Task 1 gives domain one new external allowance, `@seazn/engine` at its phone subpaths (the engine's own
 * `phone-subpaths.json`: core, sport, sports, sports/*, pad), and nothing else. This lints a file in domain through the
 * repo's own config, so a widened allowance that lets `react` in reads red here, not on a phone.
 */
const root = fileURLToPath(new URL('..', import.meta.url));
const IN_DOMAIN = `${root}src/domain/scoring/boundaryProbe.ts`;

let eslint: ESLint;

beforeAll(() => {
  eslint = new ESLint({ cwd: root });
});

async function refusals(source: string): Promise<string[]> {
  const [result] = await eslint.lintText(source, { filePath: IN_DOMAIN });
  return result.messages
    .filter((message) => message.ruleId === 'boundaries/dependencies')
    .map((message) => message.message);
}

describe('domain imports', { timeout: 60_000 }, () => {
  it.each([
    "import { foldMatch } from '@seazn/engine/core';\nexport const f = foldMatch;\n",
    "import type { EventEnvelope } from '@seazn/engine/core';\nexport type E = EventEnvelope;\n",
    "import { badminton } from '@seazn/engine/sports/setbased';\nexport const m = badminton;\n",
    "import * as sports from '@seazn/engine/sports';\nexport const s = sports;\n",
    "import { foldEpochOf } from '@seazn/engine/sport';\nexport const e = foldEpochOf;\n",
    "import * as pad from '@seazn/engine/pad';\nexport const p = pad;\n",
  ])('takes the engine at a phone subpath: %s', async (source) => {
    expect(await refusals(source)).toEqual([]);
  });

  it.each([
    ['react', "import { useState } from 'react';\nexport const u = useState;\n"],
    ['react-native', "import { View } from 'react-native';\nexport const v = View;\n"],
    // The engine's peer, not domain's: domain reads the engine's types and parsed values, never zod itself.
    ['zod', "import { z } from 'zod';\nexport const s = z.string();\n"],
    // Not a phone subpath: the testkit pulls vitest and fast-check.
    ['the testkit', "import * as kit from '@seazn/engine/testkit';\nexport const k = kit;\n"],
  ])('refuses %s', async (_name, source) => {
    expect(await refusals(source)).toHaveLength(1);
  });
});
