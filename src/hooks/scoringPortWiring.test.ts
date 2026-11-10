import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import ts from 'typescript';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { scoringPortFor } from '@/hooks/scoringPortWiring';
import type { ScoringFetch } from '@/services/fetchScoringPort';
import { createLogger } from '@/services/logger';
import { createServerClock } from '@/services/serverClock';
import { createRingRecord } from '@/services/sessionRecord';
import type { SteadyClock } from '@/services/steadyClock';
import { FAKE_SCORING_SECRET } from '../../test/fakeScoringLinkPort';

const FIXTURE = '6f0c5a52-3d1e-4a0b-8f55-0c2f6d7b9e10';

/** A server that is never reached, so what the port asked is all a test sees. */
function wiring(
  hosts: readonly string[],
  headers: Readonly<Record<string, string>> = {},
  steadyClock: SteadyClock = { nowMs: () => Date.now() },
) {
  const asked: string[] = [];
  const fetch: ScoringFetch = async (url) => {
    asked.push(url);
    return { status: 503, headers: { get: (name) => headers[name] ?? null }, text: async () => '' };
  };
  const logger = createLogger({ record: createRingRecord(), now: () => 0 });
  const serverClock = createServerClock({ logger });
  return {
    port: scoringPortFor({ fetch, logger, hosts, serverClock, steadyClock }),
    asked,
    serverClock,
  };
}

afterEach(() => vi.useRealTimers());

/**
 * The inert seam (AGENTS §13, class 1): `createNativePorts` is not run by any test, so the rule it wires lives in
 * this one function and is tested here: the port sends only to the build's own host, `hosts[0]`, and a build that has
 * none sends nowhere.
 */
describe('which host the composition root’s scoring port trusts', () => {
  it('the build’s own host, and no other', async () => {
    const { port, asked } = wiring(['stg.seazn.club']);
    const token = FAKE_SCORING_SECRET;
    await port.events({ origin: 'https://stg.seazn.club', token }, FIXTURE, 0);
    await port.events({ origin: 'https://seazn.club', token }, FIXTURE, 0);
    expect(asked).toEqual([`https://stg.seazn.club/api/v1/fixtures/${FIXTURE}/events?since_seq=0`]);
  });

  it('the production build’s host is production’s alone', async () => {
    const { port, asked } = wiring(['seazn.club']);
    const token = FAKE_SCORING_SECRET;
    await port.rules({ origin: 'https://stg.seazn.club', token }, FIXTURE);
    await port.rules({ origin: 'https://seazn.club', token }, FIXTURE);
    expect(asked).toEqual([`https://seazn.club/api/v1/fixtures/${FIXTURE}/rules`]);
  });

  it('a build with no host sends nowhere', async () => {
    const { port, asked } = wiring([]);
    const link = { origin: 'https://stg.seazn.club', token: FAKE_SCORING_SECRET };
    expect(await port.bootstrap(link)).toEqual({ kind: 'offline' });
    expect(asked).toEqual([]);
  });
});

/**
 * S2-5 design §7.2: the server clock in `Ports` is fed by this port's answers, or the football clock reads the
 * phone's own time for ever (the inert seam). On the device's clock (`Date.now`, frozen here by the fake timers at
 * 12:00:00Z), an answer whose `Date` says 12:01:00 samples 60 000 + 500.
 */
describe('which clock the composition root’s scoring port feeds', () => {
  it('the server clock it is given: each answer’s Date header moves its offset', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(Date.UTC(2026, 10, 7, 12, 0, 0));
    const { port, serverClock } = wiring(['stg.seazn.club'], {
      Date: 'Sat, 07 Nov 2026 12:01:00 GMT',
    });
    expect(serverClock.offsetMs()).toBe(0);
    await port.rules({ origin: 'https://stg.seazn.club', token: FAKE_SCORING_SECRET }, FIXTURE);
    expect(serverClock.offsetMs()).toBe(60_500);
  });

  // Ruling 137 (F5): the sample is the server less the steady clock, not the wall clock. The wall reads 12:00:00 here,
  // but it was set 5 minutes forward after launch, so the steady clock reads 11:55:00.
  it('measures each sample against the steady clock it is given, never the wall clock', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(Date.UTC(2026, 10, 7, 12, 0, 0));
    const steady = { nowMs: () => Date.UTC(2026, 10, 7, 11, 55, 0) };
    const { port, serverClock } = wiring(
      ['stg.seazn.club'],
      { Date: 'Sat, 07 Nov 2026 12:01:00 GMT' },
      steady,
    );
    await port.rules({ origin: 'https://stg.seazn.club', token: FAKE_SCORING_SECRET }, FIXTURE);
    expect(serverClock.offsetMs()).toBe(360_500);
  });
});

/**
 * The Batch A review's M1, the inert seam's other half: `scoringPortFor` feeds the clock it is given (above), so the
 * football clock reads the server only if `createNativePorts` gives it the very clock it hands the app as
 * `Ports.serverClock`. A second `createServerClock` on either side would be fed and never read, or read and never fed.
 * `createNativePorts` runs in no test, so its source is read, as `photoPortWiring.test.ts` reads it.
 */
type ClockWiring = {
  /** What `const serverClock` is bound to. */
  readonly binding: string | null;
  /** The returned `serverClock` property's value, as written. */
  readonly property: string | null;
  /** What the returned `scoring` property's `scoringPortFor` is given for `serverClock`. */
  readonly scoringClock: string | null;
  /** How many server clocks the function builds. */
  readonly clocks: number;
};

function clockWiringOf(source: string): ClockWiring {
  const file = ts.createSourceFile('nativePorts.ts', source, ts.ScriptTarget.Latest, true);
  const roots: ts.FunctionDeclaration[] = [];
  const find = (node: ts.Node) => {
    if (ts.isFunctionDeclaration(node) && node.name?.text === 'createNativePorts') roots.push(node);
    ts.forEachChild(node, find);
  };
  find(file);
  const [root] = roots;
  if (root === undefined) throw new Error('no createNativePorts');
  const wiring = { binding: null, property: null, scoringClock: null, clocks: 0 } as {
    -readonly [K in keyof ClockWiring]: ClockWiring[K];
  };
  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node) && node.expression.getText(file) === 'createServerClock')
      wiring.clocks += 1;
    if (ts.isVariableDeclaration(node) && node.name.getText(file) === 'serverClock')
      wiring.binding = node.initializer?.getText(file) ?? null;
    if (
      ts.isReturnStatement(node) &&
      node.expression &&
      ts.isObjectLiteralExpression(node.expression)
    )
      for (const property of node.expression.properties) readPort(property);
    ts.forEachChild(node, visit);
  };
  const valueOf = (property: ts.ObjectLiteralElementLike) =>
    ts.isShorthandPropertyAssignment(property)
      ? property.name.text
      : ts.isPropertyAssignment(property)
        ? property.initializer
        : null;
  const readPort = (property: ts.ObjectLiteralElementLike) => {
    const name = property.name?.getText(file);
    const value = valueOf(property);
    if (name === 'serverClock')
      wiring.property = typeof value === 'string' ? value : (value?.getText(file) ?? null);
    if (name !== 'scoring' || value === null || typeof value === 'string') return;
    if (!ts.isCallExpression(value) || value.expression.getText(file) !== 'scoringPortFor') return;
    const [deps] = value.arguments;
    if (deps === undefined || !ts.isObjectLiteralExpression(deps)) return;
    const clock = deps.properties.find((one) => one.name?.getText(file) === 'serverClock');
    const given = clock === undefined ? null : valueOf(clock);
    wiring.scoringClock = typeof given === 'string' ? given : (given?.getText(file) ?? null);
  };
  visit(root);
  return wiring;
}

const CLOCK_SKELETON = (scoring: string, property = 'serverClock') => `
  export function createNativePorts() {
    const logger = createLogger({ record, now: Date.now });
    const serverClock = createServerClock({ logger });
    return { scoring: ${scoring}, serverClock: ${property} };
  }`;
const SCORING = 'scoringPortFor({ fetch, logger, hosts, serverClock })';

describe('createNativePorts feeds the clock it hands the app (Batch A review, M1)', () => {
  it('reads the wiring, and tells a second clock on either side apart', () => {
    expect(clockWiringOf(CLOCK_SKELETON(SCORING))).toEqual({
      binding: 'createServerClock({ logger })',
      property: 'serverClock',
      scoringClock: 'serverClock',
      clocks: 1,
    });
    expect(
      clockWiringOf(
        CLOCK_SKELETON(
          SCORING.replace('serverClock }', 'serverClock: createServerClock({ logger }) }'),
        ),
      ),
    ).toMatchObject({ scoringClock: 'createServerClock({ logger })', clocks: 2 });
    expect(clockWiringOf(CLOCK_SKELETON(SCORING, 'createServerClock({ logger })'))).toMatchObject({
      property: 'createServerClock({ logger })',
      clocks: 2,
    });
    expect(
      clockWiringOf(CLOCK_SKELETON('createFetchScoringPort({ fetch })')).scoringClock,
    ).toBeNull();
  });

  it('the real createNativePorts: one server clock, fed by the scoring port and handed out as Ports.serverClock', () => {
    const source = readFileSync(join(__dirname, 'nativePorts.ts'), 'utf8');
    expect(clockWiringOf(source)).toEqual({
      binding: 'createServerClock({ logger })',
      property: 'serverClock',
      scoringClock: 'serverClock',
      clocks: 1,
    });
  });
});

/**
 * Ruling 137's inert seam: the steady clock the football clock reads (`Ports.steadyClock`) must be the one the scoring
 * port samples against, and the one the app's foreground port wakes, or the offset measures one clock and the reading
 * adds it to another. `createNativePorts` runs in no test, so its source is read.
 */
type SteadyWiring = {
  readonly built: number;
  readonly binding: string | null;
  readonly property: string | null;
  readonly scoringSteady: string | null;
  readonly foregroundArg: string | null;
  readonly foregroundProperty: string | null;
};

function steadyWiringOf(source: string): SteadyWiring {
  const file = ts.createSourceFile('nativePorts.ts', source, ts.ScriptTarget.Latest, true);
  const found = {
    built: 0,
    binding: null,
    property: null,
    scoringSteady: null,
    foregroundArg: null,
    foregroundProperty: null,
  } as { -readonly [K in keyof SteadyWiring]: SteadyWiring[K] };
  const textOf = (property: ts.ObjectLiteralElementLike | undefined): string | null => {
    if (property === undefined) return null;
    if (ts.isShorthandPropertyAssignment(property)) return property.name.text;
    return ts.isPropertyAssignment(property) ? property.initializer.getText(file) : null;
  };
  const named = (literal: ts.ObjectLiteralExpression, name: string) =>
    literal.properties.find((one) => one.name?.getText(file) === name);
  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node) && node.expression.getText(file) === 'createSteadyClock') {
      found.built += 1;
      const [deps] = node.arguments;
      if (deps !== undefined && ts.isObjectLiteralExpression(deps))
        found.foregroundArg = textOf(named(deps, 'foreground'));
    }
    if (ts.isVariableDeclaration(node) && node.name.getText(file) === 'steadyClock')
      found.binding = node.initializer?.getText(file).split('(')[0] ?? null;
    if (
      ts.isReturnStatement(node) &&
      node.expression &&
      ts.isObjectLiteralExpression(node.expression)
    ) {
      found.property = textOf(named(node.expression, 'steadyClock'));
      found.foregroundProperty = textOf(named(node.expression, 'foreground'));
      const scoring = named(node.expression, 'scoring');
      const call =
        scoring !== undefined && ts.isPropertyAssignment(scoring) ? scoring.initializer : null;
      const [deps] = call !== null && ts.isCallExpression(call) ? call.arguments : [];
      if (deps !== undefined && ts.isObjectLiteralExpression(deps))
        found.scoringSteady = textOf(named(deps, 'steadyClock'));
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return found;
}

describe('createNativePorts samples against the steady clock it hands the app (ruling 137)', () => {
  const WIRED: SteadyWiring = {
    built: 1,
    binding: 'createSteadyClock',
    property: 'steadyClock',
    scoringSteady: 'steadyClock',
    foregroundArg: 'foreground',
    foregroundProperty: 'foreground',
  };

  it('reads the wiring, and tells a second steady clock or a second foreground apart', () => {
    const skeleton = (scoringSteady: string, foreground = 'foreground') => `
      export function createNativePorts() {
        const foreground = createNativeForeground();
        const steadyClock = createSteadyClock({ wall: Date.now, mono, logger, foreground });
        return {
          foreground: ${foreground},
          scoring: scoringPortFor({ fetch, steadyClock: ${scoringSteady} }),
          steadyClock,
        };
      }`;
    expect(steadyWiringOf(skeleton('steadyClock'))).toEqual(WIRED);
    expect(steadyWiringOf(skeleton('createSteadyClock({})'))).toMatchObject({
      built: 2,
      scoringSteady: 'createSteadyClock({})',
    });
    expect(steadyWiringOf(skeleton('steadyClock', 'createNativeForeground()'))).toMatchObject({
      foregroundProperty: 'createNativeForeground()',
    });
  });

  it('the real createNativePorts: one steady clock, the scoring port’s, woken by the app’s foreground port', () => {
    const source = readFileSync(join(__dirname, 'nativePorts.ts'), 'utf8');
    expect(steadyWiringOf(source)).toEqual(WIRED);
  });
});
