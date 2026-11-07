import { act, fireEvent, screen, within } from '@testing-library/react';
import { encodeSavedCode } from '@/domain/mode/savedCode';
import en from '@/i18n/en.json';
import es from '@/i18n/es.json';
import fr from '@/i18n/fr.json';
import nl from '@/i18n/nl.json';
import { chessSeed } from '@/services/fakeChessPad';
import type { FakeMatchSeed } from '@/services/fakeScoringPort';
import { STORE_KEYS } from '@/services/modeStore';
import { TEST_NOW } from './fakePorts';
import { LINK, RAW, linkKey } from './scoringHomeFixtures';
import { flush, launchApp, type LaunchedApp } from './routedApp';

/**
 * What the chess routed suites share (`routedApp.chess.test.tsx`, `routedApp.chess.tiebreak.test.tsx`): the match scanned
 * and started on the fake server, the pad's readings, and presses a second apart on the phone's clock. Each suite resets
 * the clock in its own `beforeEach` (`resetChessClock`). Copy comes from the dictionaries, never from the code under test.
 */

export const DICTIONARIES = { en, es, fr, nl } as const;
export type Words = Readonly<Record<string, string>>;

export const START = { type: 'core.start', payload: {} } as const;

/** A phone that scanned this match earlier: the code saved, the link kept with the sport the bootstrap named. */
export function inMatch(seed: FakeMatchSeed): Record<string, string> {
  return {
    [STORE_KEYS.active]: 'scoring',
    [STORE_KEYS.code('scoring')]: encodeSavedCode({
      mode: 'scoring',
      raw: '',
      slot: null,
      savedAt: TEST_NOW,
      expiresAt: null,
      stream: null,
      scoring: { fixtureId: seed.fixtureId, label: 'Board 4' },
    }),
    [linkKey(seed.fixtureId)]: JSON.stringify({ ...LINK, sportKey: 'boardgame' }),
  };
}

let seconds = 0;
export const resetChessClock = (): void => {
  seconds = 0;
};
/** The phone's clock a second on (or `by` seconds): the next tap is never in the bounce window of the last. */
export const aSecondOn = (app: LaunchedApp, by = 1): void => {
  seconds += by;
  app.setNow(new Date(TEST_NOW.getTime() + seconds * 1000));
};

// A no-break space in a dictionary (French puts one before a colon, a question mark) is matched as a plain space by
// getByText's normaliser, but `textContent` and an accessible name keep it: strings compared to either go through `plain`.
export const plain = (text: string) => text.replace(/ /g, ' ');
export const fill = (text: string, vars: Record<string, string | number>) =>
  plain(
    Object.entries(vars).reduce(
      (out, [name, value]) => out.replace(`{${name}}`, String(value)),
      text,
    ),
  );

export const half = (side: 'first' | 'second') => screen.getByTestId(`half-${side}`);
export const plate = (side: 'first' | 'second') =>
  within(half(side)).queryByTestId('plate')?.textContent;
export const tally = () => screen.getByTestId('tally').textContent;
export const lastTap = () => screen.getByTestId('last-tap-sentence').textContent;
export const strip = () => screen.getByTestId('strip-note').textContent;
export const howSheet = () => screen.queryByTestId('how-sheet');
export const toolNames = () =>
  within(screen.getByTestId('tool-row'))
    .queryAllByRole('button')
    .map((button) => button.getAttribute('aria-label'));
export const choices = () => screen.getAllByRole('radio').map((choice) => choice.textContent);
export const undoCell = (words: Words = en) =>
  screen.queryByRole('button', { name: words['scoring.pad.undo'] });

/** The ledger the fake server holds for the match, whoever wrote it. */
export async function ledger(app: LaunchedApp, seed: FakeMatchSeed) {
  const rows = await app.scoring.events(LINK, seed.fixtureId, 0);
  if (!Array.isArray(rows))
    throw new Error(`the fake server answered the ledger with ${JSON.stringify(rows)}`);
  return rows;
}
export const typesOf = async (app: LaunchedApp, seed: FakeMatchSeed) =>
  (await ledger(app, seed)).map((event) => event.type);

/** A button pressed a second after the last thing the scorer did, and the time its sheet needs before it takes a choice. */
export async function press(app: LaunchedApp, name: string): Promise<void> {
  aSecondOn(app);
  act(() => fireEvent.click(screen.getByRole('button', { name: plain(name) })));
  await flush(400);
}

export async function tapHalf(app: LaunchedApp, side: 'first' | 'second'): Promise<void> {
  aSecondOn(app);
  act(() => fireEvent.click(half(side)));
  await flush(400);
}

export async function pick(app: LaunchedApp, name: string): Promise<void> {
  aSecondOn(app);
  act(() => fireEvent.click(screen.getByRole('radio', { name: plain(name) })));
  await flush(0);
}

/** The match scanned from Home, as the scorer scans it, and the Start screen it opens on. */
export async function scanned(seed: FakeMatchSeed = chessSeed()): Promise<LaunchedApp> {
  const app = await launchApp({ scoringSeed: seed });
  app.scanner.queue({ outcome: 'scanned', raw: RAW });
  act(() => screen.getByRole('button', { name: /Remote Scoring/ }).click());
  await flush(400);
  return app;
}

/** Start match pressed once, a minute before the test's taps (it opens the bounce window for the next tap). */
export async function startPressed(app: LaunchedApp, words: Words = en): Promise<void> {
  app.setNow(new Date(TEST_NOW.getTime() - 60_000));
  act(() =>
    fireEvent.click(screen.getByRole('button', { name: plain(words['scoring.start.confirm']!) })),
  );
  app.setNow(TEST_NOW);
  await flush(200);
}

/** The match scanned and started: the live pad of a game nobody has played a move in. */
export async function live(seed: FakeMatchSeed = chessSeed()): Promise<LaunchedApp> {
  const app = await scanned(seed);
  await startPressed(app);
  return app;
}

/** A result recorded through the sheet, as the scorer does it: a half (or Draw for null), a method if given, Record. */
export async function record(
  app: LaunchedApp,
  winner: 'first' | 'second' | null,
  method?: string,
  words: Words = en,
): Promise<void> {
  if (winner === null) await press(app, words['scoring.chess.tool.draw']!);
  else await tapHalf(app, winner);
  if (method !== undefined) await pick(app, method);
  await press(app, words['scoring.chess.how.record']!);
}

export const DECISIVE = [
  'scoring.chess.method.checkmate',
  'scoring.chess.method.resign',
  'scoring.chess.method.time',
  'scoring.chess.method.adjudication',
  'scoring.chess.method.illegal_move',
] as const;
export const DRAWN = [
  'scoring.chess.method.agreement',
  'scoring.chess.method.stalemate',
  'scoring.chess.method.insufficient',
  'scoring.chess.method.adjudication',
  'scoring.chess.method.repetition',
  'scoring.chess.method.fifty_move',
  'scoring.chess.method.dead_position',
] as const;
